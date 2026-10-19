/**
 * 2048 · game shell: SDK handshake, input, lifecycle, persistence.
 *
 * The platform contract lives here (docs/V1-CONTRACTS.md §8, §10):
 *   ready -> session.start(); pause/hidden stop the clock; before-save writes
 *   `current`; Game Over submits the score once and ends the session; the
 *   Player Best comes from score.getBest(). Opening dist/index.html directly
 *   falls back to a tiny in-memory/local preview SDK so the single file stays
 *   playable outside the host, without any network access.
 */

import { addElapsed, beginPlay, canUndo, continueAfterWin, createGame, deserialize, highestTile, move, normalizeDirection, serialize, undo, undoAllowance } from './logic.js';
import { createRenderer, formatNumber } from './render.js';

function mediaMatches(query) {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  } catch (_error) {
    return false;
  }
}

function readParams() {
  try {
    return new URLSearchParams(window.location.search);
  } catch (_error) {
    return new URLSearchParams('');
  }
}

function createOfflineStore() {
  const memory = new Map();
  let local = null;
  try {
    local = window.localStorage;
    const probe = '__dsh2048_probe__';
    local.setItem(probe, '1');
    local.removeItem(probe);
  } catch (_error) {
    local = null;
  }
  function read(key) {
    const storageKey = `dsh2048.${key}`;
    if (local) {
      try {
        const raw = local.getItem(storageKey);
        if (raw !== null) return JSON.parse(raw);
      } catch (_error) {
        // Fall through to the in-memory copy.
      }
    }
    return memory.has(storageKey) ? memory.get(storageKey) : undefined;
  }
  function write(key, value) {
    const storageKey = `dsh2048.${key}`;
    memory.set(storageKey, value);
    if (local) {
      try {
        local.setItem(storageKey, JSON.stringify(value));
      } catch (_error) {
        // Storage may be unavailable or full; the game still works.
      }
    }
  }
  function remove(key) {
    const storageKey = `dsh2048.${key}`;
    memory.delete(storageKey);
    if (local) {
      try {
        local.removeItem(storageKey);
      } catch (_error) {
        // Ignore.
      }
    }
  }
  return { read, write, remove };
}

