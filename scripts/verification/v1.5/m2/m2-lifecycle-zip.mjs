#!/usr/bin/env node
/**
 * M2 F1 · non-builtin ZIP full lifecycle, through the real Market UI.
 *
 * One independent `asset-zip-v2` test package (NOT a builtin, NOT orbit-courier)
 * travels the whole lifetime in a real DSH page:
 *   Market UI click-install 1.0.0 → launch → play/autosave → exit → Continue
 *   → upgrade 1.0.1 via UI → old save still loads → rollback 1.0.0 via UI
 *     (retained directory reused, not rewritten) → old save still Continue
 *   → same-version-different-content must still be 409 (retained tree intact)
 *   → installations.json write failure must not delete the reused directory
 *   → UI uninstall.
 *
 * Every step is a trusted CDP mouse click on the real bundled `client.js`:
 * sidebar → 我的游戏 → row "开始/继续" → runtime back control → upload button →
 * native file chooser (Page.setInterceptFileChooserDialog + DOM.setFileInputFiles)
 * → confirmation dialog. Installs are performed by the Client's own POST; the
 * probe performs no install API call (asserted in evidence).
 *
 * Usage: node scripts/verification/v1.5/m2/m2-lifecycle-zip.mjs [--keep]
 * Exit 0 iff every required check passed. Evidence: raw/m2/<id>-<ts>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  Cdp,
  sleep,
  runtimeIdentity,
  startIsolatedHost,
  createCdpCapture,
  waitForDshPage,
  writeEvidence,
  OUT_DIR,
  WORK,
  screenshot,
} from './lib/lab.mjs';
import {
  findClickable,
  clickElement,
  clickButtonText,
  readUiState,
  dismissOverlays,
  openMarketPanel,
  openMyGamesTab,
  openMarketTab,
  waitForRow,
  runUiInstallFlow,
  launchFromRow,
  leaveRuntime,
  parsedLifecycleEvents,
  waitFor,
  waitForLifecycleEvent,
} from './lib/ui.mjs';
import { startHost } from '../lib/harness.mjs';

import {
  buildLifecyclePackage,
  buildTamperedVersion,
  buildHtmlControl,
  writeFixtureFile,
  sha256,
} from './lib/fixtures.mjs';

const PORTS = Object.freeze({ bootstrap: 58420, host: 58421, chrome: 9522 });
const KEEP = process.argv.includes('--keep');
const GAME_ID = 'm2-life-probe';
const EVIDENCE_ID = 'M2-lifecycle-zip';

const checks = [];
const scenario = { steps: [], fs: {}, saves: {}, versions: {} };

function check(name, ok, detail, { required = true } = {}) {
  checks.push({ name, ok: Boolean(ok), required, detail });
  process.stdout.write(`  ${ok ? 'ok' : 'FAIL'} ${name}\n`);
  return Boolean(ok);
}

function stage(name) {
  process.stdout.write(`[stage] ${name}\n`);
}

function sample(value, limit = 1200) {
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch (_error) {
    return String(value).slice(0, 400);
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_error) {
    return null;
  }
}

/** Deep JSON equality via canonical stringification (small save payloads). */
function sameJson(a, b) {
  const canon = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canon(value[key])}`).join(',')}}`;
  };
  return canon(a) === canon(b);
}

/** Evaluate a snapshot of the lifecycle game in whichever game iframe exists. */
async function readLifeState(capture, { timeoutMs = 30000, predicate = null } = {}) {
  return waitFor(async () => {
    for (const record of capture.state.attached) {
      if (record.type !== 'iframe') continue;
      try {
        const value = await capture.evaluate(
          record.sessionId,
          `(() => {
            const state = window.__M2_LIFE__;
            if (!state) return null;
            return {
              version: state.version,
              phase: state.phase,
              bridgeReady: state.bridgeReady,
              sessionStarted: state.sessionStarted,
              paused: state.paused,
              ticks: state.ticks,
              score: state.score,
              saveAcks: state.saveAcks,
              loadedSave: state.loadedSave,
              lastSave: state.lastSave,
              lastSaveError: state.lastSaveError,
              errors: state.errors
            };
          })()`
        );
        if (value && (!predicate || predicate(value))) return { sessionId: record.sessionId, value };
      } catch (_error) {
        // target gone / navigation in flight
      }
    }
    return null;
  }, timeoutMs);
}

function saveTriplet(event) {
  if (!event || typeof event !== 'object') return null;
  return { version: event.version, ticks: event.ticks, score: event.score };
}

function savedValue(loadedSave) {
  if (!loadedSave || typeof loadedSave !== 'object') return null;
  if (loadedSave.data && loadedSave.data.value && typeof loadedSave.data.value === 'object') return loadedSave.data.value;
  if (loadedSave.value && typeof loadedSave.value === 'object') return loadedSave.value;
  return null;
}

/**
 * Freeze the game clock inside the game and persist the exact payload. The
 * Runtime's own leave protocol then writes the same payload on before-save
 * (ticks are frozen), so Continue can be compared byte-for-byte.
 */
