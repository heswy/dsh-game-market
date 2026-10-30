#!/usr/bin/env node
/**
 * Real Desktop install + play of an external author's published release artifact.
 *
 * The P01 external-author loop already proved public submission, review,
 * publish, update and withdrawal against the content repository. This probe
 * closes the remaining Desktop gap with the *same* artifact the external author
 * released (`*.dshgame.zip`, sha256 recorded in the content repo), installed
 * through the real Market UI local-ZIP click path into an isolated Desktop
 * profile. The public catalog is intentionally empty after the withdrawal, so
 * this is explicitly NOT a live-catalog download and is recorded as such.
 *
 * Usage:
 *   node scripts/verification/v1.5/m5/external-package-desktop.mjs \
 *     --zip /tmp/p01-desktop/external-orbit-1.0.1.dshgame.zip \
 *     --game external-orbit --version 1.0.1 \
 *     --sha256 05194feb688552b84df254720c853e03556efb11c4b38b43804c8efa70aacc02 \
 *     --source https://github.com/heswy/dsh-game-registry/releases/tag/external-orbit-v1.0.1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { startDesktopLab } from './desktop-lab.mjs';
import { createCdpCapture } from '../m2/lib/lab.mjs';
import { openMarketPanel, launchFromRow, waitFor } from '../m2/lib/ui.mjs';
import { pressKey } from '../m2/m2-a08-orbit-courier.mjs';
import { createReport, sanitiseM3, sleep } from '../m3/lib.mjs';
import { runtimeIdentity } from '../lib/harness.mjs';

const args = process.argv.slice(2);
const get = (key) => args[args.indexOf(key) + 1];
const zipPath = get('--zip');
const gameId = get('--game');
const version = get('--version');
const expectedSha = get('--sha256');
const source = get('--source');
if (!zipPath || !fs.existsSync(zipPath)) throw Error('--zip must point to an existing .dshgame.zip');
if (!/^[a-z0-9-]+$/.test(gameId || '')) throw Error('--game required');
if (!version) throw Error('--version required');
if (!/^[0-9a-f]{64}$/.test(expectedSha || '')) throw Error('--sha256 required');
if (!source) throw Error('--source required');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const raw = path.join(root, 'docs/verification/v1.5/raw/m5');
fs.mkdirSync(raw, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const sha256 = createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
const report = createReport({
  id: 'M5-Desktop-external-package',
  title: 'External-author release artifact installed through the real Market UI and played in actual Desktop',
  commands: ['node scripts/verification/v1.5/m5/external-package-desktop.mjs ' + args.join(' ')],
});
let lab;
let capture;
function check(name, ok, detail) {
  report.add(name, Boolean(ok), detail);
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) throw Error(name);
}
async function probeSnapshot() {
  for (const frame of capture.state.attached) {
    if (frame.type !== 'iframe') continue;
    try {
      const snap = await capture.evaluate(frame.sessionId, 'window.__ORBIT_PROBE__ && typeof window.__ORBIT_PROBE__.snapshot === "function" ? window.__ORBIT_PROBE__.snapshot() : null');
      if (snap) return { sessionId: frame.sessionId, snap };
    } catch (_error) {
      // navigation in flight
    }
  }
  return null;
}
try {
  report.record('runtime', runtimeIdentity());
  report.record('artifact', { file: path.basename(zipPath), bytes: fs.statSync(zipPath).size, sha256, expectedSha, version, source });
  check('artifact sha256 matches the published release record', sha256 === expectedSha, {sha256, expectedSha});
  lab = await startDesktopLab({ name: 'm5-external-' + stamp, port: 9495 });
  const p = lab.page;
  capture = createCdpCapture(p);
  await capture.start();
  await openMarketPanel(p);
  check('fresh isolated Desktop starts without the external package', !(await p.eval(`Boolean(document.querySelector('.dgm-row[data-row-id="${gameId}"]'))`)));
  await p.send('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {});
  const chooserBefore = capture.state.fileChoosers.length;
  await p.eval(`document.querySelector('.dgm-local-install').click()`);
  const chooser = await capture.waitForFileChooser(chooserBefore, 8000);
  check('real upload button opens the native file chooser', chooser);
  await p.send('DOM.setFileInputFiles', { files: [zipPath], backendNodeId: chooser.backendNodeId });
  await p.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  const dialog = await waitFor(
    async () =>
      await p.eval(`(() => {
    const node = document.querySelector('.dgm-dialog');
    if (!node) return null;
    return {
      title: (node.querySelector('.dgm-dialog-title') || {}).textContent || '',
      meta: [...node.querySelectorAll('.dgm-dialog-meta dt')].map((dt, index) => ({
        label: (dt.textContent || '').trim(),
        value: ((node.querySelectorAll('.dgm-dialog-meta dd')[index] || {}).textContent || '').trim(),
      })),
      warning: [...node.querySelectorAll('.dgm-dialog-warning')].map((item) => (item.textContent || '').trim()),
      fileName: Boolean(node.textContent.includes(${JSON.stringify(path.basename(zipPath))})),
    };
  })()`),
    20000
  );
  check('confirmation dialog names the external ZIP and warns on local installs', dialog && dialog.fileName && dialog.warning.some((text) => /本地安装不会校验文件来源|Local installs do not verify/.test(text)), dialog);
  const networkBefore = capture.state.networkOrder.length;
  await p.eval(`document.querySelector('.dgm-dialog .dgm-btn-primary').click()`);
  const installEntry = await waitFor(() => {
    const found = capture.state.networkOrder
      .slice(networkBefore)
      .find((entry) => typeof entry.url === 'string' && entry.url.includes('/api/game-market/install-local') && entry.method === 'POST');
    return found && found.status !== undefined ? found : null;
  }, 30000);
  check('the UI itself sends install-local and the Host accepts it', installEntry && installEntry.status >= 200 && installEntry.status < 300, installEntry && {status: installEntry.status, url: String(installEntry.url).replace(/token=[^&]+/, 'token=<redacted>')});
  const installData = await capture.responseBody(installEntry).then((body) => JSON.parse(body)).catch(() => null);
  report.record('installResponse', installData && { ok: installData.ok, game: installData.data && installData.data.game });
  const stored = JSON.parse(fs.readFileSync(path.join(lab.home, 'storages/dsh-game-market/installations.json'), 'utf8'));
  const record = (Array.isArray(stored) ? stored : Object.values(stored.games || {})).find((item) => item.id === gameId);
  check('Host persisted the external package with release identity', record && record.version === version && record.format === 'asset-zip-v2' && record.sha256 === expectedSha, record && { id: record.id, version: record.version, format: record.format, sha256: record.sha256, source: record.source || null });
  await launchFromRow(p, capture, gameId);
  const ready = await waitFor(async () => {
    const snapshot = await probeSnapshot();
    return snapshot && snapshot.snap.phase === 'ready' ? snapshot : null;
  }, 30000);
  check('external package reaches a real ready state in Desktop', ready, ready && { sessionId: ready.sessionId, phase: ready.snap.phase, probeVersion: ready.snap.probeVersion });
  await p.shot(path.join(raw, 'M5-external-package-' + stamp + '.png'));
  await pressKey(p, ready.sessionId, 'Enter');
  const playing = await waitFor(async () => {
    const snapshot = await probeSnapshot();
    return snapshot && snapshot.snap.phase === 'playing' && snapshot.snap.elapsedMs > 1000 ? snapshot : null;
  }, 15000);
  if (!playing) {
    const clicked = await capture.evaluate(ready.sessionId, `(() => { const button = document.getElementById('primary'); if (!button || button.hidden) return false; button.click(); return true; })()`);
    report.record('startFallbackVisibleButton', clicked);
    check('external package starts from a real keyboard/visible-control input', clicked && await waitFor(async () => {
      const snapshot = await probeSnapshot();
      return snapshot && snapshot.snap.phase === 'playing' && snapshot.snap.elapsedMs > 1000 ? snapshot : null;
    }, 15000), null);
  } else {
    check('external package advances after a real Enter key press', playing.snap.elapsedMs > 1000, { elapsedMs: playing.snap.elapsedMs, score: playing.snap.score, lane: playing.snap.ship && playing.snap.ship.lane });
  }
  await sleep(600);
  const advanced = await probeSnapshot();
  report.record('finalSnapshot', advanced && { phase: advanced.snap.phase, elapsedMs: advanced.snap.elapsedMs, score: advanced.snap.score });
} catch (error) {
  report.add('completed', false, String(error.stack || error).split('\n').slice(0, 6).join('\n'));
} finally {
  if (capture) {
    report.record('browserConsole', capture.state.console.slice(-10));
    report.record('browserLogs', capture.state.logs.slice(-10));
  }
  if (lab) {
    lab.page.dispose();
    await lab.host.stop();
    report.add('owned App stopped', lab.host.child.exitCode !== null || lab.host.child.signalCode !== null);
  }
}
const result = report.finish();
fs.writeFileSync(path.join(raw, 'M5-external-package-' + stamp + '.json'), JSON.stringify(sanitiseM3(result), null, 2) + '\n');
console.log(JSON.stringify({ passed: result.passed, failed: result.failed }, null, 2));
process.exitCode = result.passed ? 0 : 1;