function createOfflineSDK() {
  const store = createOfflineStore();
  const params = readParams();
  if (params.get('fresh') === '1') {
    store.remove('current');
    store.remove('best');
  }
  if (params.get('failSave') === '1') {
    try {
      window.__2048ForceSaveFailure = true;
    } catch (_error) {
      // Preview-only diagnostic flag.
    }
  }
  if (params.get('failLoad') === '1') {
    try {
      window.__2048ForceLoadFailure = true;
    } catch (_error) {
      // Preview-only diagnostic flag.
    }
  }
  let revision = 0;
  let best = 0;
  const storedBest = store.read('best');
  if (Number.isFinite(storedBest) && storedBest > 0) best = Math.floor(storedBest);

  const themeParam = params.get('theme');
  const motionParam = params.get('motion');
  const theme = themeParam === 'light' || themeParam === 'dark'
    ? themeParam
    : mediaMatches('(prefers-color-scheme: light)')
      ? 'light'
      : 'dark';
  const reducedMotion = motionParam === 'reduced'
    ? true
    : motionParam === 'full'
      ? false
      : mediaMatches('(prefers-reduced-motion: reduce)');

  const info = {
    sdkVersion: '1.0.0',
    protocolVersion: 1,
    runtimeVersion: '1.0.0',
    gameId: '2048',
    gameVersion: '1.0.0',
    locale: 'zh-CN',
    theme,
    reducedMotion,
    capabilities: ['storage', 'score'],
    viewport: {
      width: window.innerWidth || 0,
      height: window.innerHeight || 0,
      dpr: window.devicePixelRatio || 1,
    },
    ready: true,
  };

  function stamp() {
    return new Date().toISOString();
  }

  return {
    runtime: info,
    ready: function ready() {
      return Promise.resolve(info);
    },
    storage: {
      save: function save(key, data) {
        if (window.__2048ForceSaveFailure === true) {
          return Promise.reject({ code: 'GM-4131', message: 'Local preview: simulated save failure', retryable: true });
        }
        const value = JSON.parse(JSON.stringify(data));
        store.write(key, value);
        revision += 1;
        return Promise.resolve({
          key,
          bytes: JSON.stringify(value).length,
          revision,
          updatedAt: stamp(),
        });
      },
      load: function load(key) {
        if (window.__2048ForceLoadFailure === true) {
          return Promise.reject({ code: 'GM-5022', message: 'Local preview: simulated load failure', retryable: true });
        }
        const value = store.read(key);
        if (value === undefined) return Promise.resolve(null);
        return Promise.resolve({ key, data: value, revision, updatedAt: null });
      },
      remove: function remove(key) {
        store.remove(key);
        revision += 1;
        return Promise.resolve({ key, removed: true, revision });
      },
    },
    session: {
      start: function start() {
        return Promise.resolve({ playSessionId: 'local-preview', startedAt: stamp(), adopted: false });
      },
      end: function end() {
        return Promise.resolve(null);
      },
    },
    score: {
      submit: function submit(score) {
        const value = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
        const isBest = value > best;
        if (isBest) {
          best = value;
          store.write('best', best);
        }
        return Promise.resolve({ best: best || value, isBest, submittedAt: stamp() });
      },
      getBest: function getBest() {
        if (!(best > 0)) return Promise.resolve(null);
        return Promise.resolve({ score: best, achievedAt: null, meta: null });
      },
    },
    lifecycle: {
      on: function on() {
        return function off() {};
      },
    },
    agent: {
      getStatus: function getStatus() {
        return Promise.resolve({ state: 'idle', label: '', labelKey: null, sessionId: null });
      },
      on: function on() {
        return function off() {};
      },
    },
    onError: function onError() {
      return function off() {};
    },
    isGameError: function isGameError() {
      return false;
    },
  };
}

const sdkGlobal = typeof DSH_GAME_SDK !== 'undefined' ? DSH_GAME_SDK : null;

function createPlatformSDK() {
  if (!(sdkGlobal && typeof sdkGlobal.createGameSDK === 'function')) return null;
  let embedded = false;
  try {
    embedded = window.parent !== window;
  } catch (_error) {
    embedded = false;
  }
  if (!embedded) return null;
  try {
    return sdkGlobal.createGameSDK();
  } catch (_error) {
    return null;
  }
}

const platformSDK = createPlatformSDK();
const offlineMode = platformSDK === null;
const game = offlineMode ? createOfflineSDK() : platformSDK;
const doc = document;
const win = window;

// The Runtime paints its back/pause/save controls over the top of the stage.
// Leave a small safe band in embedded mode so the masthead and ledger are not
// hidden under host chrome; the standalone preview keeps the tighter layout.
let embedded = !offlineMode;
if (offlineMode) {
  try {
    embedded = readParams().get('embed') === '1';
  } catch (_error) {
    embedded = false;
  }
}
doc.documentElement.dataset.embed = embedded ? 'true' : 'false';

const renderer = createRenderer({ document, window });

let state = null;
let mode = 'boot';
let booted = false;
let restoredSave = false;
let runtimePaused = false;
let pausedFromMode = null;
let resumeRequested = false;
let currentTheme = 'dark';
let reducedMotion = false;
let best = 0;
let bestAtGameStart = 0;
let sessionActive = false;
let overHandled = false;
let scoreSubmittedForGame = false;
let saveTimer = null;
let saveSeq = 0;
let lastSaveState = 'idle';
let lastSaveFailed = false;
let lastActiveAt = 0;
let windowBlurred = false;
let runtimeWatchTimer = null;

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function makeSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function errorCode(error) {
  return error && typeof error.code === 'string' && error.code ? error.code : 'GM-5000';
}

