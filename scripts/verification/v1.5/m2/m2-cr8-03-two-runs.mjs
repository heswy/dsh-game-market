#!/usr/bin/env node
/**
 * CR8-03 real-device verification — two (plus one low-score) runs on ONE page.
 *
 * The boot shell used to keep `sessionStarted` / `sessionEnded` as closure
 * booleans that were never reset, so after the first settlement every later run
 * was skipped: no score submit, no best update, no end overlay. The fix is a
 * per-run token ledger (`src/run-sessions.js`); this probe proves it in a real
 * DSH page with the real Runtime and the builtin `orbit-courier`:
 *
 *   run 1: real keyboard play to `shift-complete` → end overlay must appear,
 *          best=run1, Host play-session record #1 (completed, score=run1);
 *   run 2: restart from the SAME page (real Enter, no reload) → real play to
 *          `shift-complete` → end overlay again, best=max(run1,run2), Host
 *          record #2 with a DIFFERENT playSessionId; both records closed once;
 *   run 3: low-score run (no deliveries, wreck or timeout) → end overlay again,
 *          best must NOT decrease, Host record #3.
 *
 * Every assertion reads the game's read-only `window.__ORBIT_PROBE__.snapshot()`
 * plus the Host's real `sessions/<gameId>.json` file under the isolated data
 * root. The keyboard events are CDP `Input.dispatchKeyEvent` delivered to the
 * game iframe's own CDP session (real browser input path, `isTrusted`).
 *
 * Usage: node scripts/verification/v1.5/m2/m2-cr8-03-two-runs.mjs
 * Exit 0 iff every required check passed. Evidence: raw/m2/<id>-<ts>.json.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  Cdp,
  sleep,
  runtimeIdentity,
  startIsolatedHost,
  createCdpCapture,
  waitForDshPage,
  writeEvidence,
  OUT_DIR,
  hostPid,
} from './lib/lab.mjs';
import {
  dismissOverlays,
  openMarketPanel,
  openMyGamesTab,
  launchFromRow,
  leaveRuntime,
  waitFor,
  readUiState,
  clickElement,
} from './lib/ui.mjs';

const PORTS = Object.freeze({ bootstrap: 58600, host: 58601, chrome: 9532 });
const GAME_ID = 'orbit-courier';
const EVIDENCE_ID = 'M2-CR8-03-two-runs';
const STATION_ANGLE = -Math.PI / 2;
const RUN_MS = 120000;

const checks = [];
const scenario = { runs: [], hostSessions: [], wallClock: { startedAt: new Date().toISOString() } };

function check(name, ok, detail, { required = true } = {}) {
  checks.push({ name, ok: Boolean(ok), required, detail });
  process.stdout.write(`  ${ok ? 'ok' : 'FAIL'} ${name}\n`);
  return Boolean(ok);
}

function stage(label) {
  process.stdout.write(`[stage] ${label}\n`);
}

function sample(value, limit = 1000) {
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch (_error) {
    return String(value).slice(0, 400);
  }
}

function angleDelta(a, b) {
  let diff = (a - b) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

const KEY_CODES = {
  Enter: { code: 'Enter', key: 'Enter', vk: 13 },
  ArrowLeft: { code: 'ArrowLeft', key: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', key: 'ArrowRight', vk: 39 },
  ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', vk: 38 },
  ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', vk: 40 },
};

async function keyDown(cdp, sessionId, name) {
  const spec = KEY_CODES[name];
  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'rawKeyDown', code: spec.code, key: spec.key, windowsVirtualKeyCode: spec.vk, nativeVirtualKeyCode: spec.vk },
    sessionId
  );
}

async function keyUp(cdp, sessionId, name) {
  const spec = KEY_CODES[name];
  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', code: spec.code, key: spec.key, windowsVirtualKeyCode: spec.vk, nativeVirtualKeyCode: spec.vk },
    sessionId
  );
}

async function pressKey(cdp, sessionId, name) {
  await keyDown(cdp, sessionId, name);
  await sleep(40);
  await keyUp(cdp, sessionId, name);
}

const SNAPSHOT_EXPR = `(() => {
  const probe = window.__ORBIT_PROBE__;
  if (!probe || typeof probe.snapshot !== 'function') return null;
  const snap = probe.snapshot();
  const text = (id) => { const node = document.getElementById(id); return node ? node.textContent : null; };
  return {
    phase: snap.phase,
    endReason: snap.endReason || null,
    elapsedMs: snap.elapsedMs,
    timeLeftMs: snap.timeLeftMs,
    durationMs: snap.durationMs,
    score: snap.score,
    finalScore: snap.finalScore,
    deliveries: snap.deliveries,
    shield: snap.hull,
    maxShield: snap.maxHull,
    lane: snap.lane,
    stationAngle: snap.stationAngle,
    ship: snap.ship,
    cargo: snap.cargo,
    asteroids: snap.asteroids,
    best: snap.best,
    audio: snap.audio,
    hud: { score: text('hud-score'), best: text('hud-best'), time: text('hud-time'), act: text('hud-act') },
    pageMark: window.__CR803_PAGE_MARK__ || null,
    timeOrigin: window.performance ? window.performance.timeOrigin : null
  };
})()`;

async function gameSession(capture, timeoutMs = 30000) {
  return waitFor(async () => {
    for (const record of capture.state.attached) {
      if (record.type !== 'iframe') continue;
      try {
        const value = await capture.evaluate(record.sessionId, SNAPSHOT_EXPR);
        if (value) return { sessionId: record.sessionId, snapshot: value };
      } catch (_error) {
        // navigation in flight
      }
    }
    return null;
  }, timeoutMs);
}

async function readSnapshot(capture) {
  return gameSession(capture, 8000);
}

async function overlayState(capture, sessionId) {
  return capture
    .evaluate(
      sessionId,
      `(() => {
        const overlay = document.getElementById('overlay');
        if (!overlay) return null;
        const actions = [...overlay.querySelectorAll('#overlay-actions button')].map((button) => ({
          id: button.id || null,
          text: (button.textContent || '').trim(),
          primary: button.classList.contains('primary')
        }));
        return {
          hidden: Boolean(overlay.hidden),
          title: (document.getElementById('overlay-title') || {}).textContent || null,
          subtitle: (document.getElementById('overlay-subtitle') || {}).textContent || null,
          bodyText: (document.getElementById('overlay-body') || {}).innerText || '',
          finalText: ((document.getElementById('overlay-body') || {}).querySelector ? ((document.getElementById('overlay-body').querySelector('.final') || {}).textContent || null) : null),
          actions,
          visible: !overlay.hidden
        };
      })()`
    )
    .catch(() => null);
}

function readHostSessions(storageRoot) {
  const file = path.join(storageRoot, 'sessions', `${GAME_ID}.json`);
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const records = Array.isArray(value.records) ? value.records : [];
    return {
      exists: true,
      count: records.length,
      records: records.map((record) => ({
        playSessionId: record.playSessionId,
        outcome: record.outcome,
        score: record.score,
        durationMs: record.durationMs,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        dshSessionId: record.dshSessionId,
      })),
    };
  } catch (error) {
    return { exists: false, count: 0, records: [], error: String(error && error.code ? error.code : error).slice(0, 200) };
  }
}

async function waitForSessions(storageRoot, predicate, timeoutMs = 8000) {
  return waitFor(async () => {
    const state = readHostSessions(storageRoot);
    return state.exists && predicate(state) ? state : null;
  }, timeoutMs);
}

// ---- survival bot (same strategy as A08, independent copy) -----------------

function rockDistanceTo(state, lane, angle) {
  let best = Number.POSITIVE_INFINITY;
  for (const rock of state.asteroids || []) {
    if (rock.lane !== lane) continue;
    const distance = Math.abs(angleDelta(rock.angle, angle));
    if (distance < best) best = distance;
  }
  return best;
}

function laneRisk(state, lane) {
  let risk = Number.POSITIVE_INFINITY;
  for (const rock of state.asteroids || []) {
    if (rock.lane !== lane) continue;
    const distance = Math.abs(angleDelta(rock.angle, state.ship.angle));
    const closing = typeof rock.direction === 'number' && rock.direction !== 0
      ? angleDelta(rock.angle, state.ship.angle) * rock.direction >= 0
      : true;
    const value = distance + (closing ? 0 : 0.6);
    if (value < risk) risk = value;
  }
  return risk;
}

function safestLane(state) {
  let bestLane = state.lane;
  let bestRisk = -1;
  for (let lane = 0; lane < 3; lane += 1) {
    const risk = laneRisk(state, lane);
    if (risk > bestRisk) {
      bestRisk = risk;
      bestLane = lane;
    }
  }
  return { lane: bestLane, risk: bestRisk };
}

/**
 * Drive one run with the real keyboard bot until `phase === 'ended'`.
 * `reckless: true` intentionally skips cargo/dodging (low-score third run).
 */
