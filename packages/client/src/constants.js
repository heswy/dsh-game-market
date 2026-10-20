/** Stable client-side identifiers shared by registration and components. */

export const MAIN_PANEL_KEY = 'dsh-game-market';
export const SIDEBAR_ORDER = 40;

export const PAGES = Object.freeze({
  MARKET: 'market',
  MY_GAMES: 'my-games',
  DETAIL: 'detail',
  RUNTIME: 'runtime',
});

export const RUNTIME_STATES = Object.freeze([
  'idle',
  'launching',
  'loading',
  'ready',
  'playing',
  'paused',
  'saving',
  'error',
  'exited',
]);

export const PAUSED_REASONS = Object.freeze(['waiting-user', 'view-result', 'leave']);

/**
 * Manifest `categories` enum (shared/manifest.js CATEGORIES). Duplicated as a
 * frozen client list so the browser bundle does not pull the manifest validator.
 */
export const CATEGORIES = Object.freeze([
  'arcade',
  'puzzle',
  'card',
  'idle',
  'action',
  'strategy',
  'trivia',
  'sandbox',
]);

export const CATEGORY_ALL = 'all';

/** One category chip row: "All" plus the eight manifest categories. */
export const CATEGORY_FILTERS = Object.freeze([CATEGORY_ALL].concat(CATEGORIES));

/** Search debounce from PRD 9.3.5 (local catalog filtering). */
export const SEARCH_DEBOUNCE_MS = 150;

/** Skeleton appears only after this delay to avoid a white flash (PRD 9.3.6). */
export const SKELETON_DELAY_MS = 300;

/** Slow-load notice threshold (PRD 9.3.6). */
export const SLOW_LOAD_MS = 800;

/** Section size caps from PRD 9.3.3. */
export const SECTION_LIMIT = 8;

/** "New" means published within this window (PRD 9.3.3). */
export const NEW_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** Detail preview images (PRD 9.5.1). */
export const MAX_SCREENSHOTS = 3;

/** Visible install/uninstall job states (PRD 9.5.3 + install state machine). */
export const INSTALL_JOB_STAGES = Object.freeze([
  'queued',
  'downloading',
  'verifying',
  'installing',
  'installed',
  'failed',
  'cancelled',
]);

/** Stages where the operation is still running. */
export const INSTALL_ACTIVE_STAGES = Object.freeze(['queued', 'downloading', 'verifying', 'installing']);

/** Stages where the install may still be aborted (PRD 9.5.3). */
export const INSTALL_CANCELLABLE_STAGES = Object.freeze(['queued', 'downloading', 'verifying', 'installing']);

/** Stages whose cancel label becomes "Cancel and clean up" (PRD 9.5.3). */
export const INSTALL_CLEANUP_STAGES = Object.freeze(['verifying', 'installing']);

/** Stage hint delay before switching the label to "Downloading..." without a byte stream. */
export const INSTALL_STAGE_HINT_MS = 320;

/** Busy retry backoff for the serialized install queue (GM-4091 / GM-4097). */
export const INSTALL_BUSY_RETRY_DELAYS_MS = Object.freeze([600, 1400]);

/** Toast lifetimes (PRD 9.4.4 / 9.5.5). */
export const TOAST_MS = 3000;
export const TOAST_UPDATE_MS = 1600;

/** Maximum simultaneously rendered toasts. */
export const TOAST_LIMIT = 3;

/** Offset used by scroll restoration and focus rings under the sticky header. */
export const HEADER_HEIGHT = 52;

/** Minimum viewport width where the header search stays expanded (PRD 9.3.5). */
export const SEARCH_EXPANDED_MIN_WIDTH = 840;

/**
 * V1.5 M3 platform-update routes (docs/verification/v1.5/m3-decisions.md §2).
 * Client-owned copies so this bundle never depends on Host-only modules.
 */
export const UPDATE_ROUTES = Object.freeze({
  inspect: 'platform-update',
  refresh: 'platform-update/refresh',
  begin: 'platform-update/begin',
  observe: 'platform-update/observe',
  cancel: 'platform-update/cancel',
  coordinate: 'platform-update/coordinate',
  clientReport: 'platform-update/client-report',
});

/**
 * Contract §9.1 observation states. The UI may only render these, and
 * `applied` is an intermediate state that must never read as success.
 */
export const UPDATE_STATES = Object.freeze([
  'inspecting',
  'installing',
  'applied',
  'activating',
  'updated',
  'pending-restart',
  'already-at-target',
  'verification-failed',
  'stale-runtime',
  'too-late',
  'cancelled',
  'failed',
]);

/** States where the Host operation is still running (poll `observe`). */
export const UPDATE_ACTIVE_STATES = Object.freeze(['inspecting', 'installing', 'applied', 'activating']);

/** Terminal states retained by the Host until the next `begin`. */
export const UPDATE_TERMINAL_STATES = Object.freeze([
  'updated',
  'pending-restart',
  'already-at-target',
  'verification-failed',
  'stale-runtime',
  'too-late',
  'cancelled',
  'failed',
]);

/** The only success terminal state (Host + Client identity both verified). */
export const UPDATE_SUCCESS_STATE = 'updated';

/** Ordered progress stages; only these four labels may be shown. */
export const UPDATE_PROGRESS_STATES = Object.freeze(['inspecting', 'installing', 'applied', 'activating']);

/** `/platform-update/cancel` results (contract §2). */
export const UPDATE_CANCEL_RESULTS = Object.freeze(['cancelled', 'too-late', 'not-running']);

/** Acceptance states surfaced while a discovery check is in flight/idle. */
export const UPDATE_DISCOVERY_STATES = Object.freeze([
  'never',
  'checking',
  'ready',
  'stale',
  'offline',
  'invalid',
  'unknown',
]);

/** Installed spec shapes that mean "development source" (never auto-migrated). */
export const UPDATE_DEV_SPEC_SHAPES = Object.freeze(['path', 'file']);

/** How long a manual discovery refresh stays throttled by the Host (default). */
export const UPDATE_REFRESH_THROTTLE_MS = 60000;

/** Observation / inspection polling cadence (Client side). */
export const UPDATE_TIMING = Object.freeze({
  /** Re-read `/platform-update` while visible and no operation is active. */
  inspectVisibleMs: 3000,
  /** Same, when the page is hidden (idle windows still need to report). */
  inspectHiddenMs: 10000,
  /** Poll `/platform-update/observe` while an operation is active. */
  observeMs: 1000,
  /** Backoff cap after observe/inspect failures (resume after RPC loss). */
  backoffMaxMs: 8000,
  /** Re-report the embedded client identity while an update is running. */
  clientReportMs: 15000,
  /** How long to keep retrying `/coordinate` before surfacing a failure. */
  coordinateAttempts: 3,
  /** Retry delay for a failed coordinate report. */
  coordinateRetryMs: 800,
});

/** Update-specific error codes that the UI maps to actionable copy. */
export const UPDATE_ERROR_CODES = Object.freeze(['GM-4090', 'GM-5038', 'GM-5040', 'GM-4091']);
