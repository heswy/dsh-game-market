#!/usr/bin/env node
/**
 * S-Q1 — trusted question view inside a bound-Session game panel.
 *
 * Proves, against the installed DSH build:
 *   1. a real Agent turn (driven by the probe's scripted local model, NOT a real
 *      DeepSeek model call) calls the native `ask_user_question` tool and its
 *      open request reaches the browser through the native forwarded waterfall;
 *   2. the native `dsh-client-ui-user-questions` plugin is the only waterfall
 *      listener, and it publishes a **live PendingQuestion object** into
 *      `uiSession.sessionStatus` for the bound Session;
 *   3. a third-party `dsh.client` package can read that live object and settle
 *      the open request with `pending.answer({ answers })` while a non-
 *      conversation main panel ("game panel") owns the view and the native
 *      composer is unmounted;
 *   4. the same `callId` settles in the native Session log (tool/call ->
 *      tool/result with the submitted answers), the turn continues and ends,
 *      and the projection/status clear.
 *
 * Exit code is non-zero when a required check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createReport, ensureRuntime, runtimeIdentity, writeJson } from '../lib/harness.mjs';
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
} from './lib/probe.mjs';

const PORT = Number(process.env.DSH_V15_Q1_PORT || 58172);
const CDP_PORT = Number(process.env.DSH_V15_Q1_CDP || 9476);
const HOME_NAME = 'questions-q1';
const RUN_DIR = path.join(SCRATCH, 'q1');
const CWD = path.join(SCRATCH, 'cwd');
const BATCH = { answers: [{ id: 'probe-q1', selected: ['QPROBE_OPT_A'] }] };

const report = createReport({
  id: 'S-Q1',
  title: 'Trusted question view: third-party Client settles an open ask_user_question inside a bound-Session game panel',
  commands: ['node scripts/verification/v1.5/questions/q1-open-in-game-panel.mjs'],
});

ensureRuntime();
const identity = runtimeIdentity();
report.record('runtimeIdentity', identity);

const home = await prepareHome(HOME_NAME, { port: PORT, dir: RUN_DIR });
const host = await bootHost(home, { port: PORT, logName: 'questions-q1-host' });
const bridge = new HostBridge(RUN_DIR);
const evidence = {
  runtime: identity,
  method: 'scripted local model (provider qprobe) drives a real Agent turn through the native ask_user_question tool',
  notProven: 'NOT a real DeepSeek model call: the isolated profile has no model credentials, so a local scripted LLM adapter replaces the model. The tool/service/waterfall/UI path is the native one.',
  hostUrl: host.url.replace(/token=.*/, 'token=<redacted>'),
  profilePatch: null,
  hostState: null,
  steps: {},
};
let page = null;