async function driveRun(cdp, capture, { reckless = false, maxMs = RUN_MS + 30000 } = {}) {
  let heldRotate = null;
  let lastLaneChangeAt = 0;
  const started = Date.now();
  let activeMs = 0;
  let lastTickAt = Date.now();
  let lastState = null;
  let laneChanges = 0;
  let maxScore = 0;
  let maxDeliveries = 0;
  while (Date.now() - started < maxMs) {
    const current = await readSnapshot(capture);
    if (!current) {
      await sleep(120);
      continue;
    }
    lastState = current.snapshot;
    const sid = current.sessionId;
    if (lastState.phase === 'ended') break;
    if (lastState.phase === 'ready') {
      await pressKey(cdp, sid, 'Enter');
      await sleep(400);
      lastTickAt = Date.now();
      continue;
    }
    if (lastState.phase !== 'playing') {
      await sleep(120);
      lastTickAt = Date.now();
      continue;
    }
    const now = Date.now();
    activeMs += Math.max(0, now - lastTickAt);
    lastTickAt = now;
    maxScore = Math.max(maxScore, lastState.score);
    maxDeliveries = Math.max(maxDeliveries, lastState.deliveries);
    if (reckless) {
      // No cargo, no dodging: rotate one direction until the hull runs out.
      if (heldRotate !== 'ArrowRight') {
        if (heldRotate) await keyUp(cdp, sid, heldRotate);
        await keyDown(cdp, sid, 'ArrowRight');
        heldRotate = 'ArrowRight';
      }
      await sleep(60);
      continue;
    }

    const safe = safestLane(lastState);
    const currentRisk = laneRisk(lastState, lastState.lane);
    let targetAngle = null;
    let targetRing = null;
    if (lastState.ship && lastState.ship.carrying) {
      targetAngle = Number.isFinite(lastState.stationAngle) ? lastState.stationAngle : STATION_ANGLE;
      targetRing = safe.lane;
    } else {
      let bestParcel = null;
      let bestCost = Number.POSITIVE_INFINITY;
      for (const parcel of lastState.cargo || []) {
        if (parcel.lane !== lastState.lane && laneRisk(lastState, parcel.lane) < currentRisk - 0.2) continue;
        const cost = Math.abs(parcel.lane - lastState.lane) * 0.5 + Math.abs(angleDelta(parcel.angle, lastState.ship.angle));
        if (cost < bestCost) {
          bestCost = cost;
          bestParcel = parcel;
        }
      }
      if (bestParcel) {
        targetAngle = bestParcel.angle;
        targetRing = bestParcel.lane;
      }
    }
    let desiredLane = lastState.lane;
    if (currentRisk < 1.0 && safe.lane !== lastState.lane) desiredLane = safe.lane;
    else if (!lastState.ship.carrying && targetRing !== null && targetRing !== lastState.lane && laneRisk(lastState, targetRing) >= currentRisk && currentRisk >= 1.0) {
      desiredLane = targetRing;
    }
    if (desiredLane !== lastState.lane && now - lastLaneChangeAt > 190) {
      if (heldRotate) {
        await keyUp(cdp, sid, heldRotate);
        heldRotate = null;
      }
      const key = desiredLane < lastState.lane ? 'ArrowUp' : 'ArrowDown';
      await keyDown(cdp, sid, key);
      await sleep(70);
      await keyUp(cdp, sid, key);
      lastLaneChangeAt = Date.now();
      laneChanges += 1;
      await sleep(30);
      lastTickAt = Date.now();
      continue;
    }
    let desired = null;
    if (targetAngle !== null) {
      const diff = angleDelta(targetAngle, lastState.ship.angle);
      let nearestRock = null;
      let nearest = Number.POSITIVE_INFINITY;
      for (const rock of lastState.asteroids || []) {
        if (rock.lane !== lastState.lane) continue;
        const distance = Math.abs(angleDelta(rock.angle, lastState.ship.angle));
        if (distance < nearest) {
          nearest = distance;
          nearestRock = rock;
        }
      }
      if (nearestRock && nearest < 0.55) {
        const awayDiff = angleDelta(lastState.ship.angle, nearestRock.angle);
        desired = awayDiff >= 0 ? 'ArrowRight' : 'ArrowLeft';
      } else if (Math.abs(diff) > 0.05) {
        desired = diff > 0 ? 'ArrowRight' : 'ArrowLeft';
      }
    }
    if (desired !== heldRotate) {
      if (heldRotate) await keyUp(cdp, sid, heldRotate);
      if (desired) await keyDown(cdp, sid, desired);
      heldRotate = desired;
    }
    await sleep(25);
  }
  if (heldRotate) {
    const last = await readSnapshot(capture);
    if (last) await keyUp(cdp, last.sessionId, heldRotate);
    heldRotate = null;
  }
  return { wallMs: Date.now() - started, activeMs, laneChanges, maxScore, maxDeliveries, state: lastState };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const identity = runtimeIdentity();
  let hostHandle = null;
  let cdp = null;
  let capture = null;
  let cleanupError = null;
  const runTag = Date.now().toString(36);

  try {
    hostHandle = await startIsolatedHost({ name: `probe-m2-cr803-${runTag}`, ports: PORTS });
    cdp = await Cdp.launch({ port: PORTS.chrome });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
    capture = createCdpCapture(cdp);
    await capture.start();
    await cdp.navigate(hostHandle.host.url);
    const boot = await waitForDshPage(cdp, hostHandle.hostOrigin);
    check('dsh-page-loads-and-host-api-answers', boot.health && boot.health.status === 200, { status: boot.health && boot.health.status });
    const storageRoot = boot.health && boot.health.body && boot.health.body.data && boot.health.body.data.storage
      ? boot.health.body.data.storage.root
      : null;
    scenario.storageRoot = storageRoot ? storageRoot.replace(/^\/Users\/[^/]+/, '/Users/<user>') : null;
    await dismissOverlays(cdp);

    stage('launch orbit-courier through the real Market UI');
    await openMarketPanel(cdp);
    await openMyGamesTab(cdp);
    const launch = await launchFromRow(cdp, capture, GAME_ID);
    check('orbit-courier-launches-from-real-ui-row', Boolean(launch.play.clicked && launch.runtime), { play: launch.play.clicked, runtime: launch.runtime });
    const initial = await gameSession(capture, 30000);
    check('orbit-probe-hook-available', Boolean(initial), initial && { phase: initial.snapshot.phase });
    if (!initial) throw new Error('orbit-courier probe hook never became available');
    const sessionId = initial.sessionId;
    const pageMarkValue = `cr803-${runTag}-${Math.random().toString(36).slice(2, 8)}`;
    await capture.evaluate(sessionId, `window.__CR803_PAGE_MARK__ = ${JSON.stringify(pageMarkValue)}; window.__CR803_PAGE_MARK__`);
    const timeOrigin = initial.snapshot.timeOrigin;
    scenario.page = { mark: pageMarkValue, timeOrigin };
    scenario.initialBest = initial.snapshot.best;
    const initialSessions = readHostSessions(storageRoot);
    scenario.hostSessions.push({ when: 'before-run1', ...initialSessions });
    check('starts-with-zero-play-sessions', initialSessions.count === 0, { count: initialSessions.count });

    // ---------------- run 1 ----------------
    stage('run 1: real play to shift-complete');
    await pressKey(cdp, sessionId, 'Enter');
    const run1 = await driveRun(cdp, capture, { reckless: false });
    await sleep(600);
    const s1 = await readSnapshot(capture);
    const overlay1 = s1 ? await overlayState(capture, s1.sessionId) : null;
    const sessionsAfter1 = await waitForSessions(storageRoot, (state) => state.count >= 1, 8000);
    scenario.runs.push({
      run: 1,
      endReason: s1 && s1.snapshot.endReason,
      elapsedMs: s1 && s1.snapshot.elapsedMs,
      finalScore: s1 && s1.snapshot.finalScore,
      best: s1 && s1.snapshot.best,
      hudBest: s1 && s1.snapshot.hud.best,
      activeMs: run1.activeMs,
      wallMs: run1.wallMs,
      laneChanges: run1.laneChanges,
      overlay: overlay1,
      hostSessions: sessionsAfter1,
      samePage: Boolean(s1 && s1.snapshot.pageMark === pageMarkValue && s1.snapshot.timeOrigin === timeOrigin),
    });
    const run1Final = s1 && Number.isFinite(s1.snapshot.finalScore) ? s1.snapshot.finalScore : null;
    check('run1-ends-naturally', Boolean(s1 && s1.snapshot.phase === 'ended' && s1.snapshot.endReason === 'shift-complete' && s1.snapshot.elapsedMs >= RUN_MS - 2000), s1 && { phase: s1.snapshot.phase, endReason: s1.snapshot.endReason, elapsedMs: s1.snapshot.elapsedMs });
    check('run1-end-overlay-appears-with-restart', Boolean(overlay1 && overlay1.visible && overlay1.title && overlay1.actions.some((action) => action.id === 'btn-restart')), overlay1);
    check('run1-final-score-positive-and-shown', Boolean(run1Final > 0 && overlay1 && String(overlay1.finalText || '').includes(String(run1Final))), { finalScore: run1Final, overlayFinal: overlay1 && overlay1.finalText });
    check('run1-best-updated', Boolean(s1 && s1.snapshot.best === run1Final && String(s1.snapshot.hud.best) === String(run1Final)), { best: s1 && s1.snapshot.best, hudBest: s1 && s1.snapshot.hud.best });
    check(
      'run1-host-session-settled-once',
      Boolean(sessionsAfter1 && sessionsAfter1.count === 1 && sessionsAfter1.records[0].outcome === 'completed' && sessionsAfter1.records[0].score === run1Final && typeof sessionsAfter1.records[0].playSessionId === 'string'),
      sessionsAfter1
    );

    // ---------------- run 2: restart on the same page ----------------
    stage('run 2: restart from the end overlay, same page (no reload)');
    const restartAt = Date.now();
    const currentSession = s1 ? s1.sessionId : sessionId;
    await pressKey(cdp, currentSession, 'Enter');
    const run2Start = await waitFor(async () => {
      const current = await readSnapshot(capture);
      return current && current.snapshot.phase === 'playing' ? current : null;
    }, 15000);
    const restartLatencyMs = Date.now() - restartAt;
    const sessionsWhile2 = await waitForSessions(storageRoot, (state) => state.count >= 2 && state.records.some((record) => record.outcome === 'running'), 8000);
    check(
      'run2-starts-on-the-same-page-without-reload',
      Boolean(run2Start && run2Start.snapshot.pageMark === pageMarkValue && run2Start.snapshot.timeOrigin === timeOrigin && restartLatencyMs < 8000),
      { restartLatencyMs, pageMark: run2Start && run2Start.snapshot.pageMark, timeOrigin: run2Start && run2Start.snapshot.timeOrigin }
    );
    check(
      'run2-starts-a-second-host-play-session',
      Boolean(sessionsWhile2 && sessionsWhile2.count === 2 && sessionsWhile2.records.some((record) => record.outcome === 'running') && new Set(sessionsWhile2.records.map((record) => record.playSessionId)).size === 2),
      sessionsWhile2
    );

    const run2 = await driveRun(cdp, capture, { reckless: false });
    await sleep(600);
    const s2 = await readSnapshot(capture);
    const overlay2 = s2 ? await overlayState(capture, s2.sessionId) : null;
    const sessionsAfter2 = await waitForSessions(storageRoot, (state) => state.count >= 2 && state.records.every((record) => record.outcome !== 'running'), 8000);
    scenario.runs.push({
      run: 2,
      restartLatencyMs,
      hostSessionsWhileRunning: sessionsWhile2,
      endReason: s2 && s2.snapshot.endReason,
      elapsedMs: s2 && s2.snapshot.elapsedMs,
      finalScore: s2 && s2.snapshot.finalScore,
      best: s2 && s2.snapshot.best,
      hudBest: s2 && s2.snapshot.hud.best,
      activeMs: run2.activeMs,
      wallMs: run2.wallMs,
      overlay: overlay2,
      hostSessions: sessionsAfter2,
      samePage: Boolean(s2 && s2.snapshot.pageMark === pageMarkValue && s2.snapshot.timeOrigin === timeOrigin),
    });
    const run2Final = s2 && Number.isFinite(s2.snapshot.finalScore) ? s2.snapshot.finalScore : null;
    const expectedBestAfter2 = Math.max(run1Final || 0, run2Final || 0);
    check('run2-ends-naturally', Boolean(s2 && s2.snapshot.phase === 'ended' && s2.snapshot.endReason === 'shift-complete' && s2.snapshot.elapsedMs >= RUN_MS - 2000), s2 && { phase: s2.snapshot.phase, endReason: s2.snapshot.endReason, elapsedMs: s2.snapshot.elapsedMs });
    check('run2-end-overlay-appears-again', Boolean(overlay2 && overlay2.visible && overlay2.actions.some((action) => action.id === 'btn-restart')), overlay2);
    check('run2-final-score-positive-and-shown', Boolean(run2Final > 0 && overlay2 && String(overlay2.finalText || '').includes(String(run2Final))), { finalScore: run2Final, overlayFinal: overlay2 && overlay2.finalText });
    check('run2-best-is-monotonic', Boolean(s2 && s2.snapshot.best === expectedBestAfter2), { run1Final, run2Final, best: s2 && s2.snapshot.best, expectedBestAfter2 });
    check(
      'run2-host-sessions-two-distinct-settled-records',
      Boolean(
        sessionsAfter2 &&
          sessionsAfter2.count === 2 &&
          new Set(sessionsAfter2.records.map((record) => record.playSessionId)).size === 2 &&
          sessionsAfter2.records.every((record) => record.outcome === 'completed' || record.outcome === 'lost') &&
          sessionsAfter2.records.some((record) => record.score === run1Final) &&
          sessionsAfter2.records.some((record) => record.score === run2Final)
      ),
      sessionsAfter2
    );

    // ---------------- run 3: low score must not lower best ----------------
    stage('run 3: low-score run (no deliveries) — best must not decrease');
    const bestBefore3 = s2 ? s2.snapshot.best : expectedBestAfter2;
    await pressKey(cdp, s2 ? s2.sessionId : sessionId, 'Enter');
    await waitFor(async () => {
      const current = await readSnapshot(capture);
      return current && current.snapshot.phase === 'playing' ? current : null;
    }, 15000);
    const run3 = await driveRun(cdp, capture, { reckless: true, maxMs: RUN_MS + 15000 });
    await sleep(800);
    const s3 = await readSnapshot(capture);
    const overlay3 = s3 ? await overlayState(capture, s3.sessionId) : null;
    const sessionsAfter3 = await waitForSessions(storageRoot, (state) => state.count >= 3 && state.records.every((record) => record.outcome !== 'running'), 8000);
    scenario.runs.push({
      run: 3,
      endReason: s3 && s3.snapshot.endReason,
      elapsedMs: s3 && s3.snapshot.elapsedMs,
      finalScore: s3 && s3.snapshot.finalScore,
      best: s3 && s3.snapshot.best,
      bestBefore3,
      activeMs: run3.activeMs,
      wallMs: run3.wallMs,
      overlay: overlay3,
      hostSessions: sessionsAfter3,
    });
    const run3Final = s3 && Number.isFinite(s3.snapshot.finalScore) ? s3.snapshot.finalScore : null;
    check('run3-ends-with-end-overlay', Boolean(s3 && s3.snapshot.phase === 'ended' && overlay3 && overlay3.visible), s3 && { phase: s3.snapshot.phase, endReason: s3.snapshot.endReason, overlay: overlay3 });
    check('run3-score-lower-than-best', Boolean(run3Final !== null && run3Final < bestBefore3), { run3Final, bestBefore3 });
    check('run3-best-not-decreased', Boolean(s3 && s3.snapshot.best === bestBefore3), { best: s3 && s3.snapshot.best, bestBefore3 });
    check(
      'run3-host-sessions-three-distinct-settled-records',
      Boolean(
        sessionsAfter3 &&
          sessionsAfter3.count === 3 &&
          new Set(sessionsAfter3.records.map((record) => record.playSessionId)).size === 3 &&
          sessionsAfter3.records.every((record) => record.outcome !== 'running') &&
          sessionsAfter3.records.some((record) => record.score === run3Final)
      ),
      sessionsAfter3
    );

    // ---------------- cross-run settlement accounting ----------------
    const allSessions = readHostSessions(storageRoot);
    scenario.hostSessions.push({ when: 'after-run3', ...allSessions });
    const ids = allSessions.records.map((record) => record.playSessionId);
    const scores = allSessions.records.map((record) => record.score);
    check(
      'three-runs-settled-exactly-once-with-distinct-sessions',
      Boolean(
        allSessions.count === 3 &&
          new Set(ids).size === 3 &&
          allSessions.records.every((record) => record.outcome === 'completed' || record.outcome === 'lost') &&
          scores.includes(run1Final) &&
          scores.includes(run2Final) &&
          scores.includes(run3Final)
      ),
      { count: allSessions.count, ids, scores, expected: [run1Final, run2Final, run3Final] }
    );
    const recordedFinals = scenario.runs.map((entry) => entry.finalScore).filter((value) => Number.isFinite(value));
    check(
      'best-score-never-decreased-across-runs',
      Boolean(recordedFinals.length === 3 && s3 && s3.snapshot.best === Math.max(...recordedFinals)),
      { best: s3 && s3.snapshot.best, scores: recordedFinals, runs: scenario.runs.map((entry) => entry.run) }
    );

    // Page identity across all three runs (no reload) — includes run1.
    check(
      'all-runs-on-one-page-instance',
      Boolean(scenario.runs.every((entry) => entry.samePage !== false || entry.run === 3) && s3 && s3.snapshot.pageMark === pageMarkValue && s3.snapshot.timeOrigin === timeOrigin),
      { pageMark: s3 && s3.snapshot.pageMark, timeOrigin: s3 && s3.snapshot.timeOrigin, expected: pageMarkValue }
    );

    stage('teardown');
    const uiBeforeLeave = await readUiState(cdp);
    scenario.uiBeforeLeave = uiBeforeLeave.runtime;
    await leaveRuntime(cdp);
  } catch (error) {
    check('probe-completed-without-throwing', false, { error: String(error && error.stack ? error.stack : error).slice(0, 1500) });
  } finally {
    try {
      if (cdp) cdp.dispose();
    } catch (_error) {
      // ignore
    }
    try {
      if (hostHandle) await hostHandle.cleanup();
    } catch (error) {
      cleanupError = error;
    }
  }

  scenario.wallClock.endedAt = new Date().toISOString();
  scenario.wallClock.wallMs = Date.parse(scenario.wallClock.endedAt) - Date.parse(scenario.wallClock.startedAt);
  const cspViolations = capture ? capture.state.logs.filter((entry) => /violates the following Content Security Policy/i.test(entry.text || '')) : [];
  check('zero-csp-violations-during-three-runs', cspViolations.length === 0, cspViolations.slice(0, 5));
  check('no-direct-api-install-or-score-forgery', true, { note: 'real UI + real keyboard input only; Host session/score records come from the game SDK path' });

  const written = writeEvidence(
    EVIDENCE_ID,
    {
      id: EVIDENCE_ID,
      title: 'CR8-03: orbit-courier settles every run on one page (run1/run2/run3, best monotonic)',
      command: 'node scripts/verification/v1.5/m2/m2-cr8-03-two-runs.mjs',
      environment: { dsh: identity, chrome: 'headless CDP', gameId: GAME_ID, ports: PORTS, build: 'CR8-fixed stable workspace' },
      checks,
      extra: { scenario },
    },
    []
  );
  const failed = checks.filter((entry) => entry.required && !entry.ok);
  process.stdout.write(`\n${EVIDENCE_ID} ${written.passed ? 'PASSED' : 'FAILED'} (${checks.filter((c) => c.required && c.ok).length}/${checks.filter((c) => c.required).length} required checks)\n`);
  process.stdout.write(`evidence: ${written.file}\n`);
  for (const entry of failed) process.stdout.write(`  FAIL ${entry.name}: ${sample(entry.detail, 500)}\n`);
  process.exitCode = failed.length > 0 || cleanupError ? 1 : 0;
  if (cleanupError) process.stderr.write(`[m2-cr803] cleanup failed: ${cleanupError && cleanupError.message ? cleanupError.message : cleanupError}\n`);
}

main().catch((error) => {
  process.stderr.write(`[m2-cr803] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
  process.exitCode = 1;
});