async function freezeAndCaptureSave(cdp, capture) {
  const life = await readLifeState(capture, { predicate: (value) => value.bridgeReady === true });
  let payload = null;
  if (life && life.sessionId) {
    payload = await capture
      .evaluate(life.sessionId, 'window.__M2_LIFE__ && typeof window.__M2_LIFE__.freezeAndSave === "function" ? window.__M2_LIFE__.freezeAndSave() : null')
      .catch(() => null);
  }
  return { payload, life: life && life.value };
}

/** If the runtime opened in the continue (paused) mode, press resume. */
async function resumeIfPaused(cdp) {
  const state = await readUiState(cdp);
  if (!state.runtime || state.runtime.state !== 'paused') return { resumed: false, state };
  // The pause/resume overlay covers the whole runtime, so the real user action
  // is the modal's primary button (its label depends on the launch mode).
  const click = await clickElement(cdp, `document.querySelector('.dgm-overlay .dgm-modal .dgm-btn-primary')`, 'runtime-resume');
  const playing = await waitFor(async () => {
    const current = await readUiState(cdp);
    return current.runtime && (current.runtime.state === 'playing' || current.runtime.state === 'saving') ? current.runtime : null;
  }, 15000);
  return { resumed: Boolean(click.clicked && playing), state: playing };
}

