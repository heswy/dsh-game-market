#!/usr/bin/env node
/**
 * CR8-05 self-check — the isolated-host lifecycle must never leak a listener.
 *
 * Parent mode (default) spawns the child three times, once per exit path:
 *   1. `success`         — boot, verify the port accepts, cleanup → exit 0;
 *   2. `assert-failure`  — boot, simulated failed assertion → exit 1, but the
 *                          `finally` still closes the host and the port;
 *   3. `restart-success` — boot, restart on the same data root, verify the old
 *                          child is gone / its port was refused / the new child
 *                          serves, cleanup → exit 0.
 *
 * For every path the parent asserts: natural exit (no kill, within the budget),
 * expected exit code, child-reported cleanup (port refused, home removed, host
 * handle null), recorded PIDs dead, and — independently — the port refused.
 *
 * Usage: node scripts/verification/v1.5/m2/self-check-cleanup.mjs
 * Exit 0 iff all three paths pass. No evidence file is written (CR8-05 keeps
 * docs untouched; the parent prints a machine-readable summary).
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { hostPid, portAccepting, startIsolatedHost } from './lib/lab.mjs';

const SELF = fileURLToPath(import.meta.url);
const IS_CHILD = process.argv.includes('--child');
const CHILD_TIMEOUT_MS = 120000;
const MAX_CHILD_MS = 90000;

function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function line(prefix, text) {
  process.stdout.write(`${prefix} ${text}\n`);
}

// ---------------------------------------------------------------------------
// Child: exercise one lifecycle path in its own process.
// ---------------------------------------------------------------------------
async function runChild() {
  const mode = process.env.SELF_CHECK_MODE;
  const hostPort = Number(process.env.SELF_CHECK_HOST_PORT);
  const bootstrapPort = Number(process.env.SELF_CHECK_BOOTSTRAP_PORT);
  const summary = {
    mode,
    hostPort,
    bootstrapPort,
    startedAt: new Date().toISOString(),
    start: null,
    restart: null,
    simulatedFailedCheck: false,
    cleanup: null,
    failure: null,
    cleanupError: null,
  };
  let exitCode = 0;
  let handle = null;
  try {
    handle = await startIsolatedHost({
      name: `self-check-${mode}-${Date.now().toString(36)}`,
      ports: { bootstrap: bootstrapPort, host: hostPort },
    });
    summary.start = {
      pid: hostPid(handle.host),
      restarts: handle.restarts,
      portAccepting: await portAccepting(hostPort),
      home: handle.home,
    };
    if (summary.start.portAccepting !== true) throw new Error('host port is not accepting after boot');

    if (mode === 'assert-failure') {
      // Simulate a failed assertion: the probe would set exit code 1 and still
      // run its `finally` cleanup path.
      summary.simulatedFailedCheck = true;
      exitCode = 1;
      throw new Error('simulated assertion failure');
    }

    if (mode === 'restart-success') {
      const oldPid = hostPid(handle.host);
      const result = await handle.restart();
      summary.restart = {
        oldPid,
        oldPidAliveAfterRestart: pidAlive(oldPid),
        newPid: hostPid(result.host),
        restarts: handle.restarts,
        closedOld: result.closed,
        portAcceptingAfterRestart: await portAccepting(hostPort),
      };
      if (summary.restart.oldPidAliveAfterRestart) throw new Error('old host child is still alive after restart');
      if (summary.restart.newPid === oldPid) throw new Error('restart did not replace the host child');
      if (summary.restart.portAcceptingAfterRestart !== true) throw new Error('restarted host is not accepting connections');
      if (summary.restart.restarts !== 1) throw new Error(`expected restarts=1, got ${summary.restart.restarts}`);
    }
  } catch (error) {
    if (mode === 'assert-failure' && summary.simulatedFailedCheck) {
      // The simulated failure is the expected path; cleanup still must run.
      summary.failure = { expected: true, message: String(error && error.message ? error.message : error) };
    } else {
      summary.failure = { expected: false, message: String(error && error.message ? error.message : error) };
      exitCode = 1;
    }
  } finally {
    if (handle) {
      try {
        await handle.cleanup();
        const portAcceptingAfter = await portAccepting(hostPort);
        summary.cleanup = {
          restarts: handle.restarts,
          pids: handle.hostPids,
          finalPid: hostPid(handle.host),
          portAcceptingAfter,
          homeExistsAfter: fs.existsSync(handle.home),
          natural: true,
        };
        if (portAcceptingAfter) throw new Error('host port still accepts connections after cleanup');
        if (summary.cleanup.homeExistsAfter) throw new Error('isolated home still exists after cleanup');
        if (summary.cleanup.finalPid !== null) throw new Error('host handle still references a child after cleanup');
      } catch (error) {
        summary.cleanupError = String(error && error.message ? error.message : error);
        exitCode = 1;
      }
    } else {
      summary.cleanup = { skipped: 'host never booted' };
    }
    summary.exitCode = exitCode;
    summary.finishedAt = new Date().toISOString();
    summary.durationMs = Date.parse(summary.finishedAt) - Date.parse(summary.startedAt);
  }
  line('SELF_CHECK_RESULT', JSON.stringify(summary));
  return exitCode;
}

// ---------------------------------------------------------------------------
// Parent: spawn the three paths and assert natural exit + no leftovers.
// ---------------------------------------------------------------------------
function runChildProcess(mode, { hostPort, bootstrapPort }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [SELF, '--child'], {
      env: {
        ...process.env,
        SELF_CHECK_MODE: mode,
        SELF_CHECK_HOST_PORT: String(hostPort),
        SELF_CHECK_BOOTSTRAP_PORT: String(bootstrapPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch (_error) {
        // ignore
      }
    }, CHILD_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ mode, hostPort, bootstrapPort, code, signal, timedOut, durationMs: Date.now() - started, stdout, stderr });
    });
  });
}

async function runParent() {
  const paths = [
    { mode: 'success', hostPort: 58581, bootstrapPort: 58580, expectedExit: 0 },
    { mode: 'assert-failure', hostPort: 58583, bootstrapPort: 58582, expectedExit: 1 },
    { mode: 'restart-success', hostPort: 58585, bootstrapPort: 58584, expectedExit: 0 },
  ];
  const results = [];
  for (const entry of paths) {
    const result = await runChildProcess(entry.mode, entry);
    const summaryLine = result.stdout
      .split('\n')
      .find((text) => text.startsWith('SELF_CHECK_RESULT '));
    let summary = null;
    try {
      summary = summaryLine ? JSON.parse(summaryLine.slice('SELF_CHECK_RESULT '.length)) : null;
    } catch (_error) {
      summary = null;
    }
    const portOpenAfterExit = await portAccepting(result.hostPort);
    const pids = summary
      ? [
          summary.start && summary.start.pid,
          summary.restart && summary.restart.newPid,
        ].filter((pid) => Number.isInteger(pid))
      : [];
    const alivePids = pids.filter(pidAlive);
    const checks = [];
    const assert = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

    assert('child-exited-naturally-within-budget', !result.timedOut && result.durationMs < MAX_CHILD_MS, { durationMs: result.durationMs, timedOut: result.timedOut });
    assert('child-exit-code-as-expected', result.code === entry.expectedExit && result.signal === null, { code: result.code, signal: result.signal, expected: entry.expectedExit });
    assert('child-reported-summary', Boolean(summary), { stderr: result.stderr.slice(-600) });
    if (summary) {
      assert('child-cleanup-closed-final-host', Boolean(summary.cleanup && summary.cleanup.portAcceptingAfter === false), summary.cleanup);
      assert('child-cleanup-removed-home', Boolean(summary.cleanup && summary.cleanup.homeExistsAfter === false), summary.cleanup);
      assert('child-cleanup-null-host-handle', Boolean(summary.cleanup && summary.cleanup.finalPid === null), summary.cleanup);
      assert('child-cleanup-had-no-error', summary.cleanupError === null, { cleanupError: summary.cleanupError });
      if (entry.mode === 'assert-failure') {
        assert('assert-failure-path-was-exercised', summary.simulatedFailedCheck === true && Boolean(summary.failure && summary.failure.expected), summary.failure);
      }
      if (entry.mode === 'restart-success') {
        assert(
          'restart-closed-old-child-before-replacement',
          Boolean(summary.restart && summary.restart.oldPidAliveAfterRestart === false && summary.restart.closedOld && summary.restart.portAcceptingAfterRestart === true && summary.restart.restarts === 1),
          summary.restart
        );
      }
      if (entry.mode === 'success') {
        assert('success-path-had-no-failure', summary.failure === null, summary.failure);
      }
    }
    assert('parent-observed-port-refused-after-exit', portOpenAfterExit === false, { hostPort: entry.hostPort, portOpenAfterExit });
    assert('parent-observed-recorded-pids-dead', alivePids.length === 0, { pids, alivePids });

    const failed = checks.filter((check) => !check.ok);
    results.push({ ...entry, durationMs: result.durationMs, exitCode: result.code, checks, failed: failed.length });
    line(
      failed.length === 0 ? 'ok  ' : 'FAIL',
      `${entry.mode} exit=${result.code} duration=${result.durationMs}ms portClosed=${!portOpenAfterExit} pidsDead=${alivePids.length === 0}`
    );
    for (const check of failed) line('  FAIL', `${check.name}: ${JSON.stringify(check.detail)}`);
    // Safety: never leave a child listener behind even if assertions failed.
    if (portOpenAfterExit) {
      line('warn', `port ${entry.hostPort} still open after child exit; attempting diagnostic only (no host handle in parent)`);
    }
  }
  const failed = results.filter((entry) => entry.failed > 0);
  line('', '');
  line('SELF_CHECK_SUMMARY', JSON.stringify({ passed: failed.length === 0, paths: results.map(({ mode, expectedExit, exitCode, durationMs, failed }) => ({ mode, expectedExit, exitCode, durationMs, failed })) }));
  const overall = { passed: failed.length === 0, paths: results.map(({ mode, expectedExit, exitCode, durationMs, failed }) => ({ mode, expectedExit, exitCode, durationMs, failed })) };
  line('SELF_CHECK_JSON', JSON.stringify(overall));
  return failed.length === 0 ? 0 : 1;
}

if (IS_CHILD) {
  runChild()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`[self-check child] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
      process.exitCode = 1;
    });
} else {
  runParent()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`[self-check] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
      process.exitCode = 1;
    });
}
