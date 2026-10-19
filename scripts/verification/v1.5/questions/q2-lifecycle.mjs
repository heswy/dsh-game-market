#!/usr/bin/env node
/**
 * S-Q2 — question lifecycle against the installed DSH build.
 *
 * Covered here:
 *   A. timed ask_user_question -> host/Client deadline -> `continued` -> answer
 *      through the continued RPC -> new Turn -> duplicate reply. A second
 *      browser window is connected to prove cross-window competition behaviour.
 *   B. multi-question open batch (multi-select + free text) answered in place.
 *   C. closing/dismissing a blocking open question: what the native contract
 *      does when the card carries no callId.
 *   D. switching the main view to another Session while a question is pending.
 *   E. native question UI and the third-party consumer present at the same time.
 *
 * The Agent turns are driven by the probe's scripted local model (provider
 * `qprobe`), NOT a real DeepSeek model. Everything below the model (native
 * ask_user_question tool, ctx.userQuestions waterfall, Remote Events, native
 * Client UI, Session log/projection) is the real runtime.
 *
 * Exit code is non-zero when a required check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, createReport, ensureRuntime, runtimeIdentity, writeJson, sleep } from '../lib/harness.mjs';
import {
  HostBridge,
  SCRATCH,
  RAW_DIR,
  bootHost,
  eventSummary,
  findAskCall,
  findAskResult,
  openProbePage,
  prepareHome,
  untilProbe,
  writeRaw,
  sleepMs,
} from './lib/probe.mjs';

const PORT = Number(process.env.DSH_V15_Q2_PORT || 58174);
const CDP_PORT = Number(process.env.DSH_V15_Q2_CDP || 9478);
const CDP_PORT_2 = Number(process.env.DSH_V15_Q2_CDP2 || 9480);
const HOME_NAME = 'questions-q2';
const RUN_DIR = path.join(SCRATCH, 'q2');
const CWD = path.join(SCRATCH, 'cwd');
const TIMED_PRESET = 'qprobe-timed';

const report = createReport({
  id: 'S-Q2',
  title: 'Question lifecycle: timed/continued, REPLY_QUEUED, multi-window, dismiss, Session switch, native UI coexistence',
  commands: ['node scripts/verification/v1.5/questions/q2-lifecycle.mjs'],
});

ensureRuntime();
const identity = runtimeIdentity();
report.record('runtimeIdentity', identity);

const home = await prepareHome(HOME_NAME, { port: PORT, dir: RUN_DIR });
const host = await bootHost(home, { port: PORT, logName: 'questions-q2-host' });
const bridge = new HostBridge(RUN_DIR);
const evidence = {
  runtime: identity,
  method: 'scripted local model (provider qprobe) drives real Agent turns through the native ask_user_question tool',
  notProven: 'NOT real DeepSeek model calls: the isolated profile has no model credentials.',
  hostUrl: host.url.replace(/token=.*/, 'token=<redacted>'),
  phases: {},
};
const screenshots = [];
let page = null;
let page2 = null;

/** Required check that throws: used inside phase bodies. */
function check(name, ok, detail) {
  report.add(name, Boolean(ok), detail);
  if (!ok) throw new Error(`required check failed: ${name}`);
}

/**
 * Run one independent phase; a thrown failure is recorded and later phases still
 * run. The phase record is created up-front so the body can attach partial
 * evidence (`record.value.*`) even when it fails halfway.
 */
async function phase(name, body) {
  const startedAt = Date.now();
  const record = (evidence.phases[name] = { ok: false, running: true });
  try {
    const value = await body(record);
    record.ok = true;
    record.running = false;
    record.elapsedMs = Date.now() - startedAt;
    record.value = value;
    return value;
  } catch (error) {
    record.ok = false;
    record.running = false;
    record.elapsedMs = Date.now() - startedAt;
    record.error = String(error && error.message ? error.message : error);
    record.stack = String(error && error.stack ? error.stack.split('\n').slice(0, 6).join('\n') : '');
    report.add(`phase ${name} finished`, false, { error: record.error });
    return null;
  }
}

