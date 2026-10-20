/**
 * Shared real-UI automation helpers for the M2 probes.
 *
 * Everything here drives the *bundled Client panel* in a real DSH page:
 * trusted CDP mouse events for clicks, the real plugin upload button plus the
 * native file-chooser protocol events (Page.setInterceptFileChooserDialog +
 * DOM.setFileInputFiles) for local packages, and the client's own confirmation
 * dialog for installs. No API is called directly to perform an action.
 */
import { sleep } from './lab.mjs';

export async function waitFor(fn, timeoutMs = 15000, stepMs = 200) {
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

export async function findClickable(cdp, expression) {
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

export async function clickAt(cdp, rect) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 });
  return { x: rect.x, y: rect.y, trusted: 'Input.dispatchMouseEvent' };
}

export async function clickElement(cdp, expression, label) {
  const found = await findClickable(cdp, expression);
  if (!found) return { label, clicked: false, reason: 'not-found' };
  const point = await clickAt(cdp, found.rect);
  return { label, clicked: true, target: found, point };
}

export async function clickButtonText(cdp, text, label) {
  return clickElement(
    cdp,
    `[...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === ${JSON.stringify(text)})`,
    label || `button:${text}`
  );
}

/** Read the panel + runtime DOM state (client UI). */
export async function readUiState(cdp) {
  return cdp.eval(`(() => {
    const root = document.querySelector('.dgm-root');
    const runtime = document.querySelector('.dgm-runtime');
    const dialog = document.querySelector('.dgm-dialog');
    const primary = dialog ? dialog.querySelector('.dgm-btn-primary, .dgm-btn-danger') : null;
    const toast = document.querySelector('.dgm-toast');
    const fileInput = document.querySelector('.dgm-root input[type=file]');
    const rows = [...document.querySelectorAll('.dgm-row')].map((row) => ({
      id: row.getAttribute('data-row-id'),
      playText: (row.querySelector('.dgm-row-play') || {}).textContent || '',
      menu: Boolean(row.querySelector('.dgm-row-menu-btn'))
    }));
    return {
      panelOpen: Boolean(root),
      page: root ? root.getAttribute('data-page') : null,
      rows: rows,
      dialog: dialog ? {
        role: dialog.getAttribute('role'),
        title: (dialog.querySelector('.dgm-dialog-title') || {}).textContent || '',
        body: (dialog.querySelector('.dgm-dialog-body') || {}).textContent || '',
        meta: [...dialog.querySelectorAll('.dgm-dialog-meta dt')].map((node, index) => ({
          label: (node.textContent || '').trim(),
          value: ((dialog.querySelectorAll('.dgm-dialog-meta dd')[index] || {}).textContent || '').trim()
        })),
        notes: [...dialog.querySelectorAll('.dgm-dialog-note')].map((node) => (node.textContent || '').trim()),
        primaryLabel: primary ? (primary.textContent || '').trim() : null
      } : null,
      runtime: runtime ? {
        state: runtime.getAttribute('data-runtime-state'),
        stage: Boolean(runtime.querySelector('.dgm-stage')),
        savePill: (runtime.querySelector('.dgm-save-pill') || {}).textContent || null,
        controls: [...runtime.querySelectorAll('.dgm-control-btn')].map((button) => ({
          label: button.getAttribute('aria-label') || '',
          disabled: button.disabled === true
        }))
      } : null,
      toast: toast ? { kind: toast.getAttribute('data-kind'), text: (toast.textContent || '').trim() } : null,
      fileInputAccept: fileInput ? fileInput.getAttribute('accept') : null,
      bodySnippet: (document.body.innerText || '').slice(0, 2000)
    };
  })()`);
}