function errorMessage(error) {
  return error && typeof error.message === 'string' && error.message ? error.message : '请返回游戏市场后重新进入';
}

function clearSaveTimer() {
  if (saveTimer !== null) {
    win.clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function displayBest() {
  if (!state) return best;
  return Math.max(best, state.score);
}

function isRecord() {
  return Boolean(state && state.score > best && state.score > 0);
}

function syncElapsed(force) {
  const stamp = now();
  if (
    state &&
    mode === 'playing' &&
    !runtimePaused &&
    !windowBlurred &&
    (force === true || !doc.hidden) &&
    state.status === 'playing'
  ) {
    const delta = Math.max(0, Math.round(stamp - lastActiveAt));
    if (delta > 0) state = addElapsed(state, delta);
  }
  lastActiveAt = stamp;
}

function applyRuntime(info) {
  const runtime = info || game.runtime || {};
  currentTheme = runtime.theme === 'light' ? 'light' : 'dark';
  reducedMotion = runtime.reducedMotion === true;
  renderer.setTheme(currentTheme);
  renderer.setReducedMotion(reducedMotion);
}

function watchRuntime() {
  const runtime = game.runtime;
  if (!runtime) return;
  if ((runtime.theme === 'light' || runtime.theme === 'dark') && runtime.theme !== currentTheme) {
    currentTheme = runtime.theme;
    renderer.setTheme(currentTheme);
  }
  if (typeof runtime.reducedMotion === 'boolean' && runtime.reducedMotion !== reducedMotion) {
    reducedMotion = runtime.reducedMotion;
    renderer.setReducedMotion(reducedMotion);
  }
}

function refreshHud() {
  if (!state) return;
  renderer.setScores({
    score: state.score,
    best: displayBest(),
    moves: state.moves,
    record: isRecord(),
  });
  renderer.setUndo({
    remaining: undoAllowance(state),
    enabled: mode === 'playing' && !runtimePaused && canUndo(state),
  });
}

function updateStatus() {
  if (mode === 'ready') {
    renderer.setStatus(restoredSave ? '已恢复上一局 · 按方向键继续' : '按方向键 / 回车开始', restoredSave ? 'brass' : '');
  } else if (mode === 'playing') {
    renderer.setStatus(state && state.reached2048 ? '已达成 2048 · 继续冲分' : '方向键 / WASD 滑动', state && state.reached2048 ? 'brass' : '');
  } else if (mode === 'paused') {
    renderer.setStatus(runtimePaused ? '平台已暂停 · 请在平台菜单中继续' : '已暂停 · 按 P 继续');
  } else if (mode === 'won') {
    renderer.setStatus('达成 2048 · 选择继续', 'brass');
  } else if (mode === 'over') {
    renderer.setStatus('本局结束 · 按回车再来一局');
  } else if (mode === 'error') {
    renderer.setStatus('无法启动', 'alert');
  } else {
    renderer.setStatus('正在准备…');
  }
}

function startSession() {
  if (sessionActive) return;
  sessionActive = true;
  Promise.resolve()
    .then(function () {
      return game.session.start();
    })
    .catch(function () {
      sessionActive = false;
    });
}

function loadBest() {
  return Promise.resolve()
    .then(function () {
      return game.score.getBest();
    })
    .then(function (result) {
      if (result && Number.isFinite(result.score) && result.score >= 0) return Math.floor(result.score);
      return 0;
    })
    .catch(function () {
      return 0;
    });
}

function loadSavedState() {
  return Promise.resolve()
    .then(function () {
      return game.storage.load('current');
    })
    .then(function (saved) {
      return { saved, error: null };
    })
    .catch(function (error) {
      return { saved: null, error };
    });
}

function scheduleSave(delayMs) {
  if (!state || mode === 'boot' || mode === 'error') return;
  clearSaveTimer();
  const delay = typeof delayMs === 'number' ? delayMs : 450;
  saveTimer = win.setTimeout(function flushScheduledSave() {
    saveTimer = null;
    saveNow();
  }, delay);
}

function saveNow() {
  if (!state || mode === 'boot' || mode === 'error') return Promise.resolve(null);
  clearSaveTimer();
  syncElapsed();
  const payload = serialize(state);
  const seq = (saveSeq += 1);
  lastSaveState = 'saving';
  renderer.setSaveStatus('saving');
  return Promise.resolve()
    .then(function () {
      return game.storage.save('current', payload);
    })
    .then(function (result) {
      if (seq === saveSeq) {
        const recovered = lastSaveFailed;
        lastSaveState = 'saved';
        lastSaveFailed = false;
        renderer.setSaveStatus('saved');
        if (recovered) updateStatus();
      }
      return result;
    })
    .catch(function (error) {
      if (seq === saveSeq) {
        lastSaveState = 'failed';
        lastSaveFailed = true;
        const code = errorCode(error);
        renderer.setSaveStatus('failed', code);
        renderer.setStatus(`保存失败 ${code} · 点击「重试保存」`, 'alert');
        renderer.announce(`保存失败 ${code}`);
      }
      return null;
    });
}

function showReadyOverlay(notice) {
  if (restoredSave && state) {
    renderer.showOverlay({
      kicker: '已恢复上一局',
      title: '继续这一局',
      hint: '棋盘、分数和步数都已恢复。按方向键或回车继续。',
      detail: notice || `得分 ${formatNumber(state.score)} · 步数 ${state.moves} · 最高方块 ${highestTile(state.board) || '无'}`,
      detailTone: notice ? 'alert' : '',
      primaryLabel: '继续游戏',
      onPrimary: function onContinue() {
        startPlaying(true);
      },
      footnote: '平台确认后即可继续 · 进度已自动保存',
    });
    return;
  }
  renderer.showOverlay({
    kicker: '数字拼图',
    title: '把相同的数字推到一起',
    hint: '方向键 / WASD 滑动棋盘，相同数字合并。每局可以撤销一次，达成 2048 后还能继续冲分。',
    detail: notice || '',
    detailTone: notice ? 'alert' : '',
    primaryLabel: '开始游戏',
    onPrimary: function onStart() {
      startPlaying(false);
    },
    footnote: '进度会自动保存 · 离开后可继续',
  });
}

function showWinOverlay() {
  renderer.showOverlay({
    kicker: '达成 2048',
    title: '2048 达成',
    hint: '更强的数字还在后面。按回车继续冲分，看看能走多远。',
    detail: `得分 ${formatNumber(state.score)} · 步数 ${state.moves} · 最高方块 ${highestTile(state.board)}`,
    primaryLabel: '继续游戏',
    onPrimary: continueWin,
    footnote: '继续后仍可挑战 4096 · 分数在结束时提交',
  });
}

function showLocalPauseOverlay() {
  renderer.showOverlay({
    kicker: '已暂停',
    title: '喘口气',
    hint: '按 P 或回车继续。暂停的时间不会计入本局用时。',
    detail: `得分 ${formatNumber(state.score)} · 步数 ${state.moves}`,
    primaryLabel: '继续',
    onPrimary: resumeLocal,
    footnote: '进度已自动保存',
  });
}

function showPlatformPauseOverlay() {
  renderer.showOverlay({
    kicker: '已暂停',
    title: '平台暂停中',
    hint: '请在平台的暂停菜单中点击「继续」，游戏会从当前棋盘恢复。',
    detail: '',
    primaryLabel: '',
    onPrimary: null,
    footnote: false,
  });
}

function showGameOverOverlay(fromSave) {
  const record = !fromSave && state.score > bestAtGameStart && state.score > 0;
  renderer.showOverlay({
    kicker: '本局结束',
    title: `得分 ${formatNumber(state.score)}`,
    hint: `没有可以移动的方向了 · 最高方块 ${highestTile(state.board)}`,
    detail: fromSave
      ? '这局已经结束 · 分数已在上一局提交'
      : record
        ? '新纪录 · 分数已提交'
        : `个人最高 ${formatNumber(best)}`,
    primaryLabel: '再来一局',
    onPrimary: restart,
    footnote: fromSave ? '按回车开始新的一局' : '按回车重开 · 分数只会提交一次',
  });
}

function showFatal(error) {
  mode = 'error';
  const code = errorCode(error);
  renderer.setStatus('无法启动', 'alert');
  renderer.setUndo({ remaining: 0, enabled: false });
  renderer.setSaveStatus('idle');
  renderer.showOverlay({
    kicker: '无法开始',
    title: '游戏暂时不可用',
    hint: `${errorMessage(error)} · ${code}`,
    primaryLabel: '重新加载',
    onPrimary: function reloadPage() {
      try {
        win.location.reload();
      } catch (_reloadError) {
        // The host error overlay offers the final recovery path.
      }
    },
    footnote: '如果问题持续，请返回游戏市场后重试。',
  });
  renderer.announce(`游戏无法启动 ${code}`);
}

function startPlaying(fromResume) {
  if (mode !== 'ready' && mode !== 'paused') return;
  const wasRestored = restoredSave;
  restoredSave = false;
  if (state.status === 'ready') state = beginPlay(state);
  mode = 'playing';
  runtimePaused = false;
  pausedFromMode = null;
  renderer.hideOverlay();
  renderer.renderBoard(state.board, { instant: true });
  startSession();
  lastActiveAt = now();
  renderer.focusBoard();
  refreshHud();
  updateStatus();
  if (wasRestored) {
    renderer.announce(fromResume ? '已恢复上一局，继续游戏' : '已恢复上一局');
  }
}

function resumeLocal() {
  if (mode !== 'paused' || runtimePaused) return;
  mode = 'playing';
  renderer.hideOverlay();
  lastActiveAt = now();
  renderer.focusBoard();
  refreshHud();
  updateStatus();
}

function toggleLocalPause() {
  if (runtimePaused || mode !== 'playing') return;
  syncElapsed();
  mode = 'paused';
  saveNow();
  showLocalPauseOverlay();
  refreshHud();
  updateStatus();
}

function undoMove() {
  if (mode !== 'playing' || runtimePaused) return;
  if (!state || !canUndo(state)) {
    renderer.bumpBoard();
    return;
  }
  syncElapsed();
  const result = undo(state);
  if (!result.undone) return;
  state = result.state;
  renderer.renderBoard(state.board, { instant: true });
  renderer.bumpBoard();
  refreshHud();
  updateStatus();
  renderer.announce('已撤销上一步，本局撤销机会已用完');
  scheduleSave(0);
}

function buildMoveAnnouncement(result) {
  const parts = [];
  if (result.scoreGained > 0) parts.push(`合并 +${result.scoreGained}`);
  parts.push(`得分 ${state.score}`);
  parts.push(`最高方块 ${highestTile(state.board)}`);
  if (result.reachedTarget) parts.push('达成 2048');
  if (state.status === 'over') parts.push('没有可移动的方向');
  return parts.join('，');
}

function applyDirection(direction) {
  const resolved = normalizeDirection(direction);
  if (!resolved || !state) return;
  if (mode === 'ready') startPlaying(false);
  if (mode !== 'playing' || runtimePaused) return;
  syncElapsed();
  const result = move(state, resolved);
  if (!result.moved) {
    renderer.bumpBoard();
    renderer.announce('这个方向没有可以移动的方块');
    return;
  }
  state = result.state;
  renderer.renderBoard(state.board, {
    slides: result.slides,
    merges: result.merges,
    spawned: result.spawned,
    win: result.reachedTarget,
  });
  renderer.flashScoreDelta(result.scoreGained);
  refreshHud();
  updateStatus();
  renderer.announce(buildMoveAnnouncement(result));
  if (state.status === 'won') {
    onWin();
    return;
  }
  if (state.status === 'over') {
    onGameOver();
    return;
  }
  scheduleSave();
}

function submitFinalScore(finalScore) {
  Promise.resolve()
    .then(function () {
      return game.score.submit(finalScore);
    })
    .then(function (result) {
      if (result && Number.isFinite(result.best)) best = Math.max(best, Math.floor(result.best));
      else best = Math.max(best, finalScore);
      refreshHud();
      renderer.announce('分数已提交');
    })
    .catch(function (error) {
      const code = errorCode(error);
      if (mode === 'over') {
        renderer.setStatus(`分数提交失败 ${code} · 可重开一局`, 'alert');
      }
      renderer.announce(`分数提交失败 ${code}`);
    });
}

function endSession(finalScore) {
  if (!sessionActive) return;
  sessionActive = false;
  Promise.resolve()
    .then(function () {
      return game.session.end({ outcome: 'completed', score: finalScore });
    })
    .catch(function (error) {
      if (mode === 'over') renderer.setStatus(`结算请求失败 ${errorCode(error)}`, 'alert');
    });
}

function onWin() {
  mode = 'won';
  syncElapsed();
  saveNow();
  showWinOverlay();
  refreshHud();
  updateStatus();
  renderer.announce('达成 2048，可以继续游戏');
}

function continueWin() {
  if (mode !== 'won') return;
  state = continueAfterWin(state);
  renderer.hideOverlay();
  if (state.status === 'over') {
    onGameOver();
    return;
  }
  mode = 'playing';
  lastActiveAt = now();
  renderer.focusBoard();
  refreshHud();
  updateStatus();
  renderer.announce('继续游戏');
  scheduleSave();
}

function onGameOver() {
  if (mode === 'over' && overHandled) return;
  mode = 'over';
  overHandled = true;
  syncElapsed();
  renderer.renderBoard(state.board, { instant: true });
  showGameOverOverlay(false);
  refreshHud();
  updateStatus();
  saveNow();
  renderer.announce(`本局结束，得分 ${state.score}`);
  if (!scoreSubmittedForGame) {
    scoreSubmittedForGame = true;
    const finalScore = state.score;
    submitFinalScore(finalScore);
    endSession(finalScore);
  }
}

function restart() {
  state = beginPlay(createGame({ seed: makeSeed() }));
  mode = 'playing';
  restoredSave = false;
  runtimePaused = false;
  pausedFromMode = null;
  overHandled = false;
  scoreSubmittedForGame = false;
  bestAtGameStart = best;
  renderer.hideOverlay();
  renderer.renderBoard(state.board, { instant: true });
  startSession();
  lastActiveAt = now();
  renderer.focusBoard();
  refreshHud();
  updateStatus();
  renderer.announce('新的一局开始');
  saveNow();
}

function onRuntimePause() {
  if (!booted) {
    runtimePaused = true;
    return;
  }
  if (mode === 'over' || mode === 'error') {
    runtimePaused = true;
    return;
  }
  if (runtimePaused) return;
  runtimePaused = true;
  if (mode === 'playing') syncElapsed();
  pausedFromMode = mode;
  mode = 'paused';
  saveNow();
  renderer.hideOverlay();
  refreshHud();
  updateStatus();
}

function onRuntimeResume() {
  if (!booted) {
    runtimePaused = false;
    resumeRequested = true;
    return;
  }
  runtimePaused = false;
  if (mode === 'over' || mode === 'error') {
    lastActiveAt = now();
    return;
  }
  if (mode !== 'paused') {
    lastActiveAt = now();
    return;
  }
  const previous = pausedFromMode || 'playing';
  pausedFromMode = null;
  if (previous === 'paused') {
    mode = 'paused';
    showLocalPauseOverlay();
    refreshHud();
    updateStatus();
    return;
  }
  if (previous === 'ready') {
    mode = 'ready';
    if (restoredSave) {
      startPlaying(true);
      return;
    }
    showReadyOverlay();
    refreshHud();
    updateStatus();
    return;
  }
  if (previous === 'won') {
    mode = 'won';
    showWinOverlay();
    refreshHud();
    updateStatus();
    return;
  }
  mode = 'playing';
  if (state.status === 'ready') state = beginPlay(state);
  renderer.hideOverlay();
  lastActiveAt = now();
  renderer.focusBoard();
  refreshHud();
  updateStatus();
  saveNow();
}

function onHidden() {
  syncElapsed(true);
  saveNow();
}

function onVisible() {
  lastActiveAt = now();
}

function onBeforeSave() {
  syncElapsed();
  return saveNow();
}

function onVisibilityChange() {
  if (doc.hidden) onHidden();
  else onVisible();
}

function onWindowBlur() {
  syncElapsed();
  windowBlurred = true;
}

function onWindowFocus() {
  windowBlurred = false;
  lastActiveAt = now();
}

function onPageHide() {
  syncElapsed(true);
  saveNow();
}

function isSpaceKey(event, key) {
  return key === ' ' || key === 'Spacebar' || event.code === 'Space';
}

function handleKeydown(event) {
  if (!event || typeof event.key !== 'string') return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (mode === 'boot' || mode === 'error') return;
  const key = event.key;
  const lower = key.toLowerCase();
  const space = isSpaceKey(event, key);
  const enter = key === 'Enter';
  const direction = normalizeDirection(key);

  if (runtimePaused) {
    if (direction || lower === 'p' || enter || space) event.preventDefault();
    return;
  }

  if (mode === 'ready') {
    if (direction) {
      event.preventDefault();
      startPlaying(false);
      applyDirection(direction);
      return;
    }
    if (enter || space) {
      event.preventDefault();
      if (!event.repeat) startPlaying(false);
      return;
    }
    return;
  }

  if (mode === 'paused') {
    if (lower === 'p' || enter || space) {
      event.preventDefault();
      if (!event.repeat) resumeLocal();
      return;
    }
    if (direction) event.preventDefault();
    return;
  }

  if (mode === 'won') {
    if (enter || space) {
      event.preventDefault();
      if (!event.repeat) continueWin();
    }
    return;
  }

  if (mode === 'over') {
    if (enter || space) {
      event.preventDefault();
      if (!event.repeat) restart();
    }
    return;
  }

  if (mode !== 'playing') return;

  if (direction) {
    event.preventDefault();
    applyDirection(direction);
    return;
  }
  if (lower === 'p') {
    event.preventDefault();
    if (!event.repeat) toggleLocalPause();
    return;
  }
  if (lower === 'u') {
    event.preventDefault();
    if (!event.repeat) undoMove();
  }
}

function handleSwipe(direction) {
  if (runtimePaused) return;
  if (mode === 'ready') {
    startPlaying(false);
    applyDirection(direction);
    return;
  }
  if (mode === 'playing') applyDirection(direction);
}

function bindEvents() {
  win.addEventListener('keydown', handleKeydown);
  win.addEventListener('blur', onWindowBlur);
  win.addEventListener('focus', onWindowFocus);
  win.addEventListener('pagehide', onPageHide);
  doc.addEventListener('visibilitychange', onVisibilityChange);
  renderer.onUndo(undoMove);
  renderer.onSaveRetry(function retrySave() {
    saveNow();
  });
  renderer.onSwipe(handleSwipe);
  game.lifecycle.on('pause', onRuntimePause);
  game.lifecycle.on('resume', onRuntimeResume);
  game.lifecycle.on('hidden', onHidden);
  game.lifecycle.on('visible', onVisible);
  game.lifecycle.on('before-save', onBeforeSave);
}

async function boot() {
  renderer.init();
  bindEvents();
  renderer.showOverlay({
    kicker: '载入中',
    title: '正在准备棋盘',
    hint: '正在连接游戏运行时…',
    footnote: false,
  });

  try {
    const info = await game.ready();
    applyRuntime(info);
    if (info.launchMode === 'resume-paused') runtimePaused = true;
    best = await loadBest();
    bestAtGameStart = best;
    const loaded = await loadSavedState();
    const restored = loaded.saved ? deserialize(loaded.saved.data) : null;
    let bootNotice = null;
    if (loaded.error) bootNotice = `存档读取失败 ${errorCode(loaded.error)} · 已开始新局`;
    else if (loaded.saved && !restored) bootNotice = '存档不可用 · 已开始新局';
    booted = true;

    if (restored) {
      state = restored;
      restoredSave = true;
      renderer.renderBoard(state.board, { instant: true });
      if (restored.status === 'over') {
        mode = 'over';
        overHandled = true;
        scoreSubmittedForGame = true;
        renderer.hideOverlay();
        showGameOverOverlay(true);
        refreshHud();
        updateStatus();
      } else if (restored.status === 'won') {
        mode = 'won';
        showWinOverlay();
        refreshHud();
        updateStatus();
      } else {
        mode = 'ready';
        showReadyOverlay(bootNotice);
        refreshHud();
        updateStatus();
      }
    } else {
      state = createGame({ seed: makeSeed() });
      mode = 'ready';
      renderer.renderBoard(state.board, { instant: true });
      showReadyOverlay(bootNotice);
      refreshHud();
      updateStatus();
    }

    if (mode !== 'over') startSession();

    if (runtimePaused && mode !== 'over' && mode !== 'error') {
      pausedFromMode = mode;
      mode = 'paused';
      renderer.hideOverlay();
      refreshHud();
      updateStatus();
    } else if (resumeRequested && !runtimePaused && mode === 'ready' && restoredSave) {
      resumeRequested = false;
      startPlaying(true);
    } else if (resumeRequested && !runtimePaused && mode === 'won') {
      resumeRequested = false;
      showWinOverlay();
    }
    resumeRequested = false;

    renderer.setSaveStatus(restored ? 'saved' : 'idle');
    lastActiveAt = now();
    runtimeWatchTimer = win.setInterval(watchRuntime, 1800);
    renderer.announce('2048 已就绪');
    if (bootNotice) {
      renderer.setStatus(bootNotice, 'alert');
      renderer.announce(bootNotice);
    }
  } catch (error) {
    booted = true;
    showFatal(error);
  }
}

if (typeof window !== 'undefined') {
  window.__dsh2048Debug = function __dsh2048Debug() {
    return {
      mode,
      runtimePaused,
      restoredSave,
      sessionActive,
      offline: offlineMode,
      status: state ? state.status : null,
      score: state ? state.score : 0,
      moves: state ? state.moves : 0,
      best: displayBest(),
      board: state ? state.board.slice() : [],
      undoRemaining: state ? undoAllowance(state) : 0,
      undoReady: state ? canUndo(state) : false,
      elapsed: state ? state.elapsed : 0,
      theme: currentTheme,
      reducedMotion,
      overlay: renderer.isOverlayOpen(),
      saveState: lastSaveState,
      saveFailed: lastSaveFailed,
      saveTimer: saveTimer !== null,
      runtimeWatch: runtimeWatchTimer !== null,
    };
  };
  window.addEventListener('error', function onWindowError() {
    // The player sees failures through the save indicator and status line; do
    // not swallow them into a hidden console-only state.
    if (mode === 'playing') {
      renderer.setStatus('出现异常 · 进度会自动保存', 'alert');
    }
  });
}

boot();