function lastSaveEvent(capture, predicate = null) {
  const events = parsedLifecycleEvents(capture).filter((event) => event.event === 'life-save');
  const filtered = predicate ? events.filter(predicate) : events;
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

async function waitForSaveEvent(capture, predicate, timeoutMs = 20000) {
  return waitFor(() => lastSaveEvent(capture, predicate), timeoutMs);
}

function dirState(dir) {
  try {
    const stats = fs.statSync(dir);
    const entries = fs.readdirSync(dir).sort();
    return { exists: true, mtimeMs: stats.mtimeMs, ino: stats.ino, entries };
  } catch (_error) {
    return { exists: false, mtimeMs: null, ino: null, entries: [] };
  }
}

function storagePaths(storageRoot) {
  return {
    storageRoot,
    installations: path.join(storageRoot, 'installations.json'),
    gameDir: (version) => path.join(storageRoot, 'packages', GAME_ID, version),
    gameRoot: path.join(storageRoot, 'packages', GAME_ID),
  };
}

/** Restart the isolated host on the SAME data root (fresh process state). */
async function restartHost(hostHandle, ports, logName) {
  await hostHandle.host.stop();
  const host = await startHost(hostHandle.home, { port: ports.host, logName });
  hostHandle.host = host;
  hostHandle.hostOrigin = `http://127.0.0.1:${ports.host}`;
  return host;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const identity = runtimeIdentity();
  const secrets = [];
  const runTag = Date.now().toString(36);
  const fixtureDir = path.join(WORK, `m2-lifecycle-${runTag}`);

  let hostHandle = null;
  let cdp = null;
  let capture = null;
  let paths = null;
  let writeLockFile = null;

  try {
    // ------------------------------------------------------------------
    // Fixtures: three real packages + one real html-v1 control.
    // ------------------------------------------------------------------
    const v100 = await buildLifecyclePackage({ gameId: GAME_ID, version: '1.0.0' });
    const v101 = await buildLifecyclePackage({ gameId: GAME_ID, version: '1.0.1' });
    const tampered = await buildTamperedVersion({ gameId: GAME_ID, version: '1.0.1' });
    const v100File = writeFixtureFile(fixtureDir, `${GAME_ID}-1.0.0.dshgame.zip`, v100.zip);
    const v101File = writeFixtureFile(fixtureDir, `${GAME_ID}-1.0.1.dshgame.zip`, v101.zip);
    const tamperedFile = writeFixtureFile(fixtureDir, `${GAME_ID}-1.0.1-tampered.dshgame.zip`, tampered.zip);
    const headHex = (bytes) => Buffer.from(bytes.slice(0, 16)).toString('hex');
    scenario.fixtures = {
      builtOncePerRun: true,
      v100: { file: v100File.fileName, size: v100File.size, sha256: v100File.sha256, head16: headHex(fs.readFileSync(v100File.path)) },
      v101: { file: v101File.fileName, size: v101File.size, sha256: v101File.sha256, head16: headHex(fs.readFileSync(v101File.path)) },
      tampered101: { file: tamperedFile.fileName, size: tamperedFile.size, sha256: tamperedFile.sha256, head16: headHex(fs.readFileSync(tamperedFile.path)) },
    };

    // ------------------------------------------------------------------
    // Boot: isolated DSH host + real Chrome page (real client.js bundle).
    // ------------------------------------------------------------------
    stage('boot-host-and-browser');
    hostHandle = await startIsolatedHost({ name: `probe-m2-lifecycle-${runTag}`, ports: PORTS });
    cdp = await Cdp.launch({ port: PORTS.chrome });
    capture = createCdpCapture(cdp);
    await capture.start();
    await cdp.navigate(hostHandle.host.url);
    const boot = await waitForDshPage(cdp, hostHandle.hostOrigin);
    check('dsh-page-loads-and-host-api-answers', boot.health && boot.health.status === 200, { health: boot.health });
    const storageRoot = boot.health && boot.health.body && boot.health.body.data && boot.health.body.data.storage
      ? boot.health.body.data.storage.root
      : null;
    paths = storagePaths(storageRoot);
    scenario.storageRoot = storageRoot ? storageRoot.replace(/^\/Users\/[^/]+/, '/Users/<user>') : null;
    scenario.dataRoot = { home: hostHandle.home.replace(/^\/Users\/[^/]+/, '/Users/<user>'), freshPerRun: true, runTag };
    check('host-storage-root-visible', Boolean(storageRoot), { storageRoot: scenario.storageRoot });
    check('fresh-isolated-data-root-per-run', Boolean(hostHandle.home && fs.existsSync(storageRoot)), { home: scenario.dataRoot.home, runTag });

    await dismissOverlays(cdp, scenario);
    await openMarketPanel(cdp, scenario);
    const accept = (await readUiState(cdp)).fileInputAccept;
    scenario.pickerAccept = accept;
    check('picker-accepts-dshgame-zip', Boolean(accept && accept.includes('.dshgame.zip')), { accept });

    // ------------------------------------------------------------------
    // 1) UI install 1.0.0 (raw ZIP bytes must reach the Host untouched).
    // ------------------------------------------------------------------
    stage('ui-install-1.0.0');
    const install100 = await runUiInstallFlow(cdp, capture, {
      filePath: v100File.path,
      label: 'install-v100',
      expectFileName: v100File.fileName,
      expectFormatLabel: '资源包',
    });
    scenario.steps.push({ step: 'install-v100', dialog: install100.dialog, request: install100.installEntry ? {
      status: install100.installEntry.status,
      contentType: install100.requestHeaders && install100.requestHeaders['content-type'],
    } : null, response: install100.installResponse });
    const install100Data = install100.installData;
    check('ui-install-1.0.0-200-asset-zip-v2', Boolean(install100Data && install100Data.installation && install100Data.installation.format === 'asset-zip-v2'), install100Data ? { format: install100Data.installation.format, sha256: install100Data.installation.sha256 } : install100.installResponse);
    const body100 = install100.installEntry && install100.installEntry.postDataEntries
      ? Buffer.concat(install100.installEntry.postDataEntries.map((item) => Buffer.from(item.bytes || '', 'base64')))
      : null;
    check(
      'ui-install-1.0.0-upload-bytes-byte-identical',
      Boolean(body100 && body100.length === v100File.size && sha256(body100) === v100File.sha256),
      {
        selectedFile: v100File.fileName,
        uploaded: body100 ? { bytes: body100.length, sha256: sha256(body100), head16: body100.slice(0, 16).toString('hex') } : null,
        source: { bytes: v100File.size, sha256: v100File.sha256, head16: fs.readFileSync(v100File.path).slice(0, 16).toString('hex') },
        bodyFrom: 'Network.postDataEntries(base64)',
      }
    );
    const install100ContentType = install100.requestHeaders && install100.requestHeaders['content-type'];
    check('ui-install-1.0.0-content-type-application-zip', Boolean(String(install100ContentType || '').includes('application/zip')), { contentType: install100ContentType || null });

    // ------------------------------------------------------------------
    // 2) Launch 1.0.0 from the real My Games row; play + autosave.
    // ------------------------------------------------------------------
    await openMyGamesTab(cdp, scenario);
    await waitForRow(cdp, GAME_ID);
    scenario.fs.v100DirAfterInstall = dirState(paths.gameDir('1.0.0'));
    stage('ui-launch-1.0.0');
    const launch100 = await launchFromRow(cdp, capture, GAME_ID);
    scenario.steps.push({ step: 'launch-v100', row: launch100.row, play: { clicked: launch100.play.clicked }, runtime: launch100.runtime });
    check('ui-launch-1.0.0-runtime-stage', Boolean(launch100.runtime && launch100.play.clicked), { play: launch100.play.clicked, runtime: launch100.runtime });
    const life100 = await readLifeState(capture, { predicate: (value) => value.bridgeReady && value.phase === 'playing' });
    scenario.versions.v100 = life100 && life100.value;
    check('game-1.0.0-ready-and-version-marker', Boolean(life100 && life100.value.version === '1.0.0' && life100.value.bridgeReady === true), life100 && life100.value);
    check('game-1.0.0-starts-play-session', Boolean(life100 && life100.value.sessionStarted === true), life100 && { sessionStarted: life100.value.sessionStarted, errors: life100.value.errors });

    // Let the real clock advance and the game autosave a few times.
    const playedFrom = Date.now();
    const intervalSave = await waitForSaveEvent(capture, (event) => event.reason === 'interval', 20000);
    const grown = await waitFor(async () => {
      const state = await readLifeState(capture);
      return state && state.value.ticks >= 20 ? state : null;
    }, 20000);
    scenario.saves.interval1 = intervalSave;
    scenario.playedMsBeforeExit = Date.now() - playedFrom;
    check('game-1.0.0-autosave-interval-observed', Boolean(intervalSave && typeof intervalSave.ticks === 'number' && intervalSave.ticks > 0), intervalSave);
    check('game-1.0.0-score-grows', Boolean(grown && grown.value.score > 0 && grown.value.ticks > 0), grown && { ticks: grown.value.ticks, score: grown.value.score });

    // ------------------------------------------------------------------
    // 3) Exit through the runtime back control (pause + save), then Continue.
    // ------------------------------------------------------------------
    stage('ui-leave-1.0.0');
    const frozen1 = await freezeAndCaptureSave(cdp, capture);
    const exitSave = frozen1.payload;
    scenario.saves.exit1 = exitSave;
    const leave100 = await leaveRuntime(cdp);
    scenario.steps.push({ step: 'leave-v100', click: { clicked: leave100.click.clicked }, runtimeGone: Boolean(leave100.left), frozenSave: exitSave });
    check('exit-through-runtime-back-control', Boolean(leave100.click.clicked && leave100.left), { click: leave100.click, left: Boolean(leave100.left) });
    check('exit-writes-save-before-leaving', Boolean(exitSave && typeof exitSave.ticks === 'number' && typeof exitSave.version === 'string'), exitSave);

    await openMyGamesTab(cdp, scenario);
    const continueRow = await waitFor(async () => {
      const state = await readUiState(cdp);
      const row = state.rows.find((item) => item.id === GAME_ID) || null;
      return row && row.playText.includes('继续') ? row : null;
    }, 20000);
    scenario.steps.push({ step: 'continue-state', row: continueRow });
    check('my-games-shows-continue-after-exit', Boolean(continueRow), continueRow);

    stage('ui-continue-launch');
    const launchContinue = await launchFromRow(cdp, capture, GAME_ID);
    scenario.steps.push({ step: 'launch-continue', play: { clicked: launchContinue.play.clicked }, runtime: launchContinue.runtime });
    const lifeContinue = await readLifeState(capture, { predicate: (value) => value.bridgeReady && value.phase === 'playing' && value.loadedSave !== null });
    scenario.versions.continue = lifeContinue && lifeContinue.value;
    const continueLoadedValue = savedValue(lifeContinue && lifeContinue.value.loadedSave);
    check(
      'continue-loads-exit-save-exactly',
      Boolean(continueLoadedValue && sameJson(continueLoadedValue, saveTriplet(exitSave))),
      { loaded: continueLoadedValue, exitSave: saveTriplet(exitSave), rawLoaded: lifeContinue && lifeContinue.value.loadedSave }
    );
    const resumeContinue = await resumeIfPaused(cdp);
    scenario.steps.push({ step: 'resume-continue', resumed: resumeContinue.resumed, control: resumeContinue.state });
    const continueGrown = await waitFor(async () => {
      const state = await readLifeState(capture);
      return state && exitSave && state.value.ticks > exitSave.ticks ? state : null;
    }, 20000);
    check('continue-resumes-progress', Boolean(continueGrown), { grown: continueGrown && { ticks: continueGrown.value.ticks, score: continueGrown.value.score }, exitTicks: exitSave && exitSave.ticks, resume: resumeContinue.resumed });
    const frozen2 = await freezeAndCaptureSave(cdp, capture);
    scenario.saves.exit2 = frozen2.payload;
    const leaveContinue = await leaveRuntime(cdp);
    scenario.steps.push({ step: 'leave-continue', clicked: leaveContinue.click.clicked, left: Boolean(leaveContinue.left), frozenSave: frozen2.payload });
    check('continue-exit-saves-again', Boolean(frozen2.payload && exitSave && frozen2.payload.ticks >= exitSave.ticks), { exit2: frozen2.payload, exit1: exitSave });

    // ------------------------------------------------------------------
    // 4) Upgrade to 1.0.1 through the UI; old save must still load.
    // ------------------------------------------------------------------
    await openMarketTab(cdp, scenario);
    stage('ui-install-1.0.1');
    const install101 = await runUiInstallFlow(cdp, capture, {
      filePath: v101File.path,
      label: 'install-v101',
      expectFileName: v101File.fileName,
      expectFormatLabel: '资源包',
    });
    scenario.steps.push({ step: 'install-v101', dialog: install101.dialog, request: install101.dialog ? { status: install101.installEntry && install101.installEntry.status } : null, response: install101.installResponse });
    check('ui-install-1.0.1-200-asset-zip-v2', Boolean(install101.installData && install101.installData.installation && install101.installData.installation.format === 'asset-zip-v2'), install101.installData ? { version: install101.installData.version, sha256: install101.installData.installation.sha256 } : install101.installResponse);
    check(
      'ui-install-1.0.1-upload-sha-equals-source',
      Boolean(install101.installData && install101.installData.installation && install101.installData.installation.sha256 === v101File.sha256),
      { server: install101.installData && install101.installData.installation && install101.installData.installation.sha256, source: v101File.sha256 }
    );
    scenario.fs.v100DirAfterUpgrade = dirState(paths.gameDir('1.0.0'));
    scenario.fs.v101DirAfterUpgrade = dirState(paths.gameDir('1.0.1'));
    check('upgrade-retains-previous-version-directory', Boolean(scenario.fs.v100DirAfterUpgrade.exists && scenario.fs.v101DirAfterUpgrade.exists), { v100: scenario.fs.v100DirAfterUpgrade, v101: scenario.fs.v101DirAfterUpgrade });

    stage('ui-launch-1.0.1');
    await launchFromRow(cdp, capture, GAME_ID);
    const life101 = await readLifeState(capture, { predicate: (value) => value.bridgeReady && value.phase === 'playing' });
    await resumeIfPaused(cdp);
    scenario.versions.v101 = life101 && life101.value;
    check('upgraded-game-runs-1.0.1', Boolean(life101 && life101.value.version === '1.0.1'), life101 && { version: life101.value.version, errors: life101.value.errors });
    const loadedBy101 = savedValue(life101 && life101.value.loadedSave);
    check(
      'upgrade-loads-previous-save',
      Boolean(life101 && life101.value.version === '1.0.1' && loadedBy101 && sameJson(loadedBy101, saveTriplet(scenario.saves.exit2))),
      { version: life101 && life101.value.version, loaded: loadedBy101, expected: saveTriplet(scenario.saves.exit2) }
    );
    const save101 = await waitFor(async () => {
      const state = await readLifeState(capture);
      return state && state.value.ticks > 0 ? state : null;
    }, 10000);
    await sleep(1200);
    const frozen3 = await freezeAndCaptureSave(cdp, capture);
    scenario.saves.exit3 = frozen3.payload;
    const leave101 = await leaveRuntime(cdp);
    scenario.steps.push({ step: 'leave-v101', clicked: leave101.click.clicked, left: Boolean(leave101.left), frozenSave: frozen3.payload });
    check('upgraded-game-saves-on-exit', Boolean(frozen3.payload && frozen3.payload.version === '1.0.1'), frozen3.payload);
    void save101;

    // ------------------------------------------------------------------
    // 5) Rollback to 1.0.0: retained directory reused, old save continues.
    // ------------------------------------------------------------------
    await openMarketTab(cdp, scenario);
    const v100DirBeforeRollback = dirState(paths.gameDir('1.0.0'));
    stage('ui-rollback-1.0.0');
    const rollback = await runUiInstallFlow(cdp, capture, {
      filePath: v100File.path,
      label: 'rollback-v100',
      expectFileName: v100File.fileName,
      expectFormatLabel: '资源包',
    });
    const v100DirAfterRollback = dirState(paths.gameDir('1.0.0'));
    scenario.fs.v100Rollback = { before: v100DirBeforeRollback, after: v100DirAfterRollback };
    scenario.steps.push({ step: 'rollback-v100', request: rollback.installEntry ? { status: rollback.installEntry.status } : null, response: rollback.installResponse });
    check('ui-rollback-1.0.0-200', Boolean(rollback.installData && rollback.installData.version === '1.0.0'), rollback.installData ? { version: rollback.installData.version } : rollback.installResponse);
    check('ui-rollback-1.0.0-sha-equals-source', Boolean(rollback.installData && rollback.installData.installation && rollback.installData.installation.sha256 === v100File.sha256), { server: rollback.installData && rollback.installData.installation && rollback.installData.installation.sha256, source: v100File.sha256 });
    check(
      'rollback-reuses-retained-directory-without-rewriting',
      Boolean(v100DirBeforeRollback.exists && v100DirAfterRollback.exists && v100DirBeforeRollback.ino === v100DirAfterRollback.ino && v100DirBeforeRollback.mtimeMs === v100DirAfterRollback.mtimeMs),
      scenario.fs.v100Rollback
    );

    stage('ui-launch-rollback');
    await launchFromRow(cdp, capture, GAME_ID);
    const lifeRollback = await readLifeState(capture, { predicate: (value) => value.bridgeReady && value.phase === 'playing' });
    await resumeIfPaused(cdp);
    scenario.versions.rollback = lifeRollback && lifeRollback.value;
    check('rolled-back-game-runs-1.0.0', Boolean(lifeRollback && lifeRollback.value.version === '1.0.0'), lifeRollback && { version: lifeRollback.value.version, errors: lifeRollback.value.errors });
    const loadedAfterRollback = savedValue(lifeRollback && lifeRollback.value.loadedSave);
    check(
      'rollback-old-save-still-continues',
      Boolean(lifeRollback && lifeRollback.value.version === '1.0.0' && loadedAfterRollback && sameJson(loadedAfterRollback, saveTriplet(scenario.saves.exit3))),
      { version: lifeRollback && lifeRollback.value.version, loaded: loadedAfterRollback, expected: saveTriplet(scenario.saves.exit3) }
    );
    check(
      'rollback-continue-save-carries-newer-version-marker',
      Boolean(loadedAfterRollback && loadedAfterRollback.version === '1.0.1'),
      loadedAfterRollback
    );
    const frozen4 = await freezeAndCaptureSave(cdp, capture);
    scenario.saves.exit4 = frozen4.payload;
    const leaveRollback = await leaveRuntime(cdp);
    scenario.steps.push({ step: 'leave-rollback', clicked: leaveRollback.click.clicked, left: Boolean(leaveRollback.left), frozenSave: frozen4.payload });

    // ------------------------------------------------------------------
    // 6) Same version + different content must stay a 409; retained tree intact.
    // ------------------------------------------------------------------
    await openMarketTab(cdp, scenario);
    const v101DirBeforeConflict = dirState(paths.gameDir('1.0.1'));
    stage('ui-install-conflict');
    const conflict = await runUiInstallFlow(cdp, capture, {
      filePath: tamperedFile.path,
      label: 'install-tampered-1.0.1',
      expectFileName: tamperedFile.fileName,
      expectFormatLabel: '资源包',
    });
    const v101DirAfterConflict = dirState(paths.gameDir('1.0.1'));
    scenario.fs.v101Conflict = { before: v101DirBeforeConflict, after: v101DirAfterConflict };
    scenario.steps.push({ step: 'same-version-different-content', request: conflict.installEntry ? { status: conflict.installEntry.status } : null, response: conflict.installResponse });
    const conflictCode = conflict.installResponse && conflict.installResponse.error ? conflict.installResponse.error.code : null;
    check('same-version-different-content-still-409', Boolean(conflict.installEntry && conflict.installEntry.status === 409 && conflictCode === 'GM-4094'), { status: conflict.installEntry && conflict.installEntry.status, code: conflictCode, response: conflict.installResponse });
    check(
      'rejected-conflict-keeps-retained-tree',
      Boolean(v101DirBeforeConflict.exists && v101DirAfterConflict.exists && v101DirBeforeConflict.ino === v101DirAfterConflict.ino && v101DirBeforeConflict.mtimeMs === v101DirAfterConflict.mtimeMs),
      scenario.fs.v101Conflict
    );

    // ------------------------------------------------------------------
    // 7) installations.json write failure must not delete the reused directory.
    //    macOS `chflags uchg` makes the record file immutable; package staging
    //    and directory reuse still run, the final record rename fails.
    // ------------------------------------------------------------------
    await openMarketTab(cdp, scenario);
    const v101DirBeforeFailure = dirState(paths.gameDir('1.0.1'));
    const supportsChflags = process.platform === 'darwin' && spawnSync('chflags', [], { encoding: 'utf8' }).error === undefined;
    let recordFailure = null;
    let recordRetry = null;
    if (supportsChflags && fs.existsSync(paths.installations)) {
      writeLockFile = paths.installations;
      const locked = spawnSync('chflags', ['uchg', writeLockFile], { encoding: 'utf8' });
      const v101InstallAgain = await runUiInstallFlow(cdp, capture, {
        filePath: v101File.path,
        label: 'install-v101-recordfail',
        expectFileName: v101File.fileName,
        expectFormatLabel: '资源包',
      });
      recordFailure = { lockedStatus: locked.status, entryStatus: v101InstallAgain.installEntry && v101InstallAgain.installEntry.status, response: v101InstallAgain.installResponse };
      scenario.steps.push({ step: 'record-write-failure', failure: recordFailure });
      const unlocked = spawnSync('chflags', ['nouchg', writeLockFile], { encoding: 'utf8' });
      writeLockFile = null;
      scenario.fs.v101RecordFailure = { before: v101DirBeforeFailure, after: dirState(paths.gameDir('1.0.1')), unlockedStatus: unlocked.status };
      check(
        'record-write-failure-is-rejected',
        Boolean(recordFailure && recordFailure.entryStatus !== 200),
        recordFailure
      );
      check(
        'record-write-failure-does-not-delete-reused-directory',
        Boolean(v101DirBeforeFailure.exists && scenario.fs.v101RecordFailure.after.exists && v101DirBeforeFailure.ino === scenario.fs.v101RecordFailure.after.ino && v101DirBeforeFailure.mtimeMs === scenario.fs.v101RecordFailure.after.mtimeMs),
        scenario.fs.v101RecordFailure
      );
      // The Host intentionally latches the store read-only for the rest of the
      // process after EACCES/EPERM (storage.js: "an unwritable root flips the
      // store to read-only"). Recovery therefore means a real Host restart on
      // the SAME data root, not an in-process retry.
      const restarted = await restartHost(hostHandle, PORTS, `probe-m2-lifecycle-${runTag}-restart`);
      await cdp.navigate(restarted.url);
      const reboot = await waitForDshPage(cdp, hostHandle.hostOrigin);
      scenario.steps.push({ step: 'host-restart-after-record-failure', health: reboot.health && reboot.health.status });
      check('host-restarts-on-same-data-root-after-readonly-latch', Boolean(reboot.health && reboot.health.status === 200), { health: reboot.health });
      await dismissOverlays(cdp);
      await openMarketPanel(cdp);
      const recovery = await runUiInstallFlow(cdp, capture, {
        filePath: v101File.path,
        label: 'install-v101-after-recordfail',
        expectFileName: v101File.fileName,
        expectFormatLabel: '资源包',
      });
      recordRetry = { status: recovery.installEntry && recovery.installEntry.status, response: recovery.installResponse };
      scenario.steps.push({ step: 'record-write-recovery', retry: recordRetry });
      const v101DirAfterRecovery = dirState(paths.gameDir('1.0.1'));
      scenario.fs.v101Recovery = { after: v101DirAfterRecovery };
      check('record-write-recovery-install-succeeds', Boolean(recovery.installEntry && recovery.installEntry.status === 200), recordRetry);
      check(
        'record-write-recovery-reuses-same-directory',
        Boolean(v101DirBeforeFailure.exists && v101DirAfterRecovery.exists && v101DirBeforeFailure.mtimeMs === v101DirAfterRecovery.mtimeMs),
        { before: v101DirBeforeFailure, after: v101DirAfterRecovery }
      );
    } else {
      check('record-write-failure-is-rejected', false, { note: 'chflags unavailable or installations.json missing — unverified', supportsChflags }, { required: false });
    }

    // ------------------------------------------------------------------
    // 8) UI uninstall.
    // ------------------------------------------------------------------
    stage('ui-uninstall');
    await openMyGamesTab(cdp, scenario);
    await waitForRow(cdp, GAME_ID);
    const menuClick = await clickElement(cdp, `document.querySelector('.dgm-row[data-row-id="${GAME_ID}"] .dgm-row-menu-btn')`, 'row-menu');
    const menuItem = await clickElement(
      cdp,
      `[...document.querySelectorAll('.dgm-menu-item')].find((item) => (item.textContent || '').trim().startsWith('卸载'))`,
      'menu-uninstall'
    );
    const confirmDialog = await waitFor(async () => {
      const state = await readUiState(cdp);
      return state.dialog ? state : null;
    }, 10000);
    const confirmClick = await clickElement(cdp, `document.querySelector('.dgm-dialog .dgm-btn-danger, .dgm-dialog .dgm-btn-primary')`, 'confirm-uninstall');
    const rowGone = await waitForRow(cdp, GAME_ID, { expectGone: true, timeoutMs: 20000 });
    const installedAfter = await cdp.eval(`fetch('/api/game-market/installed').then(async (response) => ({ status: response.status, body: await response.json() }))`);
    const stillInstalled = installedAfter && installedAfter.body && installedAfter.body.ok === true && Array.isArray(installedAfter.body.data.items)
      ? installedAfter.body.data.items.some((item) => item && item.id === GAME_ID)
      : null;
    scenario.fs.afterUninstall = { v100: dirState(paths.gameDir('1.0.0')), v101: dirState(paths.gameDir('1.0.1')) };
    scenario.steps.push({ step: 'uninstall', menuClick: { clicked: menuClick.clicked }, menuItem: { clicked: menuItem.clicked }, dialog: confirmDialog && confirmDialog.dialog, confirmClicked: confirmClick.clicked, rowGone: Boolean(rowGone), stillInstalled });
    check('uninstall-menu-confirm-clicked', Boolean(menuClick.clicked && menuItem.clicked && confirmClick.clicked && confirmDialog), { menuClick, menuItem, confirmClick, dialog: confirmDialog && confirmDialog.dialog });
    check('uninstall-removes-game-from-my-games', Boolean(rowGone), { rowGone: Boolean(rowGone) });
    check('uninstall-removes-installation-record', installedAfter !== null && stillInstalled === false, { status: installedAfter && installedAfter.status, stillInstalled });
    check('uninstall-prunes-package-directories', Boolean(!scenario.fs.afterUninstall.v100.exists && !scenario.fs.afterUninstall.v101.exists), scenario.fs.afterUninstall);

    // ------------------------------------------------------------------
    // 9) html-v1 control: the legacy local HTML install path still works.
    // ------------------------------------------------------------------
    stage('html-v1 control');
    const htmlControl = buildHtmlControl({ gameId: 'm2-html-control', version: '1.0.0' });
    const htmlControlFile = writeFixtureFile(fixtureDir, htmlControl.fileName, htmlControl.bytes);
    await openMarketTab(cdp, scenario);
    const htmlInstall = await runUiInstallFlow(cdp, capture, {
      filePath: htmlControlFile.path,
      label: 'install-html-control',
      expectFileName: htmlControlFile.fileName,
      expectFormatLabel: 'HTML',
    });
    const htmlInstallData = htmlInstall.installData;
    scenario.steps.push({ step: 'install-html-control', request: htmlInstall.installEntry ? { status: htmlInstall.installEntry.status } : null, response: htmlInstall.installResponse });
    check(
      'html-v1-control-installs-through-ui-200',
      Boolean(htmlInstallData && htmlInstallData.installation && htmlInstallData.installation.format === 'html-v1'),
      htmlInstallData && htmlInstallData.installation ? { format: htmlInstallData.installation.format, sizeBytes: htmlInstallData.installation.sizeBytes } : htmlInstall.installResponse
    );
    await openMyGamesTab(cdp, scenario);
    await waitForRow(cdp, 'm2-html-control');
    const htmlLaunch = await launchFromRow(cdp, capture, 'm2-html-control');
    const htmlGame = await waitFor(async () => {
      for (const record of capture.state.attached) {
        if (record.type !== 'iframe') continue;
        try {
          const value = await capture.evaluate(record.sessionId, `(() => {
            if (window.__M2_LIFE__) return null; // not the ZIP fixture
            const title = document.title || '';
            if (!/breakout|2048|jump|snake|orbit/i.test(title)) return null;
            return { title: title, origin: window.origin, hasCanvas: Boolean(document.querySelector('canvas')), bodyLength: (document.body.innerText || '').length };
          })()`);
          if (value) return { sessionId: record.sessionId, value };
        } catch (_error) {
          // ignore
        }
      }
      return null;
    }, 25000);
    scenario.steps.push({ step: 'launch-html-control', play: htmlLaunch.play.clicked, game: htmlGame && htmlGame.value });
    check('html-v1-control-launches-and-renders', Boolean(htmlLaunch.play.clicked && htmlGame && htmlGame.value.origin === 'null' && htmlGame.value.hasCanvas), { play: htmlLaunch.play.clicked, game: htmlGame && htmlGame.value });
    await leaveRuntime(cdp);
    await openMyGamesTab(cdp, scenario);
    await waitForRow(cdp, 'm2-html-control');
    const htmlMenuClick = await clickElement(cdp, `document.querySelector('.dgm-row[data-row-id="m2-html-control"] .dgm-row-menu-btn')`, 'html-row-menu');
    const htmlMenuUninstall = await clickElement(
      cdp,
      `[...document.querySelectorAll('.dgm-menu-item')].find((item) => (item.textContent || '').trim().startsWith('卸载'))`,
      'html-menu-uninstall'
    );
    await waitFor(async () => {
      const state = await readUiState(cdp);
      return state.dialog ? state : null;
    }, 8000);
    await clickElement(cdp, `document.querySelector('.dgm-dialog .dgm-btn-danger, .dgm-dialog .dgm-btn-primary')`, 'html-uninstall-confirm');
    const htmlRowGone = await waitForRow(cdp, 'm2-html-control', { expectGone: true, timeoutMs: 20000 });
    scenario.steps.push({ step: 'uninstall-html-control', menu: htmlMenuClick.clicked, item: htmlMenuUninstall.clicked, rowGone: Boolean(htmlRowGone) });
    check('html-v1-control-uninstalls', Boolean(htmlRowGone), { rowGone: Boolean(htmlRowGone) });

    // ------------------------------------------------------------------
    // Global probes: no direct API installs, no CSP/framing violations.
    // ------------------------------------------------------------------
    const installPosts = capture.state.networkOrder.filter((entry) => typeof entry.url === 'string' && entry.url.includes('/api/game-market/install-local'));
    check('no-direct-api-install-from-probe', installPosts.length >= 1 && installPosts.every((entry) => entry.method === 'POST'), { observed: installPosts.length });
    const framing = capture.state.logs.filter((entry) => /Framing .*violates.*frame-ancestors/i.test(entry.text || ''));
    const csp = capture.state.logs.filter((entry) => /violates the following Content Security Policy/i.test(entry.text || ''));
    scenario.csp = { framingViolations: framing.slice(0, 5), otherViolations: csp.slice(0, 10) };
    check('zero-frame-ancestors-violations', framing.length === 0, framing.slice(0, 5));
    check('zero-csp-violations', csp.length === 0, csp.slice(0, 10));

    try {
      scenario.screenshots = { market: await screenshot(cdp, 'm2-lifecycle-market').catch(() => null) };
    } catch (_error) {
      scenario.screenshots = { error: 'screenshot failed' };
    }
  } catch (error) {
    check('probe-completed-without-throwing', false, { error: String(error && error.stack ? error.stack : error).slice(0, 1500) });
  } finally {
    if (writeLockFile) {
      spawnSync('chflags', ['nouchg', writeLockFile], { encoding: 'utf8' });
      writeLockFile = null;
    }
    try {
      if (cdp) cdp.dispose();
    } catch (_error) {
      // ignore
    }
    try {
      if (hostHandle) {
        if (KEEP) await hostHandle.stop();
        else await hostHandle.cleanup();
      }
    } catch (_error) {
      // ignore
    }
    if (hostHandle && KEEP) scenario.keptHome = hostHandle.home;
  }

  const written = writeEvidence(
    EVIDENCE_ID,
    {
      id: EVIDENCE_ID,
      title: 'M2 non-builtin ZIP lifecycle: UI install → play/save → exit/Continue → upgrade → rollback → Continue → 409 → record-write failure → uninstall',
      command: `node scripts/verification/v1.5/m2/m2-lifecycle-zip.mjs${KEEP ? ' --keep' : ''}`,
      environment: { dsh: identity, chrome: 'headless CDP', gameId: GAME_ID, ports: PORTS },
      checks,
      extra: { scenario },
    },
    secrets
  );
  const failed = checks.filter((entry) => entry.required && !entry.ok);
  process.stdout.write(`\n${EVIDENCE_ID} ${written.passed ? 'PASSED' : 'FAILED'} (${checks.filter((c) => c.required && c.ok).length}/${checks.filter((c) => c.required).length} required checks)\n`);
  process.stdout.write(`evidence: ${written.file}\n`);
  for (const entry of failed) process.stdout.write(`  FAIL ${entry.name}: ${sample(entry.detail, 500)}\n`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`[m2-lifecycle] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
  process.exitCode = 1;
});
