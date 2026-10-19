#!/usr/bin/env node
/**
 * S-Q2 (Host half) — `askTimed` / `attachWait` ownership and deadline semantics.
 *
 * A separate isolated Host with exactly one live root Agent and **no browser
 * connected** is used on purpose: this isolates the Host-side wait ownership
 * rules from any Client claim, so the probe can measure:
 *
 *   1. an unanswered `askTimed` settles as `{ pending: true }` at its own Host
 *      deadline when nobody holds a claim (Host owns the deadline);
 *   2. a Client-side claim obtained through `attachWait` suspends the Host
 *      deadline: the call does NOT settle while the claim is held, even after
 *      the nominal deadline passed;
 *   3. releasing the claim re-arms the Host timer and the call settles
 *      immediately afterwards;
 *   4. `attachWait` yields the Host-computed remaining duration and yields no
 *      frame at all for a call that has no live foreground wait.
 *
 * No browser is involved: the Agent is created by the probe Host bundle through
 * the native `ctx.agents.create`, and the question is issued through the native
 * `ctx.userQuestions` service, so this is a Host service probe (not a model
 * turn, not UI evidence).
 *
 * Exit code is non-zero when a required check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createReport, ensureRuntime, runtimeIdentity, writeJson, sleep } from '../lib/harness.mjs';
import {
  HostBridge,
  SCRATCH,
  RAW_DIR,
  bootHost,
  prepareHome,
  writeRaw,
  sleepMs,
} from './lib/probe.mjs';

const PORT = Number(process.env.DSH_V15_Q2B_PORT || 58176);
const HOME_NAME = 'questions-q2b';
const RUN_DIR = path.join(SCRATCH, 'q2b');
const CWD = path.join(SCRATCH, 'cwd');

const report = createReport({
  id: 'S-Q2b',
  title: 'askTimed/attachWait ownership and deadline semantics (Host service, no browser)',
  commands: ['node scripts/verification/v1.5/questions/q2b-attach-wait.mjs'],
});

ensureRuntime();
const identity = runtimeIdentity();
report.record('runtimeIdentity', identity);

const home = await prepareHome(HOME_NAME, { port: PORT, dir: RUN_DIR });
const host = await bootHost(home, { port: PORT, logName: 'questions-q2b-host' });
const bridge = new HostBridge(RUN_DIR);
const evidence = {
  runtime: identity,
  method: 'native ctx.userQuestions.askTimed + attachWait through the probe Host bundle; no browser/UI connected',
  hostUrl: host.url.replace(/token=.*/, 'token=<redacted>'),
  steps: {},
};

