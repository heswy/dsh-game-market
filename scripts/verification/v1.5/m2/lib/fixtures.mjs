/**
 * M2 F1 fixtures — real, installable packages built from the repo helpers.
 *
 * Every package here goes through the *real* Host install pipeline (descriptor,
 * manifest, limits, static scan); nothing is injected into the Host. Binaries
 * are generated in memory (no committed artifacts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { buildPackageFiles, buildSdkFile, REPO_ROOT } from './lab.mjs';

export { REPO_ROOT };

const LEVEL_JSON = JSON.stringify({ id: 'm2-level-01', waves: 3, lanes: 5 }, null, 2);

/** A tiny deterministic PNG (64×64, opaque-ish) for install fixtures. */
export function assetPng() {
  return fs.readFileSync(path.join(REPO_ROOT, 'scripts/verification/v1.5/assets/fixture-package/assets/ship.png'));
}

export function assetWav() {
  return fs.readFileSync(path.join(REPO_ROOT, 'scripts/verification/v1.5/assets/fixture-package/assets/pickup.wav'));
}

function manifestFor({ gameId, name, version, description, capabilities = [] }) {
  const manifest = {
    manifestVersion: 1,
    id: gameId,
    name,
    version,
    author: { name: 'dsh-game-market verification' },
    description,
    categories: ['arcade'],
    capabilities,
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    save: { schemaVersion: 1 },
  };
  if (capabilities.includes('score')) {
    manifest.score = { direction: 'higher-better', min: 0, max: 1000000, integer: true };
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Lifecycle game (asset-zip-v2): session.start, autosave, before-save, pause,
// load (Continue), version marker. Used by the non-builtin lifecycle probe.
// ---------------------------------------------------------------------------

const LIFECYCLE_MAIN = String.raw`import { VERSION } from './version.mjs';

const game = globalThis.DSH_GAME_SDK.createGameSDK();
const SAVE_KEY = 'progress';
const state = (window.__M2_LIFE__ = {
  version: VERSION,
  phase: 'boot',
  bridgeReady: false,
  sessionStarted: false,
  paused: false,
  ticks: 0,
  score: 0,
  loadedSave: null,
  lastSave: null,
  lastSaveError: null,
  saveAcks: 0,
  errors: []
});

function log(event, data) {
  try { console.log('M2L ' + JSON.stringify(Object.assign({ event: event, at: Date.now() }, data || {}))); } catch (_error) { /* ignore */ }
}

function snapshot() {
  return { version: state.version, ticks: state.ticks, score: state.score };
}

function persist(reason) {
  if (!state.bridgeReady) return Promise.resolve(null);
  const payload = { schemaVersion: 1, value: snapshot(), reason: reason };
  return game.storage.save(SAVE_KEY, payload).then(
    () => {
      state.saveAcks += 1;
      state.lastSave = { reason: reason, payload: payload.value, at: Date.now() };
      log('life-save', { reason: reason, version: state.version, ticks: state.ticks, score: state.score, acks: state.saveAcks });
      return payload.value;
    },
    (error) => {
      state.lastSaveError = String((error && error.code) || error);
      log('life-save-failed', { reason: reason, code: state.lastSaveError });
      return null;
    }
  );
}

// Probe hook: force a save and return the exact payload written (used to
// compare the Continue/rollback save byte-for-byte without console races).
state.persistNow = function persistNow() { return persist('probe-persist'); };
state.freezeAndSave = function freezeAndSave() {
  state.paused = true;
  return persist('probe-freeze');
};

let clock = null;
function startClock() {
  if (clock !== null) return;
  clock = setInterval(function tick() {
    if (state.paused || state.phase !== 'playing') return;
    state.ticks += 1;
    state.score = state.ticks * 10;
  }, 100);
}
function stopClock() {
  if (clock !== null) { clearInterval(clock); clock = null; }
}

game.lifecycle.on('pause', function onPause() { state.paused = true; log('life-pause', { ticks: state.ticks }); });
game.lifecycle.on('resume', function onResume() { state.paused = false; log('life-resume', { ticks: state.ticks }); });
game.lifecycle.on('before-save', function onBeforeSave() { return persist('before-save'); });
game.lifecycle.on('hidden', function onHidden() { state.paused = true; log('life-hidden', {}); });
game.lifecycle.on('visible', function onVisible() { state.paused = false; log('life-visible', {}); });

game.ready().then(
  async function onReady(info) {
    state.bridgeReady = true;
    log('life-ready', { version: state.version, packageFormat: info && info.packageFormat, resourceBase: Boolean(info && info.resourceBase) });
    try {
      const loaded = await game.storage.load(SAVE_KEY);
      state.loadedSave = loaded === undefined ? null : loaded;
      // Continue: restore the persisted progress so the next session continues
      // the same run instead of restarting at zero.
      const envelope = state.loadedSave;
      const saved = envelope && envelope.data && envelope.data.value
        ? envelope.data.value
        : envelope && envelope.value
          ? envelope.value
          : null;
      if (saved && typeof saved.ticks === 'number' && typeof saved.score === 'number') {
        state.ticks = saved.ticks;
        state.score = saved.score;
        state.resumedFrom = saved;
      }
      log('life-loaded', { loaded: state.loadedSave, resumedFrom: state.resumedFrom || null });
    } catch (error) {
      state.errors.push('load:' + String((error && error.code) || error));
      log('life-load-failed', { code: String((error && error.code) || error) });
    }
    try {
      await game.session.start();
      state.sessionStarted = true;
      log('life-session-started', {});
    } catch (error) {
      state.errors.push('session:' + String((error && error.code) || error));
      log('life-session-failed', { code: String((error && error.code) || error) });
    }
    state.phase = 'playing';
    startClock();
    setInterval(function autosave() { void persist('interval'); }, 2000);
    setInterval(function scoreSubmit() {
      if (state.ticks > 0) game.score.submit(state.score).catch(function ignore() {});
    }, 3000);
  },
  function onReadyFailed(error) {
    state.errors.push('ready:' + String((error && error.code) || error));
    log('life-ready-failed', { code: String((error && error.code) || error) });
  }
);
`;

export async function buildLifecyclePackage({ gameId = 'm2-life-probe', version = '1.0.0' } = {}) {
  const sdk = await buildSdkFile();
  const manifest = manifestFor({
    gameId,
    name: 'M2 Lifecycle Probe',
    version,
    description: 'M2 non-builtin lifecycle probe: save/continue/upgrade/rollback.',
    capabilities: ['storage', 'score'],
  });
  const built = buildPackageFiles({
    'game.json': JSON.stringify(manifest, null, 2),
    'index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>M2 Lifecycle Probe</title>'
      + '<link rel="stylesheet" href="styles/game.css"></head><body><div id="hud">life</div>'
      + '<script src="dsh-sdk.js"></script><script type="module" src="scripts/main.mjs"></script></body></html>\n',
    'dsh-sdk.js': sdk,
    'scripts/main.mjs': LIFECYCLE_MAIN,
    'scripts/version.mjs': `export const VERSION = ${JSON.stringify(version)};\n`,
    'styles/game.css': 'html, body { margin: 0; background: rgb(8, 11, 16); color: rgb(230, 230, 230); }\n',
    'data/level.json': LEVEL_JSON,
    'assets/mark.png': assetPng(),
    'assets/blip.wav': assetWav(),
  });
  return { ...built, manifest, gameId, version };
}

/** Same id+version, different bytes (for the GM-4094 same-version conflict). */
export async function buildTamperedVersion({ gameId = 'm2-life-probe', version = '1.0.1' } = {}) {
  const sdk = await buildSdkFile();
  const manifest = manifestFor({
    gameId,
    name: 'M2 Lifecycle Probe',
    version,
    description: 'tampered content for same-version conflict check',
    capabilities: ['storage', 'score'],
  });
  const built = buildPackageFiles({
    'game.json': JSON.stringify(manifest, null, 2),
    'index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>M2 Lifecycle Probe</title></head>'
      + '<body><div id="hud">tampered</div><script src="dsh-sdk.js"></script><script type="module" src="scripts/main.mjs"></script></body></html>\n',
    'dsh-sdk.js': sdk,
    'scripts/main.mjs': LIFECYCLE_MAIN,
    'scripts/version.mjs': `export const VERSION = ${JSON.stringify(version)};\nexport const TAMPERED = true;\n`,
    'styles/game.css': 'html, body { margin: 0; }\n',
  });
  return { ...built, manifest, gameId, version };
}

// ---------------------------------------------------------------------------
// Multi-resource package (A02 class) — used once M2-A ships orbit-courier;
// also usable as an independent fixture today (documented as generic).
// ---------------------------------------------------------------------------

const MULTI_MAIN = String.raw`import { nextScore } from './logic.mjs';

const game = globalThis.DSH_GAME_SDK.createGameSDK();
const state = (window.__M2_RES__ = {
  phase: 'boot', ticks: 0, score: 0, esmStaticImport: nextScore(0) === 1,
  resources: {}, bridge: {}
});

function log(event, data) {
  try { console.log('M2R ' + JSON.stringify(Object.assign({ event: event, at: Date.now() }, data || {}))); } catch (_error) { /* ignore */ }
}

game.ready().then(async function onReady(info) {
  state.bridge = { ready: true, packageFormat: info && info.packageFormat };
  log('res-ready', { packageFormat: info && info.packageFormat });
  const level = await fetch('./data/level.json', { cache: 'no-store' }).then((r) => r.json());
  state.resources.json = { ok: true, id: level.id };
  const image = new Image();
  image.src = 'assets/mark.png';
  await image.decode().catch(function ignore() {});
  state.resources.image = { width: image.naturalWidth, height: image.naturalHeight };
  const audio = document.createElement('audio');
  audio.src = 'assets/blip.wav';
  audio.preload = 'auto';
  await new Promise(function wait(resolve) { audio.addEventListener('loadedmetadata', resolve, { once: true }); audio.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 3000); });
  state.resources.audio = { readyState: audio.readyState, duration: audio.duration };
  state.phase = 'playing';
  log('res-fetch', state.resources.json);
  setInterval(function tick() { state.ticks += 1; state.score = state.ticks * 2; }, 100);
}, function failed(error) { state.phase = 'error'; state.errors = [String((error && error.code) || error)]; });
`;

export async function buildMultiResourcePackage({ gameId = 'm2-multiresource-probe', version = '1.0.0' } = {}) {
  const sdk = await buildSdkFile();
  const manifest = manifestFor({
    gameId,
    name: 'M2 Multi-Resource Probe',
    version,
    description: 'M2 A02-class fixture: ESM/CSS/JSON/PNG/WAV through the real resource origin.',
    capabilities: ['storage'],
  });
  const built = buildPackageFiles({
    'game.json': JSON.stringify(manifest, null, 2),
    'index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>M2 Multi-Resource Probe</title>'
      + '<link rel="stylesheet" href="styles/game.css"></head><body><div id="hud">res</div>'
      + '<script src="dsh-sdk.js"></script><script type="module" src="scripts/main.mjs"></script></body></html>\n',
    'dsh-sdk.js': sdk,
    'scripts/main.mjs': MULTI_MAIN,
    'scripts/logic.mjs': "export function nextScore(value) { return value + 1; }\n",
    'styles/game.css': 'html, body { margin: 0; background: rgb(13, 17, 23); color: rgb(255, 204, 102); }\n',
    'data/level.json': LEVEL_JSON,
    'assets/mark.png': assetPng(),
    'assets/blip.wav': assetWav(),
  });
  return { ...built, manifest, gameId, version };
}

/** Real html-v1 single-file control (bundled Breakout content, patched identity). */
export function buildHtmlControl({ gameId = 'm2-html-control', version = '1.0.0' } = {}) {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'games/breakout/dist/index.html'), 'utf8');
  const html = source.replace('"id": "breakout"', `"id": "${gameId}"`).replace('"name": "Breakout"', '"name": "M2 HTML Control"');
  if (!html.includes(`"id": "${gameId}"`)) throw new Error('html-v1 control fixture patch failed');
  return { bytes: Buffer.from(html, 'utf8'), fileName: `${gameId}-${version}.html`, gameId, version };
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Write bytes to a temp file and return {path,size,sha256}. */
export function writeFixtureFile(dir, fileName, bytes) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, fileName);
  fs.writeFileSync(target, bytes);
  const onDisk = fs.readFileSync(target);
  return { path: target, fileName, size: onDisk.length, sha256: sha256(onDisk) };
}
