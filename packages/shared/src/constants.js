/**
 * Shared constants for dsh-game-market.
 *
 * Pure JS: no Node built-ins, no browser globals at import time.
 * Kept dependency-free so Host (Node ESM), Client (bundled browser), Runtime,
 * SDK (inlined into games) and tests can all import this file.
 */

export const BUNDLE_ID = 'dsh-game-market';
export const CLIENT_MODULE_ID = BUNDLE_ID;
export const MAIN_PANEL_KEY = BUNDLE_ID;
export const API_BASE = '/api/game-market';
export const LOG_PREFIX = '[game-market]';

/** Bumped together when the Runtime/SDK contract changes. */
export const RUNTIME_VERSION = '0.1.0';
export const SDK_VERSION = '0.1.0';
export const PROTOCOL_VERSION = 1;

export const LIMITS = Object.freeze({
  /** Total bytes of one game's save (envelope included). PRD D-005. */
  saveTotalBytes: 1024 * 1024,
  /** Max UTF-8 bytes for a single key value. */
  saveValueBytes: 256 * 1024,
  /** Max number of keys per game. */
  saveKeys: 32,
  /** Max JSON request body accepted by Host API. */
  jsonBodyBytes: 1024 * 1024,
  /** Max bytes for one score `meta` object. */
  scoreMetaBytes: 2048,
  /** Max score history entries per game. */
  scoreHistory: 200,
  /** Max session records per game. */
  sessionRecords: 100,
  /** Max entry HTML bytes served to the sandbox iframe. */
  entryBytes: 24 * 1024 * 1024,
  /** Max preview image bytes served to Market UI. */
  previewBytes: 2 * 1024 * 1024,
});

export const TIMING = Object.freeze({
  /** Waiting-entry appears after the Agent has run this long. PRD D-001. */
  waitEntryThresholdMs: 5000,
  /** Client polls the Host agent snapshot at this interval while visible. */
  agentPollMs: 1000,
  /** Autosave cadence while playing. PRD D-005. */
  autosaveMs: 30000,
  /** How long Runtime waits for a game to answer `before-save`. */
  saveTimeoutMs: 1500,
  /** Bridge handshake deadline. */
  handshakeTimeoutMs: 10000,
  /** Slow-load notice threshold. */
  loadSlowMs: 10000,
  /** Hard load failure threshold. */
  loadErrorMs: 20000,
  /** Runtime pings the iframe at this interval. */
  iframePingMs: 5000,
  /** Agent snapshot older than this is considered stale. */
  agentStaleMs: 5000,
  /** Runtime polling backoff cap. */
  pollBackoffMaxMs: 8000,
  /** UI animation durations (ms). */
  motion: Object.freeze({
    panel: 240,
    chipIn: 160,
    chipOut: 120,
    bubble: 220,
    whaleState: 240,
    overlay: 160,
  }),
});

export const AGENT_STATES = Object.freeze(['idle', 'running', 'waiting-user', 'completed', 'error']);
export const AGENT_SOURCES = Object.freeze(['turn', 'tool', 'approval', 'question', 'lifecycle', 'restore']);
export const AGENT_PRIORITY = Object.freeze({ 'waiting-user': 100, error: 80, completed: 60, running: 30, idle: 10 });

/**
 * V0 label templates (zh-first). V1 moves these to locale files + labelKey.
 * The Host resolves the final string; games must not parse it.
 */
export const AGENT_LABELS_ZH = Object.freeze({
  idle: 'Agent 空闲',
  running: '正在工作…',
  test: '正在运行测试…',
  build: '正在构建…',
  search: '正在查找资料…',
  read: '正在查看文件…',
  write: '正在修改文件…',
  command: '正在执行命令…',
  'waiting-approval': '需要你确认一项操作',
  'waiting-question': '需要你回答一个问题',
  'waiting-generic': 'Agent 在等你',
  completed: '任务完成啦',
  error: '遇到了一点问题',
});

/** Stable label keys (mirror PRD §9.8); Host only emits keys, Client localizes in V1. */
export const AGENT_LABEL_KEYS = Object.freeze({
  idle: 'agent.state.idle',
  running: 'agent.state.running',
  test: 'agent.state.test',
  build: 'agent.state.build',
  search: 'agent.state.search',
  read: 'agent.state.read',
  write: 'agent.state.write',
  command: 'agent.state.command',
  'waiting-approval': 'agent.state.waiting.approval',
  'waiting-question': 'agent.state.waiting.question',
  'waiting-generic': 'agent.state.waiting.generic',
  completed: 'agent.state.completed',
  error: 'agent.state.error',
});

export const GAME_ID_PATTERN = Object.freeze(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/);
export const PLAY_SESSION_ID_PATTERN = Object.freeze(/^ps_[a-z0-9]{16,32}$/);
export const INSTANCE_ID_PATTERN = Object.freeze(/^[a-f0-9]{32}$/);
export const NONCE_PATTERN = Object.freeze(/^[a-f0-9]{32}$/);
/** DSH Session ids are opaque; keep a conservative printable bound. */
export const DSH_SESSION_ID_PATTERN = Object.freeze(/^[A-Za-z0-9._:-]{1,128}$/);

export const LAUNCH_MODES = Object.freeze(['start', 'resume-paused']);
export const PAUSE_REASONS = Object.freeze(['user', 'hidden', 'leave', 'waiting-user']);
export const SAVE_REASONS = Object.freeze(['interval', 'pause', 'hidden', 'leave', 'agent-complete']);
export const SESSION_OUTCOMES = Object.freeze(['completed', 'lost', 'abandoned', 'quit']);

/** V0 built-in games. Paths are relative to the bundle root. */
export const BUILTIN_GAMES = Object.freeze([
  Object.freeze({
    id: 'snake',
    name: 'Snake',
    version: '0.1.0',
    dir: 'games/snake',
    manifestFile: 'game.json',
    entryFile: 'dist/index.html',
    viewport: Object.freeze({ width: 960, height: 540, fit: 'contain' }),
  }),
]);

export const AGENT_ACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
