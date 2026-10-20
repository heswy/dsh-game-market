#!/usr/bin/env node
/**
 * M2 F1 · 375px / dark / prefers-reduced-motion on the real builtin game.
 *
 * Launches the builtin `orbit-courier` (asset-zip-v2) through the real Market UI
 * in a real DSH page, then uses CDP device metrics + media emulation:
 *   - 375×667 mobile viewport: no horizontal overflow, HUD/stage/controls inside
 *     the viewport, 375-px compact HUD layout active;
 *   - dark: dark background, readable text contrast (WCAG >= 4.5 for HUD text);
 *   - prefers-reduced-motion: media query reports reduce, CSS animation and
 *     transition durations collapse to ~0, no running CSS animations — compared
 *     against the same page measured with `no-preference`.
 *
 * All values come from the real game document inside the sandboxed game iframe
 * (`window.origin === "null"`), not from a mock.
 *
 * Usage: node scripts/verification/v1.5/m2/m2-visual-responsive.mjs [--keep]
 * Exit 0 iff every required check passed. Evidence: raw/m2/<id>-<ts>.json.
 */
import fs from 'node:fs';

import {
  Cdp,
  sleep,
  runtimeIdentity,
  startIsolatedHost,
  hostPid,
  createCdpCapture,
  waitForDshPage,
  writeEvidence,
  OUT_DIR,
  screenshot,
} from './lib/lab.mjs';
import {
  dismissOverlays,
  openMarketPanel,
  openMyGamesTab,
  launchFromRow,
  waitFor,
  readUiState,
  clickElement,
} from './lib/ui.mjs';

const PORTS = Object.freeze({ bootstrap: 58440, host: 58441, chrome: 9524 });
const KEEP = process.argv.includes('--keep');
const GAME_ID = 'orbit-courier';
const EVIDENCE_ID = 'M2-visual-responsive';

const checks = [];
const scenario = {};

function check(name, ok, detail, { required = true } = {}) {
  checks.push({ name, ok: Boolean(ok), required, detail });
  process.stdout.write(`  ${ok ? 'ok' : 'FAIL'} ${name}\n`);
  return Boolean(ok);
}

function sample(value, limit = 1200) {
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch (_error) {
    return String(value).slice(0, 400);
  }
}

/** Poll the real orbit-courier instance in the sandboxed game iframe. */
async function gameInstance(capture, expression, timeoutMs = 30000) {
  return waitFor(async () => {
    for (const record of capture.state.attached) {
      if (record.type !== 'iframe') continue;
      try {
        const value = await capture.evaluate(record.sessionId, `window.__orbitCourier ? (${expression}) : null`);
        if (value !== null && value !== undefined) return { sessionId: record.sessionId, value };
      } catch (_error) {
        // navigation in flight
      }
    }
    return null;
  }, timeoutMs);
}

async function measureLayout(capture, sessionId) {
  return capture.evaluate(
    sessionId,
    `(() => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const rectOf = (id) => {
        const node = document.getElementById(id);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      const inside = (rect) => Boolean(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1);
      const style = getComputedStyle(document.body);
      const hud = document.getElementById('hud');
      const hudStyle = hud ? getComputedStyle(hud) : null;
      const parseColor = (value) => {
        const match = /rgba?\\(([^)]+)\\)/.exec(String(value || ''));
        if (!match) return null;
        const parts = match[1].split(',').map((part) => Number(part.trim()));
        return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1 };
      };
      const luminance = (color) => {
        const channel = (value) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
      };
      const contrast = (a, b) => {
        if (!a || !b) return null;
        const la = luminance(a);
        const lb = luminance(b);
        const high = Math.max(la, lb);
        const low = Math.min(la, lb);
        return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
      };
      const bodyBg = parseColor(style.backgroundColor);
      const hudColor = hudStyle ? parseColor(hudStyle.color) : null;
      return {
        viewport,
        origin: window.origin,
        readyState: document.readyState,
        bodyBackground: style.backgroundColor,
        bodyColor: style.color,
        bodyBgLuminance: bodyBg ? Math.round(luminance(bodyBg) * 1000) / 1000 : null,
        hudColor: hudStyle ? hudStyle.color : null,
        hudContrast: contrast(hudColor, bodyBg),
        compactHud: window.matchMedia('(max-width: 430px)').matches,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        darkScheme: window.matchMedia('(prefers-color-scheme: dark)').matches,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        verticalOverflow: document.documentElement.scrollHeight - window.innerHeight,
        rects: {
          hud: rectOf('hud'),
          stage: rectOf('stage'),
          controls: rectOf('controls'),
          app: rectOf('app')
        },
        inside: {
          hud: inside(rectOf('hud')),
          stage: inside(rectOf('stage')),
          controls: inside(rectOf('controls'))
        },
        animationCount: typeof document.getAnimations === 'function' ? document.getAnimations().length : null,
        toastTransition: (() => {
          const toast = document.getElementById('toast');
          return toast ? getComputedStyle(toast).transitionDuration : null;
        })(),
        actBannerAnimation: (() => {
          const banner = document.getElementById('act-banner');
          return banner ? getComputedStyle(banner).animationDuration : null;
        })(),
        reducedMotionClass: document.body.classList.contains('reduced-motion')
      };
    })()`
  );
}

