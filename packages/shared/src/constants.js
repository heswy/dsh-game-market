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
export const RUNTIME_VERSION = '1.0.0';
export const SDK_VERSION = '1.0.0';
export const PROTOCOL_VERSION = 1;

/**
 * V0 games stay runnable on V1 (V1-07). Their manifests declare 0.1.x ranges;
 * 0.1.x majors are accepted as the legacy compatibility window.
 */
export const LEGACY_V0_VERSION = '0.1.0';

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
  entryBytes: 20 * 1024 * 1024,
  /** Max bytes of one single-file game package (PRD §8.2.2). */
  packageBytes: 20 * 1024 * 1024,
  /** Max bytes of the inline manifest script (PRD §8.2.2). */
  manifestBytes: 64 * 1024,
  /** Max bytes of the static Registry index. */
  registryBytes: 2 * 1024 * 1024,
  /** Max games accepted from one Registry index. */
  registryGames: 500,
  /** Max decoded bytes of a manifest `icon` data URI. */
  iconBytes: 256 * 1024,
  /** Max preview image bytes served to Market UI. */
  previewBytes: 2 * 1024 * 1024,
  /**
   * V1.5 `asset-zip-v2` archive limits (docs/V1.5-CONTRACTS.md §3).
   *
   * A separate namespace on purpose: the V1 single-file limits above keep
   * their exact semantics, and the two can be tuned independently later.
   * Rule 0 of §3: the descriptor is ONE central-directory entry, so the total
   * entry budget is 512 and `files[]` (which excludes the descriptor) is 511.
   */
  zip: Object.freeze({
    /** Outer ZIP bytes; also the standard per-package size ceiling. */
    zipOuterBytes: 20 * 1024 * 1024,
    /** Sum of every extracted entry, measured, never trusting the central directory. */
    zipUnpackedBytes: 100 * 1024 * 1024,
    /** Total central-directory entries INCLUDING `dsh-package.json`. */
    zipEntries: 512,
    /** One extracted entry. */
    zipEntryBytes: 20 * 1024 * 1024,
    /** One compressed entry. */
    zipEntryCompressedBytes: 20 * 1024 * 1024,
    /** Whole-archive compression ratio ceiling (`unpacked / outer`). */
    zipTotalRatio: 100,
    /** Per-entry compression ratio ceiling. */
    zipEntryRatio: 100,
    /** Max path length in Unicode code points. */
    zipPathChars: 240,
    /** Max path depth in `/`-separated segments (file name counts as one). */
    zipPathDepth: 12,
    /** `dsh-package.json` bytes. */
    descriptorBytes: 256 * 1024,
    /** Streaming read chunk; no entry is ever buffered whole. */
    zipChunkBytes: 64 * 1024,
  }),
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
  /** Registry index cache TTL (PRD §8.8.3). */
  registryTtlMs: 6 * 60 * 60 * 1000,
  /** Stale Registry cache hard limit (PRD §8.8.3). */
  registryStaleMs: 14 * 24 * 60 * 60 * 1000,
  /** Minimum interval between user-triggered Registry refreshes. */
  registryRefreshThrottleMs: 5 * 60 * 1000,
  /** Install download: connect / total / idle-no-data budgets (PRD §8.7.2). */
  downloadConnectMs: 10000,
  downloadTotalMs: 120000,
  downloadIdleMs: 20000,
  /** Install verification + atomic move budget. */
  installVerifyMs: 15000,
  installMoveMs: 30000,
  /** How long the install lock queues before returning INSTALL_IN_PROGRESS. */
  installLockWaitMs: 10000,
  /** How long a /entry launcher binding stays valid (TBD-10). */
  entryBindingTtlMs: 10 * 60 * 1000,
  runtimeRenewMs: 60 * 1000,
  /**
   * V1.5: instance-bound resource credential lifetime. A sliding window, exactly
   * the entry-binding TTL, renewed by `POST /runtime-renew` (contract §7.2).
   */
  resourceCredentialTtlMs: 10 * 60 * 1000,
  /** V1.5: whole-archive extraction wall-clock budget (contract §3). */
  zipExtractMs: 60000,
  /** V1.5: HMR capability probe cadence and deadline (contract §9.2). */
  hmrProbeIntervalMs: 250,
  hmrProbeTimeoutMs: 15000,
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

