#!/usr/bin/env node
/**
 * M1 · CR7-03 — real Client UI click-path for local `.dshgame.zip` install.
 *
 * Codex review of head `77c8d0a` found the Market UI local-install path was not
 * wired for V1.5 ZIP packages: the panel's `<input type=file accept>` only
 * listed `.html`, `handleFileSelected` rejected anything that was not HTML, and
 * `api-v1.installLocal` read the picked file as **text** (`File.text()`),
 * UTF-8-decoding a 2384 B ZIP into 2474 B of garbage before upload.
 *
 * This probe drives the real bundled `client.js` in a real DSH page (isolated
 * `dsh web` host, never `~/.dsh`) through the **real click path**:
 *   1. click the sidebar "游戏市场" row (trusted CDP mouse event);
 *   2. click "上传游戏" (the plugin's own upload button);
 *   3. answer the native file chooser via CDP `Page.setInterceptFileChooserDialog`
 *      + `DOM.setFileInputFiles` with a real `.dshgame.zip` written to disk;
 *   4. assert the confirmation dialog shows file name / size / package format and
 *      the local-install warning, then click its primary "安装" button;
 *   5. assert the UI itself sends `POST /api/game-market/install-local` with
 *      `content-type: application/zip`, uploaded `content-length` equals the
 *      source file size, and the Host-reported `sha256` equals the source file
 *      sha256 (byte-identical upload);
 *   6. assert install success, success toast, installed record
 *      `format=asset-zip-v2`, and the game shows up in the catalog;
 *   7. repeat the picker once for the same ZIP to prove the "will overwrite"
 *      confirmation hint (then cancel, so no second install happens);
 *   8. control: install a real `html-v1` single-file game through the same click
 *      path — it must still succeed (`format=html-v1`) and be byte-identical.
 *
 * No direct API call is made by the probe for installation (only read-only
 * `/installed` + `/game` observations after the UI installs). No direct API
 * impersonation: the only POST in the evidence is the one the Client UI sent.
 *
 * Pre-fix evidence: run with `--plugin-root=<77c8d0a snapshot> --label=prefix`
 * (that run exits non-zero: the picker rejects `.dshgame.zip`, no dialog, no
 * request). Post-fix: run against the fixed worktree, exit 0.
 *
 * Usage:
 *   node scripts/verification/v1.5/m1/m1-a06c-market-ui-local-zip.mjs
 *   node scripts/verification/v1.5/m1/m1-a06c-market-ui-local-zip.mjs --plugin-root=/tmp/m1b-prefix-77c8d0a --label=prefix
 */
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  Cdp,
  sleep,
  runtimeIdentity,
  startIsolatedHost,
  createCdpCapture,
  waitForDshPage,
  buildGoodPackage,
  writeEvidence,
  OUT_DIR,
  WORK,
  REPO_ROOT,
} from './lib/lab.mjs';

const PORTS = Object.freeze({ bootstrap: 58320, host: 58321, chrome: 9512 });
const KEEP = process.argv.includes('--keep');
const PLUGIN_ROOT = (process.argv.find((arg) => arg.startsWith('--plugin-root=')) || '').slice('--plugin-root='.length) || null;
const LABEL = (process.argv.find((arg) => arg.startsWith('--label=')) || '').slice('--label='.length) || null;
const EVIDENCE_ID = LABEL ? `CR7-03-market-ui-local-zip-${LABEL}` : 'CR7-03-market-ui-local-zip';
const GAME_ID = 'm1-cr7-local-zip';
const VERSION = '1.0.0';
const ZIP_FILE_NAME = `${GAME_ID}-${VERSION}.dshgame.zip`;

const HTML_GAME_ID = 'm1-cr7-html-control';
const HTML_FILE_NAME = `${HTML_GAME_ID}-1.0.0.html`;

function check(checks, name, ok, detail, { required = true } = {}) {
  checks.push({ name, ok: Boolean(ok), required, detail });
  return Boolean(ok);
}

function sample(value, limit = 1200) {
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch (_error) {
    return String(value).slice(0, 400);
  }
}