async function newSession(pageRef, { preset = null } = {}) {
  const created = await pageRef.eval(
    `window.__QPROBE__.createSession(${JSON.stringify(CWD)}, ${JSON.stringify(preset)})`,
  );
  const sessionId = created?.result?.value?.sessionId ?? null;
  if (sessionId === null) throw new Error(`session/create failed: ${JSON.stringify(created)}`);
  await pageRef.eval(`window.__QPROBE__.openSession(${JSON.stringify(sessionId)})`);
  await untilProbe(pageRef, `window.__QPROBE__.sessions().mainSessionId === ${JSON.stringify(sessionId)}`, 20000);
  return { sessionId, created };
}

async function waitPending(pageRef, sessionId, timeoutMs = 45000) {
  const seen = await untilProbe(
    pageRef,
    `window.__QPROBE__.statusOf(${JSON.stringify(sessionId)}) && window.__QPROBE__.statusOf(${JSON.stringify(sessionId)}).hasPendingObject`,
    timeoutMs,
  );
  return { seen: seen !== null, status: await pageRef.eval(`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})`) };
}

/** Poll the durable Session log through the Host command bus. */
async function waitEvents(predicate, sessionId, { timeoutMs = 45000, stepMs = 400 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const events = await bridge.events(sessionId);
    if (predicate(events)) return { events, waitedMs: Date.now() - startedAt };
    await sleepMs(stepMs);
  }
  const events = await bridge.events(sessionId);
  return { events, waitedMs: Date.now() - startedAt, timedOut: true };
}

const askResultOf = (events) => {
  const call = findAskCall(events);
  return call === undefined ? undefined : findAskResult(events, call.callId);
};