/** Close the boot-time preview / API-key overlays so the sidebar is usable. */
export async function dismissOverlays(cdp, scenario) {
  const dismissed = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const overlayCount = await cdp.eval(`document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length`);
    if (overlayCount === 0) break;
    const continued = await clickButtonText(cdp, '继续', 'preview-continue');
    if (continued.clicked) dismissed.push(continued);
    const closed = await clickElement(
      cdp,
      `[...document.querySelectorAll('button')].find((button) => (button.getAttribute('aria-label') || '') === '关闭')`,
      'close-modal'
    );
    if (closed.clicked) dismissed.push(closed);
    await sleep(700);
  }
  if (scenario) scenario.dismissals = dismissed;
  return dismissed;
}

/** Make sure the real Client market panel is open on its home ("市场") page. */
export async function openMarketPanel(cdp, scenario) {
  let state = await readUiState(cdp);
  const steps = [];
  if (!state.panelOpen) {
    const sidebar = await clickElement(
      cdp,
      `[...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === '游戏市场')`,
      'sidebar-market'
    );
    steps.push({ sidebar });
    await waitFor(async () => {
      const current = await readUiState(cdp);
      return current.panelOpen ? current : null;
    }, 20000);
    state = await readUiState(cdp);
  }
  if (state.panelOpen && state.page !== 'market') {
    const tab = await clickElement(cdp, `document.querySelector('#dgm-tab-market')`, 'market-tab');
    steps.push({ tab });
    await waitFor(async () => {
      const current = await readUiState(cdp);
      return current.page === 'market' ? current : null;
    }, 15000);
  }
  const opened = await waitFor(async () => {
    const current = await readUiState(cdp);
    return current.panelOpen && current.page === 'market' ? current : null;
  }, 15000);
  if (scenario) scenario.openMarket = { opened: Boolean(opened), steps };
  return { opened: Boolean(opened), steps };
}

/** Switch to the "我的游戏" tab. */
export async function openMyGamesTab(cdp, scenario) {
  const click = await clickElement(cdp, `document.querySelector('#dgm-tab-mygames')`, 'mygames-tab');
  const state = await waitFor(async () => {
    const current = await readUiState(cdp);
    return current.page === 'my-games' ? current : null;
  }, 15000);
  if (scenario) scenario.openMyGames = { click, page: state ? state.page : null };
  return { click, state };
}

/** Switch to the "市场" tab. */
export async function openMarketTab(cdp, scenario) {
  const click = await clickElement(cdp, `document.querySelector('#dgm-tab-market')`, 'market-tab');
  const state = await waitFor(async () => {
    const current = await readUiState(cdp);
    return current.page === 'market' ? current : null;
  }, 15000);
  if (scenario) scenario.openMarketTab = { click, page: state ? state.page : null };
  return { click, state };
}

/** Wait until a row for `gameId` exists (or disappears when `expectGone`). */
export async function waitForRow(cdp, gameId, { expectGone = false, timeoutMs = 20000 } = {}) {
  return waitFor(async () => {
    const state = await readUiState(cdp);
    const row = state.rows.find((item) => item.id === gameId) || null;
    if (expectGone) return row === null ? state : null;
    return row || null;
  }, timeoutMs);
}