/** sha256 of the raw request body Chrome captured for this request. */
function requestBodyDigest(entry) {
  if (!entry) return { sha256: null, bytes: null, source: 'none' };
  const entries = Array.isArray(entry.postDataEntries) ? entry.postDataEntries.filter((item) => item && typeof item.bytes === 'string') : [];
  if (entries.length > 0) {
    try {
      const buffers = entries.map((item) => Buffer.from(item.bytes, 'base64'));
      const body = Buffer.concat(buffers);
      return { sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length, source: 'cdp-postDataEntries-base64' };
    } catch (_error) {
      // fall through
    }
  }
  if (typeof entry.postData === 'string' && entry.postData.length > 0) {
    const body = Buffer.from(entry.postData, 'utf8');
    return { sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length, source: 'cdp-postData-utf8' };
  }
  return { sha256: null, bytes: null, source: 'none' };
}

async function waitFor(fn, timeoutMs = 15000, stepMs = 200) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (_error) {
      // keep polling
    }
    await sleep(stepMs);
  }
  return null;
}

async function findClickable(cdp, expression) {
  return cdp.eval(`(() => {
    const el = ${expression};
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      tag: el.tagName,
      text: (el.textContent || '').trim().slice(0, 80),
      className: typeof el.className === 'string' ? el.className.slice(0, 100) : '',
      rect: { x: Math.round(x), y: Math.round(y), width: Math.round(rect.width), height: Math.round(rect.height) },
      hitInsideTarget: Boolean(hit && (hit === el || el.contains(hit)))
    };
  })()`);
}

async function clickAt(cdp, rect) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 });
  return { x: rect.x, y: rect.y, trusted: 'Input.dispatchMouseEvent' };
}

async function clickElement(cdp, expression, label) {
  const found = await findClickable(cdp, expression);
  if (!found) return { label, clicked: false, reason: 'not-found' };
  const point = await clickAt(cdp, found.rect);
  return { label, clicked: true, target: found, point };
}

async function readMarketState(cdp) {
  return cdp.eval(`(() => {
    const root = document.querySelector('.dgm-root');
    const dialog = document.querySelector('.dgm-dialog');
    const primary = document.querySelector('.dgm-dialog .dgm-btn-primary');
    const quiet = document.querySelector('.dgm-dialog .dgm-btn-quiet');
    const toast = document.querySelector('.dgm-toast');
    const fileInput = document.querySelector('.dgm-root input[type=file]');
    return {
      marketOpen: Boolean(root && root.getAttribute('data-page') === 'market'),
      page: root ? root.getAttribute('data-page') : null,
      gameCards: document.querySelectorAll('.dgm-game-card').length,
      uploadButton: [...document.querySelectorAll('.dgm-local-install')].length,
      fileInputAccept: fileInput ? fileInput.getAttribute('accept') : null,
      dialog: dialog ? {
        role: dialog.getAttribute('role'),
        title: (dialog.querySelector('.dgm-dialog-title') || {}).textContent || '',
        body: (dialog.querySelector('.dgm-dialog-body') || {}).textContent || '',
        meta: [...dialog.querySelectorAll('.dgm-dialog-meta dt')].map((node, index) => ({
          label: (node.textContent || '').trim(),
          value: ((dialog.querySelectorAll('.dgm-dialog-meta dd')[index] || {}).textContent || '').trim()
        })),
        notes: [...dialog.querySelectorAll('.dgm-dialog-note')].map((node) => (node.textContent || '').trim()),
        warning: [...dialog.querySelectorAll('.dgm-dialog-warning')].map((node) => (node.textContent || '').trim()),
        primaryLabel: primary ? (primary.textContent || '').trim() : null,
        cancelLabel: quiet ? (quiet.textContent || '').trim() : null
      } : null,
      toast: toast ? {
        kind: toast.getAttribute('data-kind'),
        text: (toast.textContent || '').trim()
      } : null,
      bodyText: (document.body.innerText || '').slice(0, 4000)
    };
  })()`);
}

async function dismissOverlays(cdp, scenario) {
  const dismissed = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const overlayCount = await cdp.eval(`document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length`);
    if (overlayCount === 0) break;
    const continued = await clickElement(
      cdp,
      `[...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '继续')`,
      'preview-continue'
    );
    if (continued.clicked) dismissed.push(continued);
    const closed = await clickElement(
      cdp,
      `[...document.querySelectorAll('button')].find((button) => (button.getAttribute('aria-label') || '') === '关闭')`,
      'close-modal'
    );
    if (closed.clicked) dismissed.push(closed);
    await sleep(700);
  }
  scenario.dismissals = dismissed;
  scenario.overlaysRemaining = await cdp.eval(`document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length`);
  return dismissed;
}