try {
  const opened = await openProbePage(host, { cdpPort: CDP_PORT });
  page = opened.page;
  check('probe Client materialized in window 1', opened.bootstrapped, { readyMs: opened.readyMs });
  const hostState = bridge.hostState();
  evidence.hostState = hostState;
  report.record('probe preset boot state', hostState?.probe);
  let presetState = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { result } = await bridge.command({ cmd: 'preset-status' });
    presetState = result?.result ?? null;
    if (presetState?.timedPresetRegistered === true) break;
    if (presetState?.timedPresetError) break;
    await sleep(250);
  }
  evidence.presetState = presetState;
  check(
    'probe-only timed ask_user_question preset registered',
    presetState?.timedPresetRegistered === true,
    presetState ?? { error: 'preset-status unavailable' },
  );

  // -------------------------------------------------------------------------
  // A. timed -> continued -> continued RPC -> duplicate reply (two windows)
  // -------------------------------------------------------------------------
  await phase('A-timed-continued', async (record) => {
    record.steps = [];
    const mark = (label) => record.steps.push({ label, at: new Date().toISOString() });
    mark('create-session');
    const { sessionId } = await newSession(page, { preset: TIMED_PRESET });
    await bridge.setScenario({ mode: 'timed', timeoutSeconds: 5 });
    const prompted = await page.eval(`window.__QPROBE__.promptSession(${JSON.stringify(sessionId)}, 'QPROBE_Q2_TIMED')`);
    check('timed scenario prompt accepted', prompted?.result?.value?.accepted === true, prompted);

    const pending = await waitPending(page, sessionId);
    // The published pending object appears as soon as the card is registered; its
    // waterfall channel and deadline attach in the same task, so wait for the
    // channel before asserting on the countdown.
    await untilProbe(
      page,
      `window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})?.pending?.snapshot?.channel === 'waterfall'`,
      10000,
    );
    const pendingNow = await page.eval(`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})`);
    const pendingInfo = pendingNow?.pending;
    record.value = { sessionId, pending: pendingInfo };
    check('timed open question carries a native callId (wait.callId)', typeof pendingInfo?.callId === 'string' && pendingInfo.callId.length > 0, pendingInfo);
    check(
      'timed open question is a waterfall request with a host/client deadline',
      pendingInfo?.snapshot?.state === 'open' && pendingInfo?.snapshot?.channel === 'waterfall' && pendingInfo?.snapshot?.countdown !== null,
      pendingInfo?.snapshot,
    );
    const timedCallId = pendingInfo.callId;

    mark('pending-seen');
    // Replace the conversation view with the game panel while the countdown runs.
    await page.eval('window.__QPROBE__.selectGamePanel()');
    await untilProbe(page, 'window.__QPROBE__.domSignals().probePanelVisible === true', 10000);
    if (page) screenshots.push(await page.shot(path.join(RAW_DIR, 'q2-timed-game-panel-countdown.png')));

    // The native Client owns the deadline once it claimed the wait: do not answer.
    const timedOut = await waitEvents((events) => askResultOf(events) !== undefined, sessionId, { timeoutMs: 40000 });
    const pendingResult = askResultOf(timedOut.events);
    record.value.timeout = {
      waitedMs: timedOut.waitedMs,
      pendingResult,
      projection: await bridge.projection(sessionId),
    };
    check('client-owned countdown settled the call with a pending result (no fabricated answer)', pendingResult?.result?.pending === true, pendingResult);
    check('pending result names the same tool callId', pendingResult?.callId === timedCallId, { toolCallId: pendingResult?.callId, pendingCallId: timedCallId });
    check('timed call remains answerable as `continued` in the userQuestions projection', timedOut.events.length > 0 && (await bridge.projection(sessionId)).active?.[0]?.state === 'continued', await bridge.projection(sessionId));

    const idleAfterTimeout = await bridge.waitIdle(sessionId, 45000);
    report.record('Agent turn ended after the pending result', idleAfterTimeout);
    const statusContinued = await page.eval(`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})`);
    record.value.continuedStatus = statusContinued;
    check('continued card is published with the RPC channel', statusContinued?.pending?.snapshot?.state === 'continued' && statusContinued?.pending?.snapshot?.channel === 'rpc', statusContinued?.pending?.snapshot);

    // Wrong-shape batch must be rejected by the native RPC validation.
    mark('wrong-batch');
    const wrong = await page.eval(
      `window.__QPROBE__.answerViaRpc(${JSON.stringify(sessionId)}, ${JSON.stringify(timedCallId)}, {"answers":[{"id":"not-this-question","selected":[]}]})`,
    );
    record.value.wrongBatch = wrong;
    // UserQuestionError codes arrive as a generic RemoteError at this layer, so the
    // observable contract is "refused, not accepted": assert that rather than a code.
    check('continued RPC refuses a batch that does not name the call question', wrong?.transport === 'ok' && wrong?.result?.ok === false, wrong);

    // Second window: connect, bind the same Session, observe the continued card.
    mark('open-window-2');
    const second = await Cdp.launch({ port: CDP_PORT_2, windowSize: '1280,800' });
    page2 = second;
    await second.navigate(host.url);
    const page2Ready = await second.until('Boolean(window.__QPROBE__)', 90000, 400);
    check('probe Client materialized in window 2', page2Ready !== null, { readyMs: page2Ready });
    // Window 2 must first learn the Session through its own Session list.
    await untilProbe(second, `window.__QPROBE__.sessions().ids.includes(${JSON.stringify(sessionId)})`, 30000);
    await second.eval(`window.__QPROBE__.openSession(${JSON.stringify(sessionId)})`);
    await untilProbe(second, `window.__QPROBE__.sessions().mainSessionId === ${JSON.stringify(sessionId)}`, 20000);
    const secondPending = await waitPending(second, sessionId, 20000);
    record.value.secondWindow = { pending: secondPending.status?.pending, seen: secondPending.seen };
    report.record('window 2 observes the continued PendingQuestion for the bound Session', { seen: secondPending.seen, pending: secondPending.status?.pending ?? null });

    const batch = { answers: [{ id: 'probe-q1', selected: ['QPROBE_OPT_A'] }] };
    mark('answer-window-1');
    const accepted = await page.eval(
      `window.__QPROBE__.answerViaRpc(${JSON.stringify(sessionId)}, ${JSON.stringify(timedCallId)}, ${JSON.stringify(batch)})`,
    );
    record.value.accepted = accepted;
    check('continued RPC accepted the reply in window 1', accepted?.result?.ok === true && accepted?.result?.value === true, accepted);

    mark('answer-window-2');
    const competitor = await second.eval(
      `window.__QPROBE__.answerViaRpc(${JSON.stringify(sessionId)}, ${JSON.stringify(timedCallId)}, ${JSON.stringify(batch)})`,
    );
    record.value.competitor = competitor;
    // Observed contract: once the first reply is admitted the second peer's RPC
    // is refused with `value: false`; while the first reply is still queued the
    // Host rejects it with REPLY_QUEUED instead. Either way it must not steer.
    const competitorAccepted = competitor?.result?.ok === true && competitor?.result?.value === true;
    check(
      'second window cannot get a second reply accepted (REPLY_QUEUED or value:false)',
      competitorAccepted === false,
      competitor,
    );

    const idleAfterReply = await bridge.waitIdle(sessionId, 45000);
    report.record('Agent finished the turn started by the continued reply', idleAfterReply);
    const replied = await waitEvents((events) => events.some((event) => event.type === 'user/message' && event.source?.kind === 'user-question-reply'), sessionId, { timeoutMs: 30000 });
    const events = replied.events;
    const reply = events.find((event) => event.type === 'user/message' && event.source?.kind === 'user-question-reply');
    record.value.reply = reply;
    check('native Session logged the steered user-question-reply message', reply?.source?.kind === 'user-question-reply' && reply?.source?.callId === timedCallId, reply?.source);
    check('reply carries the submitted answer batch', reply?.reply?.answers?.[0]?.selected?.[0] === 'QPROBE_OPT_A', reply?.reply);
    const turnStarts = events.filter((event) => event.type === 'turn/start').length;
    check('the reply started a new Turn (turn 2)', turnStarts >= 2, { turnStarts });

    // A second reply after admission must not steer again.
    const duplicate = await page.eval(
      `window.__QPROBE__.answerViaRpc(${JSON.stringify(sessionId)}, ${JSON.stringify(timedCallId)}, ${JSON.stringify(batch)})`,
    );
    record.value.duplicateAfterAdmission = duplicate;
    check('a reply after admission is refused (no second steer)', duplicate?.result?.ok !== true || duplicate?.result?.value !== true, duplicate);

    const projectionAfter = await bridge.projection(sessionId);
    record.value.projectionAfter = projectionAfter;
    check('projection moved the call from continued to settled', projectionAfter.active.length === 0 && projectionAfter.settled.length === 1, projectionAfter);
    const statusAfter = await page.eval(`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})`);
    check('continued card cleared from window 1 status', statusAfter?.hasPendingObject === false, statusAfter);

    return { sessionId, timedCallId, turnStarts };
  });

  // -------------------------------------------------------------------------
  // B. multi-question blocking/open batch answered in place
  // -------------------------------------------------------------------------
  await phase('B-multi-question', async (record) => {
    const { sessionId } = await newSession(page);
    await bridge.setScenario({ mode: 'multi' });
    const prompted = await page.eval(`window.__QPROBE__.promptSession(${JSON.stringify(sessionId)}, 'QPROBE_Q2_MULTI')`);
    check('multi-question prompt accepted', prompted?.result?.value?.accepted === true, prompted);
    const pending = await waitPending(page, sessionId);
    const info = pending.status?.pending;
    record.value = { sessionId, pending: info };
    check('pending multi-question batch has two questions', Array.isArray(info?.questions) && info.questions.length === 2, info?.questions);
    check('first question is multi-select with two option labels', info.questions[0].multiSelect === true && info.questions[0].optionLabels.length === 2, info.questions[0]);
    await page.eval('window.__QPROBE__.selectGamePanel()');
    const batch = {
      answers: [
        { id: 'probe-q1', selected: ['QPROBE_OPT_A', 'QPROBE_OPT_B'] },
        { id: 'probe-q2', selected: [], custom: 'QPROBE_FREE_ANSWER' },
      ],
    };
    const answered = await page.eval(`window.__QPROBE__.answerPending(${JSON.stringify(sessionId)}, ${JSON.stringify(batch)})`);
    check('multi-question batch settled from the game panel', answered?.ok === true, answered);
    const idle = await bridge.waitIdle(sessionId, 45000);
    check('turn ended after the multi-question answer', idle.idle === true, idle);
    const events = await bridge.events(sessionId);
    const result = askResultOf(events);
    record.value.result = result;
    check('tool result keeps both answers exactly', result?.result?.answers?.length === 2 && result.result.answers[0].selected.length === 2 && result.result.answers[1].custom === 'QPROBE_FREE_ANSWER', result?.result?.answers);
    return { sessionId };
  });

  // -------------------------------------------------------------------------
  // C. dismiss/close semantics for a blocking open question with no callId
  // -------------------------------------------------------------------------
  await phase('C-dismiss', async (record) => {
    const { sessionId } = await newSession(page);
    await bridge.setScenario({ mode: 'open' });
    await page.eval(`window.__QPROBE__.promptSession(${JSON.stringify(sessionId)}, 'QPROBE_Q2_DISMISS')`);
    const pending = await waitPending(page, sessionId);
    const captured = await page.eval(`window.__QPROBE__.capturePending(${JSON.stringify(sessionId)})`);
    check('captured the live blocking PendingQuestion before closing', captured?.ok === true, captured);
    const domWithCard = await page.eval('window.__QPROBE__.domSignals()');
    record.value = { sessionId, captured, domWithCard, pending: pending.status?.pending };
    report.record('native question card visible before closing', domWithCard.questionTextVisible);

    const dismissed = await page.eval(`window.__QPROBE__.dismissPending(${JSON.stringify(sessionId)})`);
    record.value.dismissed = dismissed;
    const statusAfterDismiss = await page.eval(`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})`);
    record.value.statusAfterDismiss = statusAfterDismiss;
    const answeredCaptured = await page.eval(
      `window.__QPROBE__.answerCaptured(${JSON.stringify(sessionId)}, {"answers":[{"id":"probe-q1","selected":["QPROBE_OPT_A"]}]})`,
    );
    record.value.answeredCaptured = answeredCaptured;
    const idle = await bridge.waitIdle(sessionId, 45000);
    const events = await bridge.events(sessionId);
    const result = askResultOf(events);
    record.value.result = result;
    record.value.events = eventSummary(events);

    // The observed native contract for an unnamed (no callId) card is documented
    // here rather than assumed: whichever way it settles, record it truthfully.
    if (result?.result?.pending === true) throw new Error('unexpected: blocking open question recorded a pending result');
    if (answeredCaptured?.ok === true) {
      check('closing did not end the request: the live reference still accepted an answer', result?.result?.answers?.[0]?.selected?.[0] === 'QPROBE_OPT_A', result);
    } else {
      check(
        'closing an unnamed blocking card cancelled the request (native dismiss=reject ASK_CANCELLED)',
        ['ASK_CANCELLED', 'UserQuestionError'].includes(answeredCaptured?.code) || answeredCaptured?.ok === false,
        { dismissed, answeredCaptured, result },
      );
    }
    report.record('turn idle state after close/dismiss', idle);
    return { sessionId, dismissed, answeredCaptured, result };
  });

  // -------------------------------------------------------------------------
  // D. switching the main view to another Session while a question is pending
  // -------------------------------------------------------------------------
  await phase('D-session-switch', async (record) => {
    const { sessionId: pendingSession } = await newSession(page);
    await bridge.setScenario({ mode: 'open' });
    await page.eval(`window.__QPROBE__.promptSession(${JSON.stringify(pendingSession)}, 'QPROBE_Q2_SWITCH_A')`);
    const pending = await waitPending(page, pendingSession);
    check('question is pending on Session A', pending.seen === true, pending.status?.pending);

    const { sessionId: otherSession } = await newSession(page);
    record.value = { pendingSession, otherSession };
    const mainAfterSwitch = await page.eval('window.__QPROBE__.sessions().mainSessionId');
    check('main view switched to a different Session', mainAfterSwitch === otherSession && otherSession !== pendingSession, { mainAfterSwitch, otherSession });

    const stillPending = await page.eval(`window.__QPROBE__.statusOf(${JSON.stringify(pendingSession)})`);
    record.value.stillPending = stillPending;
    check('pending question for Session A stays addressable from Session B view', stillPending?.hasPendingObject === true, stillPending);
    await page.eval('window.__QPROBE__.selectGamePanel()');
    const answered = await page.eval(
      `window.__QPROBE__.answerPending(${JSON.stringify(pendingSession)}, {"answers":[{"id":"probe-q1","selected":["QPROBE_OPT_B"]}]})`,
    );
    check('Session A question can be settled while another Session owns the view', answered?.ok === true, answered);
    const idle = await bridge.waitIdle(pendingSession, 45000);
    check('Session A turn ended after settlement', idle.idle === true, idle);
    const events = await bridge.events(pendingSession);
    const result = askResultOf(events);
    record.value.result = result;
    check('Session A recorded the tool result with the answer', result?.result?.answers?.[0]?.selected?.[0] === 'QPROBE_OPT_B', result);
    return { pendingSession, otherSession };
  });

  // -------------------------------------------------------------------------
  // E. native question UI and the third-party consumer present at the same time
  // -------------------------------------------------------------------------
  await phase('E-native-coexist', async (record) => {
    const { sessionId } = await newSession(page);
    await page.eval('window.__QPROBE__.selectConversation()');
    await bridge.setScenario({ mode: 'open' });
    await page.eval(`window.__QPROBE__.promptSession(${JSON.stringify(sessionId)}, 'QPROBE_Q2_NATIVE')`);
    const pending = await waitPending(page, sessionId);
    check('question pending while the conversation view is active', pending.seen === true, pending.status?.pending);
    const cardSeen = await untilProbe(page, 'window.__QPROBE__.domSignals().questionTextVisible === true', 15000);
    const domBefore = await page.eval('window.__QPROBE__.domSignals()');
    record.value = { sessionId, domBefore, cardSeen: cardSeen !== null };
    check('native question card is rendered in the conversation composer', cardSeen !== null, domBefore);
    if (page) screenshots.push(await page.shot(path.join(RAW_DIR, 'q2-native-question-coexist.png')));

    const statusFromProbe = await page.eval(`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})`);
    check('third-party consumer reads the same pending object the native UI renders', statusFromProbe?.hasPendingObject === true, statusFromProbe);
    const answered = await page.eval(
      `window.__QPROBE__.answerPending(${JSON.stringify(sessionId)}, {"answers":[{"id":"probe-q1","selected":["QPROBE_OPT_A"]}]})`,
    );
    check('third-party answer accepted while the native UI is mounted', answered?.ok === true, answered);
    const idle = await bridge.waitIdle(sessionId, 45000);
    const cardGone = await untilProbe(
      page,
      `window.__QPROBE__.statusOf(${JSON.stringify(sessionId)}) && window.__QPROBE__.statusOf(${JSON.stringify(sessionId)}).hasPendingObject === false`,
      15000,
    );
    const events = await bridge.events(sessionId);
    const result = askResultOf(events);
    const domAfter = await page.eval('window.__QPROBE__.domSignals()');
    record.value.after = { idle, cardGone: cardGone !== null, result, domAfter };
    check('the pending native card is no longer published once the Session settles', cardGone !== null, { idle, domAfter });
    report.record('recorded question text still visible in the transcript after settle (expected tool-call history)', domAfter.questionTextVisible);
    check('Session recorded the answered tool result', result?.result?.answers?.[0]?.selected?.[0] === 'QPROBE_OPT_A', result);
    return { sessionId };
  });

  // -------------------------------------------------------------------------
  // F. browser reconnect while a blocking open question is pending
  // -------------------------------------------------------------------------
  await phase('F-reconnect', async (record) => {
    const { sessionId } = await newSession(page);
    await bridge.setScenario({ mode: 'open' });
    await page.eval(`window.__QPROBE__.promptSession(${JSON.stringify(sessionId)}, 'QPROBE_Q2_RECONNECT')`);
    const pending = await waitPending(page, sessionId);
    check('question is pending before the browser disconnects', pending.seen === true, pending.status?.pending);
    record.value = { sessionId, beforeDisconnect: pending.status?.pending };

    // Close the whole browser window and reconnect as a fresh Client on the same token.
    page.dispose();
    page = null;
    await sleep(2500);
    const reopened = await Cdp.launch({ port: CDP_PORT, windowSize: '1440,900' });
    page = reopened;
    await reopened.navigate(host.url);
    const readyAgain = await reopened.until('Boolean(window.__QPROBE__)', 90000, 400);
    check('reconnected browser materializes the probe Client', readyAgain !== null, { readyMs: readyAgain });
    await reopened.eval(`window.__QPROBE__.openSession(${JSON.stringify(sessionId)})`);
    const seenAgain = await waitPending(reopened, sessionId, 30000);
    record.value.afterReconnect = { seen: seenAgain.seen, pending: seenAgain.status?.pending };
    check('open question is delivered again to the reconnected browser', seenAgain.seen === true, seenAgain.status?.pending);

    const answered = await reopened.eval(
      `window.__QPROBE__.answerPending(${JSON.stringify(sessionId)}, {"answers":[{"id":"probe-q1","selected":["QPROBE_OPT_B"]}]})`,
    );
    record.value.answered = answered;
    check('reconnected browser settles the same open call', answered?.ok === true, answered);
    const idle = await bridge.waitIdle(sessionId, 45000);
    const events = await bridge.events(sessionId);
    const result = askResultOf(events);
    record.value.result = result;
    check('Session recorded the answered tool result after reconnect', result?.result?.answers?.[0]?.selected?.[0] === 'QPROBE_OPT_B', result);
    return { sessionId };
  });

  // Delegation on plugin-domain teardown is intentionally not run here: it
  // requires unloading the native question UI plugin at runtime; see docs.
  report.record('delegation/teardown semantics', { verified: false, reason: 'requires unloading the native user-questions Client plugin at runtime; out of scope for this probe' });

  const final = report.finish({ evidence: { ...evidence, screenshots } });
  writeRaw('q2-lifecycle.json', final);
  writeJson(path.join(RAW_DIR, 'q2-lifecycle.json'), final);
  fs.rmSync(path.join(RAW_DIR, 'q2-lifecycle-failure.json'), { force: true });
  console.log(JSON.stringify({ passed: final.passed, failed: final.failed, checks: final.checks.map((item) => [item.name, item.ok]) }, null, 2));
  try {
    page?.dispose();
  } catch {
    /* ignore */
  }
  try {
    page2?.dispose();
  } catch {
    /* ignore */
  }
  await host.stop();
  process.exit(final.passed ? 0 : 1);
} catch (error) {
  evidence.hostLogTail = host.log().split('\n').slice(-80).join('\n');
  report.add('probe completed without an uncaught error', false, String(error && error.stack ? error.stack.split('\n').slice(0, 8).join('\n') : error));
  const final = report.finish({ evidence });
  writeJson(path.join(RAW_DIR, 'q2-lifecycle-failure.json'), final);
  console.error(JSON.stringify({ passed: false, failed: final.failed, error: String(error && error.message) }, null, 2));
  console.error(evidence.hostLogTail);
  try {
    page?.dispose();
  } catch {
    /* ignore */
  }
  try {
    page2?.dispose();
  } catch {
    /* ignore */
  }
  await host.stop();
  process.exit(1);
} finally {
  try {
    page?.dispose();
  } catch {
    /* ignore */
  }
  try {
    page2?.dispose();
  } catch {
    /* ignore */
  }
  await host.stop();
}