try {
  const opened = await openProbePage(host, { cdpPort: CDP_PORT });
  page = opened.page;
  report.add('probe Client module materialized in a real DSH page', opened.bootstrapped, { readyMs: opened.readyMs });
  if (!opened.bootstrapped) throw new Error('probe Client module did not materialize');

  evidence.hostState = bridge.hostState();
  report.add('probe Host registered the scripted LLM adapter', evidence.hostState?.probe?.adapterRegistered === true, evidence.hostState?.probe);
  const runtime = await page.eval('window.__QPROBE__.runtime()');
  evidence.steps.runtime = runtime;
  report.add('probe Client control surface available', runtime?.probeVersion === 1, runtime && { probeVersion: runtime.probeVersion });

  // --- create + bind a real Session --------------------------------------
  const created = await page.eval(`window.__QPROBE__.createSession(${JSON.stringify(CWD)})`);
  evidence.steps.createSession = created;
  const sessionId = created?.result?.value?.sessionId ?? null;
  report.add('session/create accepted with a host-owned cwd', Boolean(sessionId), created);
  if (sessionId === null) throw new Error('no session id from session/create');

  await page.eval(`window.__QPROBE__.openSession(${JSON.stringify(sessionId)})`);
  const bound = await untilProbe(
    page,
    `window.__QPROBE__.sessions().mainSessionId === ${JSON.stringify(sessionId)}`,
    20000,
  );
  // The conversation shell mounts after the binding lands.
  await untilProbe(page, 'window.__QPROBE__.domSignals().composerEditorCount >= 1', 15000);
  const domConversation = await page.eval('window.__QPROBE__.domSignals()');
  evidence.steps.conversationView = { bound: bound !== null, dom: domConversation };
  report.add('created Session is bound to the main view', bound !== null, evidence.steps.conversationView);
  report.record('conversation view DOM before the question', domConversation);

  // --- scripted open question through the native tool ---------------------
  await bridge.setScenario({ mode: 'open' });
  const prompted = await page.eval(`window.__QPROBE__.promptSession(${JSON.stringify(sessionId)}, 'QPROBE_Q1_RUN')`);
  evidence.steps.prompt = prompted;
  report.add('session/prompt accepted (a real Agent turn starts)', prompted?.result?.value?.accepted === true, prompted);

  const pendingSeen = await untilProbe(
    page,
    `window.__QPROBE__.statusOf(${JSON.stringify(sessionId)}) && window.__QPROBE__.statusOf(${JSON.stringify(sessionId)}).hasPendingObject`,
    45000,
    300,
  );
  const pendingStatus = await page.eval(`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})`);
  const pendingType = await page.eval(`window.__QPROBE__.pendingType(${JSON.stringify(sessionId)})`);
  evidence.steps.pending = { status: pendingStatus, type: pendingType };
  report.add('live native PendingQuestion published to uiSession.sessionStatus', pendingSeen !== null && pendingStatus?.hasPendingObject === true, pendingStatus);
  report.add('pending question is an open waterfall request', pendingStatus?.pending?.snapshot?.state === 'open' && pendingStatus?.pending?.snapshot?.channel === 'waterfall' && pendingStatus?.pending?.hasWaterfall === true, pendingStatus?.pending?.snapshot);
  // The shipped `standard` preset composes the legacy *blocking* ask_user_question
  // tool: its request carries no `wait`, so the native card is unnamed, cannot be
  // keyed by a tool call, and cancels (not hides) when dismissed.
  report.add(
    'blocking/open request: native card is unnamed (no callId) and cancel-on-dismiss',
    pendingStatus?.pending?.callId === null && pendingStatus?.pending?.dismissal === 'cancel',
    { callId: pendingStatus?.pending?.callId, dismissal: pendingStatus?.pending?.dismissal, key: pendingStatus?.pending?.key },
  );
  const callId = pendingStatus?.pending?.callId ?? null;
  report.add('PendingQuestion exposes answer/dismiss/delegate/snapshot methods', Array.isArray(pendingType?.methodNames) && ['answer', 'dismiss', 'delegate', 'snapshot', 'hasWaterfall'].every((name) => pendingType.methodNames.includes(name)), pendingType);

  const domWithQuestion = await page.eval('window.__QPROBE__.domSignals()');
  evidence.steps.nativeQuestionVisible = domWithQuestion;
  report.add('native question card renders in the conversation view (native UI present at the same time)', domWithQuestion.questionTextVisible === true, domWithQuestion);
  if (page) await page.shot(path.join(RAW_DIR, 'q1-conversation-question.png'));

  // --- game panel replaces the conversation view ---------------------------
  const selected = await page.eval('window.__QPROBE__.selectGamePanel()');
  const panelSeen = await untilProbe(page, 'window.__QPROBE__.domSignals().probePanelVisible === true', 10000);
  const domGamePanel = await page.eval('window.__QPROBE__.domSignals()');
  evidence.steps.gamePanel = { selected, panelSeen: panelSeen !== null, dom: domGamePanel };
  report.add('game panel selected via ctx.layout.selectPanel', panelSeen !== null && domGamePanel.probePanelVisible === true, selected);
  report.add('native composer is unmounted while the game panel owns the main view', domGamePanel.composerEditorCount === 0, domGamePanel);
  report.add('game panel is bound to the same Session', selected?.boundSessionId === sessionId, { boundSessionId: selected?.boundSessionId, sessionId });
  const pendingInPanel = await page.eval(`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})`);
  evidence.steps.pendingInGamePanel = pendingInPanel;
  report.add('open PendingQuestion still live and answerable while the game panel owns the view', pendingInPanel?.hasPendingObject === true && pendingInPanel?.pending?.hasWaterfall === true, pendingInPanel);
  if (page) await page.shot(path.join(RAW_DIR, 'q1-game-panel.png'));

  // --- settle the open request from the third-party panel ------------------
  const answered = await page.eval(
    `window.__QPROBE__.answerPending(${JSON.stringify(sessionId)}, ${JSON.stringify(BATCH)})`,
  );
  evidence.steps.answered = answered;
  report.add('third-party Client settled the open question through pending.answer(batch)', answered?.ok === true, answered);

  const idle = await bridge.waitIdle(sessionId, 45000);
  evidence.steps.idle = idle;
  report.add('Agent turn finished after settlement', idle.idle === true, idle);

  const events = await bridge.events(sessionId);
  evidence.steps.events = eventSummary(events);
  const askCall = findAskCall(events);
  const askResult = askCall === undefined ? undefined : findAskResult(events, askCall.callId);
  report.add('native Session recorded the ask_user_question tool call', Boolean(askCall), askCall);
  const askCallCount = events.filter((event) => event.type === 'tool/call' && event.name === 'ask_user_question').length;
  report.add('Session recorded exactly one native ask call to settle', askCallCount === 1, { askCallCount, toolCallId: askCall?.callId, pendingCallId: callId });
  report.add(
    'native Session recorded the tool result with the submitted answer (same callId)',
    askResult !== undefined && askResult.result?.pending !== true && askResult.result?.answers?.[0]?.id === 'probe-q1' && askResult.result.answers[0].selected?.[0] === 'QPROBE_OPT_A',
    askResult,
  );
  const stepStarts = events.filter((event) => event.type === 'step/start').length;
  const turnStarts = events.filter((event) => event.type === 'turn/start').length;
  const turnEnds = events.filter((event) => event.type === 'turn/end').length;
  const assistantMessages = events.filter((event) => event.type === 'assistant/message').length;
  report.add('same turn continued after the tool result (>= 2 model steps, one turn)', stepStarts >= 2 && turnStarts === 1 && turnEnds === 1, { stepStarts, turnStarts, turnEnds, assistantMessages });
  report.add('final assistant message recorded in the Session', assistantMessages >= 1, { assistantMessages });

  const projection = await bridge.projection(sessionId);
  evidence.steps.projection = projection;
  // The `userQuestions` Session projection only folds *timed* ask calls
  // (`request/header` tools must declare `timeout`). The shipped standard preset
  // composes the legacy blocking schema, so this open call is not tracked there:
  // no active row, no settled row. A third-party consumer therefore cannot
  // rebuild a blocking question from the projection.
  report.add(
    'blocking/open call is not tracked by the userQuestions projection (only timed calls are)',
    projection.active.length === 0 && projection.settled.length === 0,
    projection,
  );
  const statusAfter = await page.eval(`window.__QPROBE__.statusOf(${JSON.stringify(sessionId)})`);
  evidence.steps.statusAfter = statusAfter;
  report.add('pending interaction cleared from uiSession.sessionStatus', statusAfter?.hasPendingObject === false, statusAfter);

  const final = report.finish({ evidence });
  writeRaw('q1-open-in-game-panel.json', final);
  writeJson(path.join(RAW_DIR, 'q1-open-in-game-panel.json'), final);
  fs.rmSync(path.join(RAW_DIR, 'q1-open-in-game-panel-failure.json'), { force: true });
  console.log(JSON.stringify({ passed: final.passed, failed: final.failed, checks: final.checks.map((check) => [check.name, check.ok]) }, null, 2));
  try {
    page?.dispose();
  } catch {
    /* ignore */
  }
  await host.stop();
  process.exit(final.passed ? 0 : 1);
} catch (error) {
  evidence.hostLogTail = host.log().split('\n').slice(-80).join('\n');
  report.add('probe completed without an uncaught error', false, String(error && error.stack ? error.stack.split('\n').slice(0, 6).join('\n') : error));
  const final = report.finish({ evidence });
  writeJson(path.join(RAW_DIR, 'q1-open-in-game-panel-failure.json'), final);
  console.error(JSON.stringify({ passed: false, failed: final.failed, error: String(error && error.message) }, null, 2));
  console.error(evidence.hostLogTail);
  try {
    page?.dispose();
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
  await host.stop();
}