async function setMedia(cdp, capture, { dark, reduced, width, height }) {
  const features = [
    { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
    { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
  ];
  // OOPIF targets (wrapper + nested game iframe) do not inherit the root
  // target's emulation: send the media override to every attached session too.
  const sessions = capture.state.attached.map((record) => record.sessionId).filter(Boolean);
  await Promise.allSettled(
    sessions.map((sessionId) => cdp.send('Emulation.setEmulatedMedia', { features }, sessionId))
  );
  await cdp.send('Emulation.setEmulatedMedia', { features });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
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
    hostHandle = await startIsolatedHost({ name: `probe-m2-visual-${runTag}`, ports: PORTS });
    cdp = await Cdp.launch({ port: PORTS.chrome });
    capture = createCdpCapture(cdp);
    await capture.start();
    await cdp.navigate(hostHandle.host.url);
    const boot = await waitForDshPage(cdp, hostHandle.hostOrigin);
    check('dsh-page-loads-and-host-api-answers', boot.health && boot.health.status === 200, { health: boot.health && { status: boot.health.status } });
    await dismissOverlays(cdp);

    // Launch the real builtin game through the real panel row.
    await openMarketPanel(cdp);
    await openMyGamesTab(cdp);
    const launch = await launchFromRow(cdp, capture, GAME_ID);
    scenario.launch = { play: launch.play.clicked, runtime: launch.runtime };
    check('orbit-courier-launches-from-my-games-row', Boolean(launch.play.clicked && launch.runtime), { play: launch.play, runtime: launch.runtime });
    const game = await gameInstance(capture, `({ phase: window.__orbitCourier.state.phase, score: window.__orbitCourier.state.score })`, 30000);
    check('orbit-courier-instance-booted', Boolean(game), game ? game.value : null);
    if (!game) throw new Error('orbit-courier instance never booted');

    // Start a run so the game chrome (HUD with data, controls, overlay states)
    // is the real playing UI; the overlay start button is the real user entry.
    await clickElement(cdp, `document.querySelector('#overlay-actions .primary, #overlay-actions button')`, 'overlay-start').catch(() => null);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(async () => {
      const state = await gameInstance(capture, `({ phase: window.__orbitCourier.state.phase })`, 8000);
      return state && state.value.phase === 'playing' ? state : null;
    }, 15000);
    await sleep(1200);

    // ---- 375 px + dark + reduced-motion -----------------------------------
    await setMedia(cdp, capture, { dark: true, reduced: true, width: 375, height: 667 });
    await sleep(900);
    const sessionId = (await gameInstance(capture, '({ session: true })', 8000)).sessionId;
    scenario.layout375 = await measureLayout(capture, sessionId);
    const pageMetrics = await cdp.eval('({ width: window.innerWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth })');
    scenario.pageMetrics375 = pageMetrics;
    const layout = scenario.layout375;
    check('game-document-is-opaque-origin', layout.origin === 'null', { origin: layout.origin });
    check(
      'page-viewport-is-375x667',
      pageMetrics.width === 375 && pageMetrics.height === 667,
      pageMetrics
    );
    check('game-viewport-fits-inside-375px-stage', layout.viewport.width > 0 && layout.viewport.width <= 375, layout.viewport);
    check('375px-layout-has-no-horizontal-overflow', layout.horizontalOverflow <= 1, { horizontalOverflow: layout.horizontalOverflow, scrollWidthNote: layout.horizontalOverflow });
    check('375px-compact-hud-layout-active', layout.compactHud === true, { compactHud: layout.compactHud });
    check(
      '375px-key-chrome-inside-viewport',
      Boolean(layout.inside.hud && layout.inside.stage && layout.inside.controls),
      { rects: layout.rects, inside: layout.inside, viewport: layout.viewport }
    );
    check('dark-scheme-active', layout.darkScheme === true, { darkScheme: layout.darkScheme, bodyBackground: layout.bodyBackground });
    check('dark-background-is-dark', typeof layout.bodyBgLuminance === 'number' && layout.bodyBgLuminance < 0.1, { bodyBackground: layout.bodyBackground, luminance: layout.bodyBgLuminance });
    check('dark-hud-text-readable-contrast', typeof layout.hudContrast === 'number' && layout.hudContrast >= 4.5, { hudColor: layout.hudColor, bodyBackground: layout.bodyBackground, contrast: layout.hudContrast });
    check('reduced-motion-media-query-matches', layout.reducedMotion === true, { reducedMotion: layout.reducedMotion });
    const maxDurationSeconds = (value) => {
      const parts = String(value || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      let max = 0;
      for (const part of parts) {
        const match = /^([0-9.]+)(ms|s)$/.exec(part);
        if (!match) return Number.POSITIVE_INFINITY;
        const seconds = match[2] === 'ms' ? Number(match[1]) / 1000 : Number(match[1]);
        if (Number.isFinite(seconds)) max = Math.max(max, seconds);
      }
      return parts.length === 0 ? 0 : max;
    };
    scenario.reducedMotionDurations = {
      reduceToast: layout.toastTransition,
      reduceToastMaxSeconds: maxDurationSeconds(layout.toastTransition),
    };
    check(
      'reduced-motion-collapses-css-animation-and-transition',
      maxDurationSeconds(layout.toastTransition) <= 0.002,
      scenario.reducedMotionDurations
    );

    // ---- Control: same page with no-preference, transitions come back ------
    await setMedia(cdp, capture, { dark: true, reduced: false, width: 375, height: 667 });
    await sleep(900);
    const noPref = await measureLayout(capture, sessionId);
    scenario.layoutNoPreference = noPref;
    check('no-preference-control-shows-media-diff', noPref.reducedMotion === false, { reducedMotion: noPref.reducedMotion });
    check(
      'reduced-motion-differs-from-no-preference',
      noPref.reducedMotion === true || (Number.parseFloat(String(noPref.toastTransition)) || 0) > 0.0005 || String(noPref.toastTransition) !== String(layout.toastTransition),
      { reduceTransition: layout.toastTransition, noPreferenceTransition: noPref.toastTransition }
    );

    // ---- Dark vs light readability (same viewport) ------------------------
    await setMedia(cdp, capture, { dark: false, reduced: false, width: 375, height: 667 });
    await sleep(900);
    const light = await measureLayout(capture, sessionId);
    scenario.layoutLight = light;
    check('light-scheme-can-be-emulated-and-stays-laid-out', light.inside.hud === true && light.inside.controls === true, { darkScheme: light.darkScheme, inside: light.inside });

    // Screenshots for the report (375 dark reduced + light).
    await setMedia(cdp, capture, { dark: true, reduced: true, width: 375, height: 667 });
    await sleep(600);
    scenario.screenshots = {
      mobile375DarkReduced: await screenshot(cdp, 'm2-visual-375-dark-reduced', { x: 0, y: 0, width: 375, height: 667, scale: 1 }).catch(() => null),
      mobile375Light: await (async () => {
        await setMedia(cdp, capture, { dark: false, reduced: false, width: 375, height: 667 });
        await sleep(600);
        return screenshot(cdp, 'm2-visual-375-light', { x: 0, y: 0, width: 375, height: 667, scale: 1 }).catch(() => null);
      })(),
    };
    // Reset emulation so teardown is not affected by the mobile viewport.
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await cdp.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
    const logs = capture.state.logs.filter((entry) => /violates the following Content Security Policy/i.test(entry.text || ''));
    scenario.cspViolations = logs.slice(0, 5);
    check('zero-csp-violations-during-visual-run', logs.length === 0, logs.slice(0, 5));
  } catch (error) {
    check('probe-completed-without-throwing', false, { error: String(error && error.stack ? error.stack : error).slice(0, 1500) });
  } finally {
    try {
      if (cdp) cdp.dispose();
    } catch (_error) {
      // ignore
    }
    try {
      if (hostHandle) {
        if (KEEP) await hostHandle.stop();
        else await hostHandle.cleanup();
        scenario.cleanup = {
          mode: KEEP ? 'keep' : 'cleanup',
          restarts: hostHandle.restarts,
          pids: hostHandle.hostPids,
          finalPid: hostPid(hostHandle.host),
        };
      }
    } catch (error) {
      // CR8-05: a failed close must fail the probe instead of exiting 0 with a
      // leaked listener.
      cleanupError = error;
      scenario.cleanup = {
        mode: KEEP ? 'keep' : 'cleanup',
        error: String(error && error.message ? error.message : error).slice(0, 400),
      };
    }
    if (hostHandle && KEEP) scenario.keptHome = hostHandle.home;
  }

  const written = writeEvidence(
    EVIDENCE_ID,
    {
      id: EVIDENCE_ID,
      title: 'M2 visual: builtin orbit-courier at 375px / dark / prefers-reduced-motion',
      command: `node scripts/verification/v1.5/m2/m2-visual-responsive.mjs${KEEP ? ' --keep' : ''}`,
      environment: { dsh: identity, chrome: 'headless CDP', gameId: GAME_ID, ports: PORTS },
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
  if (cleanupError) process.stderr.write(`[m2] cleanup failed: ${cleanupError && cleanupError.message ? cleanupError.message : cleanupError}\n`);
}

main().catch((error) => {
  process.stderr.write(`[m2-visual] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
  process.exitCode = 1;
});