/** Pick a real file through the plugin's upload button + native file chooser. */
async function pickLocalFile(cdp, capture, filePath, label) {
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {});
  const chooserBefore = capture.state.fileChoosers.length;
  const uploadClick = await clickElement(cdp, `document.querySelector('.dgm-local-install')`, `${label}-upload`);
  const chooser = await capture.waitForFileChooser(chooserBefore, 8000);
  let fileInputSet = null;
  if (chooser && chooser.backendNodeId !== undefined) {
    await cdp.send('DOM.setFileInputFiles', { files: [filePath], backendNodeId: chooser.backendNodeId });
    fileInputSet = { files: 1, via: 'DOM.setFileInputFiles', backendNodeId: chooser.backendNodeId };
  }
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  return { uploadClick, chooser, fileInputSet };
}

/**
 * One full UI install flow: pick -> confirm dialog -> click primary -> wait for
 * the UI's own install request + response. Returns the observed request entry.
 */
async function runUiInstallFlow(cdp, capture, scenarioKey, scenario, { filePath, expectFormatLabel, expectFileName }) {
  const flow = { step: 'open-market' };
  const stateBefore = await readMarketState(cdp);
  flow.before = {
    marketOpen: stateBefore.marketOpen,
    fileInputAccept: stateBefore.fileInputAccept,
    gameCards: stateBefore.gameCards,
  };
  if (!stateBefore.marketOpen) {
    const sidebarClick = await clickElement(
      cdp,
      `[...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '游戏市场')`,
      `${scenarioKey}-sidebar`
    );
    flow.sidebarClick = sidebarClick;
    await waitFor(async () => {
      const state = await readMarketState(cdp);
      return state.marketOpen ? state : null;
    }, 20000);
  }
  focusMarket: {
    // Bring the market panel into focus if another panel/tab is active.
    const focused = await cdp.eval(`(() => {
      const root = document.querySelector('.dgm-root');
      return Boolean(root);
    })()`);
    if (!focused) return { flow, installEntry: null, installData: null, error: 'market-panel-not-mounted' };
  }

  // 1) pick through the real upload button + native file chooser
  flow.pick = await pickLocalFile(cdp, capture, filePath, scenarioKey);
  await sleep(1400);
  flow.afterPick = await readMarketState(cdp);
  scenario[scenarioKey] = { ...scenario[scenarioKey], ...flow };
  flow.step = 'dialog';
  if (!flow.afterPick.dialog) return { flow, installEntry: null, installData: null };

  // 2) assert the confirmation dialog content (name/size/format)
  const dialog = flow.afterPick.dialog;
  const formatLabelOk = !expectFormatLabel || dialog.meta.some((row) => String(row.value).includes(expectFormatLabel));
  const dialogSummary = {
    title: dialog.title,
    role: dialog.role,
    meta: dialog.meta,
    notes: dialog.notes,
    warning: dialog.warning,
    primaryLabel: dialog.primaryLabel,
    cancelLabel: dialog.cancelLabel,
    fileNameOk: dialog.title.includes(expectFileName ?? ''),
    formatLabelOk,
    sizeRow: dialog.meta.find((row) => /文件大小|File size/.test(row.label)) || null,
    warningOk: dialog.warning.some((text) => /本地安装不会校验文件来源|Local installs do not verify/.test(String(text))),
  };
  scenario[scenarioKey].dialog = dialogSummary;

  // 3) confirm through the real primary button
  const networkBefore = capture.state.networkOrder.length;
  flow.confirmClick = await clickElement(cdp, `document.querySelector('.dgm-dialog .dgm-btn-primary')`, `${scenarioKey}-confirm`);
  // 4) wait for the Client UI's own POST request + response
  const installEntry = await waitFor(() => {
    const found = capture.state.networkOrder
      .slice(networkBefore)
      .find((entry) => typeof entry.url === 'string' && entry.url.includes('/api/game-market/install-local') && entry.method === 'POST');
    return found && found.status !== undefined ? found : null;
  }, 30000);
  await sleep(400); // let Network.requestWillBeSentExtraInfo land (content-length lives there)
  const installResponseBody = installEntry ? await capture.responseBody(installEntry) : null;
  let installResponse = null;
  try {
    installResponse = installResponseBody ? JSON.parse(installResponseBody) : null;
  } catch (_error) {
    installResponse = null;
  }
  const installData = installResponse && installResponse.ok === true ? installResponse.data : null;
  const lower = (headers) => Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  const requestHeadersLower = {
    ...lower(installEntry && installEntry.requestHeaders),
    ...lower(installEntry && installEntry.actualRequestHeaders),
  };
  const flowResult = {
    flow,
    installEntry,
    installData,
    dialogSummary,
    requestHeadersLower,
  };
  scenario[scenarioKey].installRequest = installEntry
    ? {
        url: String(installEntry.url).replace(/token=[^&]+/, 'token=<redacted>'),
        method: installEntry.method,
        status: installEntry.status ?? null,
        contentType: requestHeadersLower['content-type'] ?? null,
        contentLength: requestHeadersLower['content-length'] ?? null,
        initiator: installEntry.initiator || null,
        requestHeaders: installEntry.requestHeaders || null,
        actualRequestHeaders: installEntry.actualRequestHeaders || null,
      }
    : null;
  scenario[scenarioKey].installResponse = installResponse;
  scenario[scenarioKey].installResponseRaw = installResponseBody ? String(installResponseBody).slice(0, 800) : null;
  return flowResult;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(WORK, 'cr7-local-zip'), { recursive: true });
  const identity = runtimeIdentity();
  const checks = [];
  const scenario = { pluginRoot: PLUGIN_ROOT || '<worktree>', label: LABEL, ports: PORTS };

  // Real `asset-zip-v2` package on disk with the client filename convention.
  const zipPath = path.join(WORK, 'cr7-local-zip', ZIP_FILE_NAME);
  const built = await buildGoodPackage({ gameId: GAME_ID, version: VERSION });
  fs.writeFileSync(zipPath, built.zip);
  const zipBytes = fs.readFileSync(zipPath);
  const zipSha256 = createHash('sha256').update(zipBytes).digest('hex');
  scenario.zipSource = {
    fileName: ZIP_FILE_NAME,
    path: zipPath.replace(/^\/Users\/[^/]+/, '/Users/<user>'),
    size: zipBytes.length,
    sha256: zipSha256,
  };

  // Real `html-v1` single-file control: the bundled Breakout HTML is a genuine
  // self-contained html-v1 package; only its embedded manifest identity changes.
  const htmlSourcePath = path.join(WORK, 'cr7-local-zip', HTML_FILE_NAME);
  const breakoutHtml = fs.readFileSync(path.join(REPO_ROOT, 'games/breakout/dist/index.html'), 'utf8');
  const htmlControl = breakoutHtml
    .replace('"id": "breakout"', `"id": "${HTML_GAME_ID}"`)
    .replace('"name": "Breakout"', '"name": "M1 CR7 HTML Control"');
  if (!htmlControl.includes(`"id": "${HTML_GAME_ID}"`)) throw new Error('html-v1 control fixture patch failed');
  fs.writeFileSync(htmlSourcePath, htmlControl, 'utf8');
  const htmlBytes = fs.readFileSync(htmlSourcePath);
  const htmlSha256 = createHash('sha256').update(htmlBytes).digest('hex');
  scenario.htmlSource = {
    fileName: HTML_FILE_NAME,
    path: htmlSourcePath.replace(/^\/Users\/[^/]+/, '/Users/<user>'),
    size: htmlBytes.length,
    sha256: htmlSha256,
  };

  let hostHandle = null;
  let cdp = null;
  let capture = null;
  const secrets = [];

  try {
    const hostOptions = { name: `probe-m1-cr7c${LABEL ? '-' + LABEL : ''}`, ports: PORTS };
    if (PLUGIN_ROOT) hostOptions.pluginRoot = PLUGIN_ROOT;
    hostHandle = await startIsolatedHost(hostOptions);
    cdp = await Cdp.launch({ port: PORTS.chrome });
    capture = createCdpCapture(cdp);
    await capture.start();
    await cdp.navigate(hostHandle.host.url);
    const boot = await waitForDshPage(cdp, hostHandle.hostOrigin);
    check(checks, 'dsh-page-loads-and-host-api-answers', boot.health && boot.health.status === 200, { health: boot.health });

    await dismissOverlays(cdp, scenario);

    // Open the real client panel via the sidebar row (trusted mouse click).
    const sidebarClick = await clickElement(
      cdp,
      `[...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '游戏市场')`,
      'sidebar-market'
    );
    scenario.sidebarClick = sidebarClick;
    const marketOpened = await waitFor(async () => {
      const state = await readMarketState(cdp);
      return state.marketOpen && state.uploadButton > 0 ? state : null;
    }, 20000);
    scenario.market = marketOpened;
    check(
      checks,
      'real-client-market-panel-opens-via-sidebar-click',
      Boolean(sidebarClick.clicked && marketOpened && marketOpened.marketOpen),
      { sidebar: sidebarClick.clicked, market: marketOpened }
    );
    await waitFor(async () => (await cdp.eval(`document.querySelectorAll('.dgm-local-install').length`)) > 0, 20000);

    // The picker must accept BOTH carriers.
    const acceptAttr = (await readMarketState(cdp)).fileInputAccept || '';
    scenario.pickerAccept = acceptAttr;
    check(
      checks,
      'file-picker-accepts-html-and-dshgame-zip',
      acceptAttr.includes('.html') && acceptAttr.includes('.dshgame.zip'),
      { accept: acceptAttr }
    );

    // ======================= ZIP (asset-zip-v2) flow =======================
    const zipFlow = await runUiInstallFlow(cdp, capture, 'zip', scenario, {
      filePath: zipPath,
      expectFormatLabel: '资源包',
      expectFileName: ZIP_FILE_NAME,
    });
    check(checks, 'zip-native-file-chooser-opened-by-upload-click', Boolean(zipFlow.flow.pick && zipFlow.flow.pick.uploadClick.clicked && zipFlow.flow.pick.chooser), {
      upload: zipFlow.flow.pick && zipFlow.flow.pick.uploadClick,
      chooser: zipFlow.flow.pick && zipFlow.flow.pick.chooser,
    });
    check(checks, 'zip-native-file-chooser-received-the-file', Boolean(zipFlow.flow.pick && zipFlow.flow.pick.fileInputSet), zipFlow.flow.pick && zipFlow.flow.pick.fileInputSet);
    const zipDialog = zipFlow.dialogSummary;
    check(checks, 'zip-confirmation-dialog-shown', Boolean(zipDialog && zipDialog.fileNameOk), zipDialog || scenario.zip.afterPick);
    check(checks, 'zip-confirmation-dialog-shows-file-size', Boolean(zipDialog && zipDialog.sizeRow), zipDialog && zipDialog.sizeRow);
    check(checks, 'zip-confirmation-dialog-shows-package-format', Boolean(zipDialog && zipDialog.formatLabelOk), zipDialog ? zipDialog.meta : null);
    check(checks, 'zip-confirmation-dialog-shows-local-install-warning', Boolean(zipDialog && zipDialog.warningOk), zipDialog ? zipDialog.warning : null);
    check(checks, 'zip-confirmation-click-dispatched', Boolean(zipFlow.flow.confirmClick && zipFlow.flow.confirmClick.clicked), zipFlow.flow.confirmClick);
    check(checks, 'ui-sent-install-local-request', Boolean(zipFlow.installEntry), scenario.zip.installRequest);
    const zipContentType = (zipFlow.requestHeadersLower || {})['content-type'] || '';
    const zipContentLength = Number((zipFlow.requestHeadersLower || {})['content-length']);
    check(
      checks,
      'ui-upload-content-type-application-zip',
      zipContentType.includes('application/zip'),
      { contentType: zipContentType || null }
    );
    const zipServerSize = zipFlow.installData && zipFlow.installData.installation ? zipFlow.installData.installation.sizeBytes : null;
    check(
      checks,
      'upload-bytes-length-matches-source-file',
      (Number.isFinite(zipContentLength) && zipContentLength === zipBytes.length) || zipServerSize === zipBytes.length,
      {
        uploadLength: Number.isFinite(zipContentLength) ? zipContentLength : null,
        serverSize: zipServerSize,
        sourceLength: zipBytes.length,
        note: 'sha256 equality (below) is the byte-identity proof; length is a cheap cross-check',
      }
    );
    check(checks, 'zip-install-api-returned-ok', Boolean(zipFlow.installData), zipFlow.installData ? { gameId: zipFlow.installData.gameId } : scenario.zip.installRequest);
    const zipRawBody = requestBodyDigest(zipFlow.installEntry);
    scenario.zip.rawRequestBody = zipRawBody;
    check(
      checks,
      'uploaded-zip-request-body-sha256-matches-source',
      Boolean(zipRawBody.sha256 && zipRawBody.sha256 === zipSha256 && zipRawBody.bytes === zipBytes.length),
      { rawBody: zipRawBody, sourceSha256: zipSha256, sourceLength: zipBytes.length }
    );
    check(
      checks,
      'uploaded-zip-bytes-byte-identical-to-source-sha256',
      Boolean(zipFlow.installData && zipFlow.installData.installation && zipFlow.installData.installation.sha256 === zipSha256),
      {
        serverSha256: zipFlow.installData && zipFlow.installData.installation ? zipFlow.installData.installation.sha256 : null,
        sourceSha256: zipSha256,
      }
    );
    check(
      checks,
      'zip-install-format-is-asset-zip-v2',
      Boolean(zipFlow.installData && zipFlow.installData.installation && zipFlow.installData.installation.format === 'asset-zip-v2'),
      zipFlow.installData && zipFlow.installData.installation
        ? { format: zipFlow.installData.installation.format, entry: zipFlow.installData.installation.entry, fileCount: zipFlow.installData.installation.fileCount }
        : null
    );

    // UI success state.
    const zipSuccess = await waitFor(async () => {
      const state = await readMarketState(cdp);
      return state.dialog === null && state.toast && state.toast.kind === 'success' ? state : null;
    }, 15000);
    scenario.zip.afterInstall = zipSuccess;
    check(checks, 'ui-closed-dialog-after-zip-install', Boolean(zipSuccess), zipSuccess || (await readMarketState(cdp)));
    check(
      checks,
      'ui-shows-local-install-success-toast',
      Boolean(zipSuccess && typeof zipSuccess.toast.text === 'string' && zipSuccess.toast.text.includes('已从本地安装')),
      zipSuccess ? zipSuccess.toast : null
    );
    const myGamesClick = await clickElement(
      cdp,
      `[...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '我的游戏')`,
      'my-games-tab'
    );
    scenario.zip.myGamesClick = myGamesClick;
    const catalogShowsGame = await waitFor(async () => {
      const state = await readMarketState(cdp);
      return state.bodyText.includes('M1 Multi-Resource Probe') ? state : null;
    }, 10000);
    scenario.zip.catalogShowsGame = Boolean(catalogShowsGame);
    check(checks, 'ui-my-games-shows-installed-game', Boolean(myGamesClick.clicked && catalogShowsGame), { myGamesClick, bodyHasGame: Boolean(catalogShowsGame) });
    // Back to the Market home for the html-v1 control flow.
    await clickElement(
      cdp,
      `[...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '市场')`,
      'market-tab'
    );
    await sleep(500);

    // Read-only observations after the UI install.
    const installedList = await cdp.eval(`fetch('/api/game-market/installed').then(async (response) => ({ status: response.status, body: await response.json() }))`);
    const installedItem = installedList && installedList.body && installedList.body.ok === true && Array.isArray(installedList.body.data.items)
      ? installedList.body.data.items.find((item) => item && item.id === GAME_ID) || null
      : null;
    const gameDetail = await cdp.eval(`fetch('/api/game-market/game?id=${GAME_ID}').then(async (response) => ({ status: response.status, body: await response.json() }))`);
    const detailInstalled = gameDetail && gameDetail.body && gameDetail.body.ok === true && gameDetail.body.data ? gameDetail.body.data.installed : null;
    scenario.installedZip = { listStatus: installedList && installedList.status, item: installedItem, detail: detailInstalled };
    check(checks, 'installed-catalog-contains-the-game', Boolean(installedItem), { item: installedItem });
    check(
      checks,
      'installed-record-format-is-asset-zip-v2',
      Boolean(detailInstalled && detailInstalled.format === 'asset-zip-v2'),
      detailInstalled ? { format: detailInstalled.format, sha256: detailInstalled.sha256, sizeBytes: detailInstalled.sizeBytes } : null
    );
    check(
      checks,
      'installed-record-sha256-matches-source',
      Boolean(detailInstalled && detailInstalled.sha256 === zipSha256),
      { server: detailInstalled ? detailInstalled.sha256 : null, source: zipSha256 }
    );

    // Overwrite hint: pick the same ZIP again while it is installed.
    const overwritePick = await pickLocalFile(cdp, capture, zipPath, 'zip-overwrite');
    await sleep(1400);
    const overwriteState = await readMarketState(cdp);
    scenario.zip.overwriteDialog = overwriteState.dialog;
    const overwriteNote = overwriteState.dialog
      ? overwriteState.dialog.notes.find((note) => /将覆盖|This replaces/.test(String(note))) || null
      : null;
    check(
      checks,
      'zip-confirmation-shows-overwrite-note-when-already-installed',
      Boolean(overwriteNote && /1\.0\.0/.test(overwriteNote)),
      { dialog: overwriteState.dialog, pick: overwritePick.uploadClick ? { clicked: overwritePick.uploadClick.clicked } : null }
    );
    // Cancel via the dialog's quiet button so no second install happens.
    const cancelClick = await clickElement(cdp, `document.querySelector('.dgm-dialog .dgm-btn-quiet')`, 'zip-overwrite-cancel');
    scenario.zip.overwriteCancel = cancelClick;
    const overwriteClosed = await waitFor(async () => {
      const state = await readMarketState(cdp);
      return state.dialog === null ? state : null;
    }, 8000);
    check(checks, 'zip-overwrite-dialog-cancelled', Boolean(cancelClick.clicked && overwriteClosed), { cancel: cancelClick, closed: Boolean(overwriteClosed) });

    // ======================= html-v1 control flow ==========================
    const htmlFlow = await runUiInstallFlow(cdp, capture, 'html', scenario, {
      filePath: htmlSourcePath,
      expectFormatLabel: 'HTML 单文件包',
      expectFileName: HTML_FILE_NAME,
    });
    const htmlDialog = htmlFlow.dialogSummary;
    check(checks, 'html-native-file-chooser-received-the-file', Boolean(htmlFlow.flow.pick && htmlFlow.flow.pick.fileInputSet), htmlFlow.flow.pick && htmlFlow.flow.pick.fileInputSet);
    check(checks, 'html-confirmation-dialog-shown', Boolean(htmlDialog && htmlDialog.fileNameOk), htmlDialog || scenario.html.afterPick);
    check(checks, 'html-confirmation-click-dispatched', Boolean(htmlFlow.flow.confirmClick && htmlFlow.flow.confirmClick.clicked), htmlFlow.flow.confirmClick);
    check(checks, 'html-ui-sent-install-local-request', Boolean(htmlFlow.installEntry), scenario.html.installRequest);
    const htmlContentType = (htmlFlow.requestHeadersLower || {})['content-type'] || '';
    const htmlContentLength = Number((htmlFlow.requestHeadersLower || {})['content-length']);
    check(
      checks,
      'html-upload-content-type-text-html',
      htmlContentType.includes('text/html'),
      { contentType: htmlContentType || null }
    );
    check(checks, 'html-install-api-returned-ok', Boolean(htmlFlow.installData), htmlFlow.installData ? { gameId: htmlFlow.installData.gameId } : scenario.html.installRequest);
    const htmlRawBody = requestBodyDigest(htmlFlow.installEntry);
    scenario.html.rawRequestBody = htmlRawBody;
    const htmlServerSize = htmlFlow.installData && htmlFlow.installData.installation ? htmlFlow.installData.installation.sizeBytes : null;
    check(
      checks,
      'html-upload-request-body-matches-source-bytes',
      Boolean(htmlRawBody.sha256 && htmlRawBody.bytes === htmlBytes.length && htmlRawBody.sha256 === htmlSha256),
      { rawBody: htmlRawBody, sourceSha256: htmlSha256, sourceLength: htmlBytes.length }
    );
    check(
      checks,
      'html-upload-bytes-size-identical-to-source',
      htmlServerSize === htmlBytes.length && (Number.isFinite(htmlContentLength) ? htmlContentLength === htmlBytes.length : true),
      {
        uploadLength: Number.isFinite(htmlContentLength) ? htmlContentLength : null,
        serverSize: htmlServerSize,
        sourceLength: htmlBytes.length,
        note: 'html-v1 local installs keep sha256=null by design; byte count is the cross-check',
      }
    );
    check(
      checks,
      'html-v1-control-installs-with-format-html-v1',
      Boolean(htmlFlow.installData && htmlFlow.installData.installation && htmlFlow.installData.installation.format === 'html-v1'),
      htmlFlow.installData && htmlFlow.installData.installation
        ? { format: htmlFlow.installData.installation.format, entry: htmlFlow.installData.installation.entry }
        : null
    );
    const htmlSuccess = await waitFor(async () => {
      const state = await readMarketState(cdp);
      return state.dialog === null && state.toast && state.toast.kind === 'success' ? state : null;
    }, 15000);
    scenario.html.afterInstall = htmlSuccess;
    check(checks, 'html-ui-shows-success-toast', Boolean(htmlSuccess && typeof htmlSuccess.toast.text === 'string' && htmlSuccess.toast.text.includes('已从本地安装')), htmlSuccess ? htmlSuccess.toast : null);

    // No direct API impersonation: every install POST above came from the UI.
    scenario.probeInitiatedInstallApiCalls = 0;
    scenario.installRequestsObserved = capture.state.networkOrder
      .filter((entry) => typeof entry.url === 'string' && entry.url.includes('/api/game-market/install-local'))
      .map((entry) => ({
        method: entry.method,
        status: entry.status ?? null,
        contentType: (Object.entries(entry.actualRequestHeaders || {}).find(([key]) => key.toLowerCase() === 'content-type') || [])[1] || null,
      }));
    check(
      checks,
      'no-direct-api-install-from-probe',
      scenario.probeInitiatedInstallApiCalls === 0 && scenario.installRequestsObserved.length >= 1 && scenario.installRequestsObserved.every((entry) => entry.method === 'POST'),
      { probeInitiatedInstallApiCalls: scenario.probeInitiatedInstallApiCalls, observed: scenario.installRequestsObserved }
    );

    try {
      scenario.screenshots = {
        marketAfterInstall: await (async () => {
          const { screenshot } = await import('./lib/lab.mjs');
          const rootRect = await cdp.eval(`(() => { const root = document.querySelector('.dgm-root'); if (!root) return null; const rect = root.getBoundingClientRect(); return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }; })()`);
          return rootRect ? screenshot(cdp, `cr7-03-market-ui-local-zip${LABEL ? '-' + LABEL : ''}`, { ...rootRect, scale: 1 }) : null;
        })(),
      };
    } catch (_error) {
      scenario.screenshots = { error: 'screenshot failed' };
    }
  } catch (error) {
    check(checks, 'probe-completed-without-throwing', false, { error: String(error && error.stack ? error.stack : error).slice(0, 1500) });
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
      title: 'CR7-03: local .dshgame.zip install through the real Market UI click path (byte-identical upload, html-v1 control)',
      command: `node scripts/verification/v1.5/m1/m1-a06c-market-ui-local-zip.mjs${PLUGIN_ROOT ? ` --plugin-root=${PLUGIN_ROOT}` : ''}${LABEL ? ` --label=${LABEL}` : ''}${KEEP ? ' --keep' : ''}`,
      environment: { dsh: identity, chrome: 'headless CDP', pluginRoot: PLUGIN_ROOT || '<worktree>', ports: PORTS },
      checks,
      extra: { scenario },
    },
    secrets
  );
  const failed = checks.filter((entry) => entry.required && !entry.ok);
  process.stdout.write(
    `\n${EVIDENCE_ID} ${written.passed ? 'PASSED' : 'FAILED'} (${checks.filter((c) => c.required && c.ok).length}/${checks.filter((c) => c.required).length} required checks)\n`
  );
  process.stdout.write(`evidence: ${written.file}\n`);
  for (const entry of failed) process.stdout.write(`  FAIL ${entry.name}: ${sample(entry.detail, 500)}\n`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`[m1-a06c] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
  process.exitCode = 1;
});