/** V0/V1 built-in games. Paths are relative to the bundle root. */
export const BUILTIN_GAMES = Object.freeze([
  Object.freeze({
    id: 'snake',
    name: 'Snake',
    version: '1.0.0',
    dir: 'games/snake',
    manifestFile: 'game.json',
    entryFile: 'dist/index.html',
    viewport: Object.freeze({ width: 960, height: 540, fit: 'contain' }),
  }),
]);

export const AGENT_ACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Official community Registry index (V1.2 community publishing MVP).
 *
 * This is the single default URL used by the Host when no explicit Registry is
 * configured. It is intentionally a constant (not scattered through call
 * sites); until the content repository is created and publicly verified, the
 * Host MUST fall back to the bundled `registry/games.json` seed on failure.
 */
export const DEFAULT_OFFICIAL_REGISTRY_URL = 'https://raw.githubusercontent.com/heswy/dsh-game-registry/main/registry/games.json';

/**
 * V1.5 package formats (docs/V1.5-CONTRACTS.md §1).
 *
 * `html-v1` keeps every V1 rule; `asset-zip-v2` adds an outer ZIP with a
 * `dsh-package.json` descriptor and a per-file manifest. A missing `format`
 * always means `html-v1` (V1 indexes and old install records).
 */
export const PACKAGE_FORMATS = Object.freeze(['html-v1', 'asset-zip-v2']);
export const DEFAULT_PACKAGE_FORMAT = 'html-v1';
export const ASSET_ZIP_V2 = 'asset-zip-v2';

/** `<id>-<version>.dshgame.zip` — the double extension is deliberate (§1.2). */
export const PACKAGE_ZIP_EXTENSION = '.dshgame.zip';

/** Root descriptor of an `asset-zip-v2` archive; never listed in its own `files[]`. */
export const DESCRIPTOR_FILE = 'dsh-package.json';
/** The one authoritative game manifest inside a ZIP package. */
export const ZIP_GAME_MANIFEST_FILE = 'game.json';

/** Registry v2 lives next to v1 in the same content repository (§5.2). */
export const REGISTRY_V2_FILE = 'v2/games.json';
export const REGISTRY_V2_VERSION = 2;
/** V2 cache file + schema, deliberately different from the v1 pair (§5.3). */
export const REGISTRY_CACHE_V2_FILE = 'registry-cache-v2.json';
export const REGISTRY_CACHE_V2_SCHEMA_VERSION = 2;

/** Instance resource origin path prefix: `/res/<instanceId>/<resourceToken>/<path>` (§7.1). */
export const RESOURCE_ORIGIN_PATH = '/res';

/**
 * Platform-served wrapper document on the resource origin (§7.5.1).
 *
 * The wrapper is static platform HTML with `frame-src`/`child-src` limited to
 * the resource origin, so a game document cannot navigate itself out of the
 * package. It embeds the game in a child iframe addressed by `?src=<url>` and
 * relays bridge messages point-to-point (see runtime/bridge docs).
 */
export const RESOURCE_WRAPPER_PATH = '/wrapper';
export const RESOURCE_WRAPPER_QUERY = 'src';

/** Default v2 registry: same content repository, `v2/` sub-directory (§5.2). */
export const DEFAULT_OFFICIAL_REGISTRY_V2_URL = DEFAULT_OFFICIAL_REGISTRY_URL.replace(
  /\/games\.json$/,
  `/${REGISTRY_V2_FILE}`,
);