/** Pick a real file through the plugin upload button + native file chooser. */
export async function pickLocalFile(cdp, capture, filePath, label = 'upload') {
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
 * Run one full local-install click flow: upload button -> native chooser ->
 * confirmation dialog -> confirm -> UI's own POST. Returns the captured request,
 * its response and the dialog text.
 */
export async function runUiInstallFlow(cdp, capture, { filePath, label, expectFileName, expectFormatLabel }) {
  const flow = { label };
  // An install must start from the Market surface: if a game runtime is still
  // mounted (e.g. a previous launch), run its real leave protocol first.
  const mounted = await readUiState(cdp);
  if (mounted.runtime) {
    flow.leaveBeforeInstall = await leaveRuntime(cdp);
  }
  await openMarketPanel(cdp);
  // The upload control lives on the market home header.
  await waitFor(async () => (await cdp.eval(`document.querySelectorAll('.dgm-local-install').length`)) > 0, 20000);
  flow.pick = await pickLocalFile(cdp, capture, filePath, label);
  await sleep(1400);
  const afterPick = await readUiState(cdp);
  flow.afterPick = afterPick;
  if (!afterPick.dialog) return { ...flow, installEntry: null, installResponse: null, installData: null };
  flow.dialog = {
    ...afterPick.dialog,
    fileNameOk: expectFileName ? afterPick.dialog.title.includes(expectFileName) : null,
    formatLabelOk: expectFormatLabel ? afterPick.dialog.meta.some((row) => String(row.value).includes(expectFormatLabel)) : null,
  };
  const networkBefore = capture.state.networkOrder.length;
  flow.confirmClick = await clickElement(cdp, `document.querySelector('.dgm-dialog .dgm-btn-primary, .dgm-dialog .dgm-btn-danger')`, `${label}-confirm`);
  const installEntry = await waitFor(() => {
    const found = capture.state.networkOrder
      .slice(networkBefore)
      .find((entry) => typeof entry.url === 'string' && entry.url.includes('/api/game-market/install-local') && entry.method === 'POST');
    return found && found.status !== undefined ? found : null;
  }, 30000);
  await sleep(400);
  const raw = installEntry ? await capture.responseBody(installEntry) : null;
  let installResponse = null;
  try {
    installResponse = raw ? JSON.parse(raw) : null;
  } catch (_error) {
    installResponse = null;
  }
  const lower = (headers) => Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  const headersLower = {
    ...lower(installEntry && installEntry.requestHeaders),
    ...lower(installEntry && installEntry.actualRequestHeaders),
  };
  flow.installEntry = installEntry;
  flow.installResponse = installResponse;
  flow.installData = installResponse && installResponse.ok === true ? installResponse.data : null;
  flow.requestHeaders = headersLower;
  return flow;
}

/** Read the last M2L console event captured for a game session (or globally). */
export function parsedLifecycleEvents(capture, prefix = 'M2L ') {
  const events = [];
  for (const entry of capture.state.console) {
    if (typeof entry.text !== 'string' || !entry.text.startsWith(prefix)) continue;
    try {
      events.push({ sessionId: entry.sessionId, at: entry.at, ...JSON.parse(entry.text.slice(prefix.length)) });
    } catch (_error) {
      events.push({ sessionId: entry.sessionId, at: entry.at, unparsed: entry.text.slice(0, 200) });
    }
  }
  return events;
}

export async function waitForLifecycleEvent(capture, predicate, timeoutMs = 30000) {
  return waitFor(() => {
    const match = parsedLifecycleEvents(capture).find(predicate);
    return match || null;
  }, timeoutMs);
}

/**
 * Click the runtime's back control ("返回市场") and wait for the runtime to be
 * destroyed (the leave protocol pauses + saves first).
 */
export async function leaveRuntime(cdp, shotPrefix = null) {
  const before = await readUiState(cdp);
  const click = await clickElement(
    cdp,
    `(() => {
      const buttons = [...document.querySelectorAll('.dgm-runtime .dgm-control-btn')];
      return buttons.find((button) => (button.getAttribute('aria-label') || '').includes('返回市场'))
        || buttons[0]
        || null;
    })()`,
    'runtime-back'
  );
  const left = await waitFor(async () => {
    const state = await readUiState(cdp);
    return state.runtime === null ? state : null;
  }, 20000);
  return { click, before, left };
}

/** Launch a game from the real My Games row ("开始"/"继续" button). */
export async function launchFromRow(cdp, capture, gameId, { expectRuntimeMs = 30000 } = {}) {
  await openMyGamesTab(cdp);
  const row = await waitForRow(cdp, gameId, { timeoutMs: 20000 });
  const play = await clickElement(cdp, `document.querySelector('.dgm-row[data-row-id="${gameId}"] .dgm-row-play')`, `row-play:${gameId}`);
  const runtime = await waitFor(async () => {
    const state = await readUiState(cdp);
    return state.runtime && state.runtime.stage ? state.runtime : null;
  }, expectRuntimeMs);
  return { row, play, runtime };
}