try {
  // Wait for the Host probe to report its adapter/preset state.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (bridge.hostState()?.probe?.adapterRegistered === true) break;
    await sleep(200);
  }
  report.add('probe Host adapter registered', bridge.hostState()?.probe?.adapterRegistered === true, bridge.hostState()?.probe);

  const spawned = await bridge.command({
    cmd: 'create-agent',
    sessionId: `qprobe-q2b-${Date.now().toString(36)}`,
    cwd: CWD,
  });
  const agentId = spawned.result?.result?.agentId;
  evidence.steps.createdAgent = spawned.result;
  report.add('live root Agent created through the native agents service', typeof agentId === 'string' && agentId.length > 0, spawned.result);
  if (agentId === undefined) throw new Error('no live agent for the attachWait probe');

  // -------------------------------------------------------------------------
  // 1. Baseline: no claim, Host deadline settles the call as pending.
  // -------------------------------------------------------------------------
  const baselineCallId = `qprobe_noclaim_${Date.now().toString(36)}`;
  const baselineStarted = bridge.start(
    { cmd: 'ask-timed-direct', agentId, timeoutMs: 800, callId: baselineCallId },
    { label: 'ask-timed-noclaim' },
  );
  const baselineStartedAt = Date.now();
  const baseline = await bridge.settle(baselineStarted.name, { timeoutMs: 20000 });
  const baselineElapsed = Date.now() - baselineStartedAt;
  evidence.steps.baseline = { result: baseline, elapsedMs: baselineElapsed };
  report.add(
    'unclaimed askTimed settles as pending at the Host deadline',
    baseline.ok === true && baseline.result?.pending === true && baselineElapsed >= 700 && baselineElapsed <= 5000,
    { elapsedMs: baselineElapsed, result: baseline.result },
  );
  // -------------------------------------------------------------------------
  // 2. A held attachWait claim suspends the Host deadline.
  // -------------------------------------------------------------------------
  const claimCallId = `qprobe_claim_${Date.now().toString(36)}`;
  const claimAsk = bridge.start(
    { cmd: 'ask-timed-direct', agentId, timeoutMs: 1500, callId: claimCallId },
    { label: 'ask-timed-claim' },
  );
  const claimAskStartedAt = Date.now();
  await sleep(400);
  const claimWait = bridge.start(
    { cmd: 'attach-wait', agentId, callId: claimCallId, holdMs: 2500 },
    { label: 'attach-wait-claim' },
  );

  // Past the nominal deadline (1500ms) while the claim is still held: the call
  // must not have settled.
  await sleep(1300);
  const heldPastDeadline = Date.now() - claimAskStartedAt;
  const placeholder = JSON.parse(fs.readFileSync(claimAsk.resultPath, 'utf8'));
  evidence.steps.claim = { heldPastDeadline, resultWhileHeld: placeholder };
  report.add(
    'askTimed is still open after its Host deadline while a claim is held',
    placeholder.started === true && heldPastDeadline >= 1600,
    { heldPastDeadline, placeholder },
  );

  const claimResult = await bridge.settle(claimWait.name, { timeoutMs: 20000 });
  const claimReleasedAt = Date.now();
  const claim = claimResult.result;
  evidence.steps.claimResult = { claim, claimReleasedAt };
  report.add('attachWait attached to the live foreground wait', claim?.attached === true, claim);
  report.add(
    'attachWait yields the Host-computed remaining duration',
    Array.isArray(claim?.frames) && claim.frames.length >= 1 && claim.frames[0].remainingMs > 0 && claim.frames[0].remainingMs <= 1500,
    claim?.frames,
  );

  const claimAskResult = await bridge.settle(claimAsk.name, { timeoutMs: 20000 });
  const releasedToSettle = Date.now() - claimReleasedAt;
  evidence.steps.claimAsk = { result: claimAskResult, releasedToSettle, totalElapsedMs: Date.now() - claimAskStartedAt };
  report.add(
    'releasing the claim re-arms the Host timer and the call settles as pending right after',
    claimAskResult.ok === true && claimAskResult.result?.pending === true && releasedToSettle <= 3000,
    { releasedToSettle, result: claimAskResult.result },
  );
  report.add(
    'the call lived past its nominal deadline because the claim owned the wait',
    (claimAskResult.result?.elapsedMs ?? 0) >= 1600,
    { elapsedMs: claimAskResult.result?.elapsedMs, timeoutMs: 1500 },
  );

  // -------------------------------------------------------------------------
  // 3. attachWait without a live foreground wait yields no frame.
  // -------------------------------------------------------------------------
  const noWait = await bridge.command(
    { cmd: 'attach-wait', agentId, callId: `qprobe_missing_${Date.now().toString(36)}`, holdMs: 200 },
    { timeoutMs: 15000 },
  );
  const noWaitResult = noWait.result?.result;
  evidence.steps.noWait = noWaitResult;
  report.add(
    'attachWait for a call without a live wait yields no frame',
    noWait.result?.ok === true && noWaitResult?.attached === false && Array.isArray(noWaitResult.frames) && noWaitResult.frames.length === 0,
    noWaitResult,
  );

  const final = report.finish({ evidence });
  writeRaw('q2b-attach-wait.json', final);
  writeJson(path.join(RAW_DIR, 'q2b-attach-wait.json'), final);
  fs.rmSync(path.join(RAW_DIR, 'q2b-attach-wait-failure.json'), { force: true });
  console.log(JSON.stringify({ passed: final.passed, failed: final.failed, checks: final.checks.map((item) => [item.name, item.ok]) }, null, 2));
  await host.stop();
  process.exit(final.passed ? 0 : 1);
} catch (error) {
  evidence.hostLogTail = host.log().split('\n').slice(-80).join('\n');
  report.add('probe completed without an uncaught error', false, String(error && error.stack ? error.stack.split('\n').slice(0, 8).join('\n') : error));
  const final = report.finish({ evidence });
  writeJson(path.join(RAW_DIR, 'q2b-attach-wait-failure.json'), final);
  console.error(JSON.stringify({ passed: false, failed: final.failed, error: String(error && error.message) }, null, 2));
  console.error(evidence.hostLogTail);
  await host.stop();
  process.exit(1);
} finally {
  await host.stop();
}
