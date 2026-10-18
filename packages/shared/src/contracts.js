/**
 * Cross-module contracts for V0. This file is documentation-as-code: it has no
 * runtime exports beyond the frozen route table and a few guards.
 *
 * Readers:
 *   - packages/host      implements HTTP endpoints + persistence + agent adapter
 *   - packages/client    consumes Host API, renders shell/presence, mounts runtime
 *   - packages/runtime   implements the trusted iframe/bridge layer
 *   - packages/sdk       implements the iframe-side client
 *   - games/snake        uses only the SDK
 *
 * Rules:
 *   1. Relative imports only (plus `react` in Client source). No cycles.
 *   2. Client/Runtime/SDK/shared must not import Node built-ins.
 *   3. Host must not import @deepseek-ai/* or third-party packages.
 *   4. Every error crossing a boundary uses a GM-* code (shared/errors.js).
 */

import { API_BASE, LIMITS, TIMING } from './constants.js';

/**
 * @typedef {'idle'|'running'|'waiting-user'|'completed'|'error'} AgentPhase
 * @typedef {'turn'|'tool'|'approval'|'question'|'lifecycle'|'restore'} AgentSource
 *
 * @typedef {Object} AgentSnapshot
 * @property {AgentPhase} state
 * @property {string} label            Localized display string (zh in V0); games never parse it.
 * @property {string|null} labelKey    Stable key (see constants.AGENT_LABEL_KEYS); used by Client in V1.
 * @property {string|null} sessionId   Bound DSH Session id.
 * @property {string} updatedAt        ISO timestamp.
 * @property {AgentSource} source
 * @property {number} seq              Monotonic per Host epoch.
 * @property {string} since            ISO timestamp when `state` last changed.
 * @property {string|null} turnId      Stable turn id used for "ignore this turn".
 * @property {string} hostEpoch        Random id of the current Host process.
 *
 * @typedef {Object} SaveEnvelope
 * @property {number} schemaVersion
 * @property {string} gameId
 * @property {number} saveSchemaVersion
 * @property {string} savedAt
 * @property {'auto'|'pause'|'exit'|'agent-complete'|'manual'} reason
 * @property {number} bytes
 * @property {Record<string, unknown>} values
 *
 * @typedef {Object} GameRecord
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string} description
 * @property {string} author
 * @property {string[]} categories
 * @property {string[]} capabilities
 * @property {boolean} builtin
 * @property {boolean} installed
 * @property {boolean} canContinue
 * @property {number|null} bestScore
 * @property {string|null} lastPlayedAt
 * @property {{width:number,height:number,fit:'contain'}} viewport
 *
 * @typedef {Object} LaunchInfo
 * @property {string} instanceId       32 hex
 * @property {string} nonce            32 hex
 * @property {string} entryUrl         `/api/game-market/entry?...`
 * @property {{icon:string|null, cover:string|null}} preview
 * @property {string} runtimeVersion
 * @property {string} sdkVersion
 * @property {string[]} capabilities
 * @property {{saveBytes:number, saveKeys:number, scoreMetaBytes:number}} limits
 * @property {{width:number,height:number,fit:'contain'}} viewport
 * @property {string} hostEpoch
 * @property {'start'|'resume-paused'} mode
 *
 * @typedef {Object} Preferences
 * @property {number} schemaVersion
 * @property {string|null} lastPlayedGameId
 * @property {'discover'|'mine'} lastMarketTab
 * @property {{categories:string[], query:string}} marketFilter
 * @property {boolean} notifySoundEnabled
 * @property {string[]} dismissedHints
 * @property {string|null} lastUpdateCheckAt
 *
 * @typedef {Object} StartSessionRequest
 * @property {string} gameId
 * @property {string|null} dshSessionId
 * @property {string} operationId
 *
 * @typedef {Object} EndSessionRequest
 * @property {string} gameId
 * @property {string} playSessionId
 * @property {'completed'|'lost'|'abandoned'|'quit'} outcome
 * @property {number|null} score
 * @property {string} operationId
 */

/** Host HTTP routes (exact pathname; GET/HEAD/POST only). */
export const ROUTES = Object.freeze({
  HEALTH: `${API_BASE}/health`,
  GAMES: `${API_BASE}/games`,
  GAME: `${API_BASE}/game`,
  INSTALLED: `${API_BASE}/installed`,
  SAVE: `${API_BASE}/save`,
  SESSION: `${API_BASE}/session`,
  SCORES: `${API_BASE}/scores`,
  SCORE: `${API_BASE}/score`,
  PREFERENCES: `${API_BASE}/preferences`,
  AGENT_STATE: `${API_BASE}/agent-state`,
  AGENT_ACK: `${API_BASE}/agent-ack`,
  LAUNCH: `${API_BASE}/launch`,
  ENTRY: `${API_BASE}/entry`,
  PREVIEW: `${API_BASE}/preview`,
  /** Registered only when config.devMode === true. */
  DEV_AGENT_STATE: `${API_BASE}/dev/agent-state`,
});

/**
 * Host API response envelope:
 *   success: { ok: true, data: <payload>, requestId, serverTime }
 *   failure: { ok: false, error: { code, message, retryable, details? }, requestId, serverTime }
 *
 * Endpoint payloads (V0 subset):
 *
 * GET  /health
 *   data: { ok, version, hostEpoch, devMode, storage: {ok, root?, readOnly}, uptimeMs }
 *
 * GET  /games
 *   data: { items: GameRecord[], source: 'builtin', refreshedAt }
 * GET  /game?id=<gameId>
 *   data: GameRecord (+ activePlaySession: {playSessionId, startedAt}|null)
 * GET  /installed
 *   data: { items: GameRecord[] }
 *
 * GET  /save?gameId=<id>[&include=data]
 *   data: { gameId, keys, bytes, revision, updatedAt, values? }
 *   error: GM-4041 when no save exists
 * POST /save
 *   body: { gameId, key, data, expectedRevision?, operationId }
 *   data: { gameId, keys, bytes, revision, updatedAt }
 * POST /session
 *   body: { gameId, action:'start'|'end', dshSessionId?, playSessionId?, outcome?, score?, operationId }
 *   data: start => { playSessionId, startedAt, adopted }
 *         end   => { playSessionId, startedAt, endedAt, outcome, score, ignored }
 * GET  /scores?gameId=<id>
 *   data: { best: {value, achievedAt, playSessionId}|null, history: [...], direction }
 * POST /score
 *   body: { gameId, score, meta?, playSessionId?, operationId }
 *   data: { best, isBest, submittedAt }
 * GET  /preferences
 *   data: Preferences
 * POST /preferences
 *   body: partial Preferences fields
 *   data: Preferences
 * GET  /agent-state?sessionId=<dshSessionId>
 *   data: AgentSnapshot
 * POST /agent-ack
 *   body: { sessionId, seq }
 *   data: { state:'idle', seq }
 * POST /launch
 *   body: { gameId, version?, dshSessionId?, mode? }
 *   data: LaunchInfo
 * GET  /entry?gameId&version&instance&nonce
 *   returns HTML bytes with CSP/headers (not JSON)
 * GET  /preview?gameId&file[&v]
 *   returns image bytes or 404
 * POST /dev/agent-state   (devMode only)
 *   body: { sessionId, state, label?, labelKey?, turnId? }
 *   data: AgentSnapshot
 */

/** Host package exports (packages/host/src/plugin.js). */
export const HOST_PLUGIN_EXPORTS = Object.freeze({
  /** Cordis apply: registers routes and event listeners inside ctx.effect(). */
  apply: 'apply(ctx, config) -> void',
  /** Must include 'connection'. Add 'logger' only if read through ctx.get is safe. */
  inject: "['connection']",
  /** Defensive config schema: defaults + type checks; never throw on bad config. */
  Config: 'Cordis Schema (optional)',
});

/**
 * Runtime module contract (packages/runtime/src/index.js).
 *
 * `createGameRuntime(options)` returns a controller used by the Client. Runtime
 * owns the iframe, bridge and save scheduling; it never imports Client modules.
 *
 * @typedef {Object} RuntimeOptions
 * @property {HTMLElement} container          Where the iframe stage should mount.
 * @property {Object} api                     API client (shared/api-client.js).
 * @property {{theme:'light'|'dark', reducedMotion:boolean, locale:string}} environment
 * @property {(event: RuntimeEvent) => void} onEvent
 *
 * @typedef {{type:'state', state:string}
 *   | {type:'save-status', status:'idle'|'saving'|'saved'|'failed', at:number|null}
 *   | {type:'agent-state', snapshot:AgentSnapshot}
 *   | {type:'error', error:{code:string,message:string,retryable:boolean}}
 *   | {type:'exit', reason:string}} RuntimeEvent
 *
 * @typedef {Object} RuntimeController
 * @property {(info: LaunchInfo) => Promise<void>} launch
 * @property {() => Promise<{ok:boolean, saveStale:boolean}>} pause
 * @property {() => void} resume
 * @property {() => void} destroy
 * @property {() => {state:string, gameId:string|null}} getState
 * @property {(snapshot: AgentSnapshot|null) => void} handleAgentState
 * @property {(info: {theme:string, reducedMotion:boolean}) => void} updateEnvironment
 *
 * Runtime states: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'saving' | 'error' | 'exited'
 * Rules:
 *   - `launch` creates exactly one iframe, sandbox="allow-scripts", no allow-same-origin.
 *   - `resume-paused` mode: after `ready` + load, emit state 'paused' and wait for
 *     the user to confirm in the Client overlay before calling resume().
 *   - Autosave: every TIMING.autosaveMs while playing; pause/hidden/leave paths
 *     wait up to TIMING.saveTimeoutMs for the game to `before-save` + storage.save.
 *   - Leaving the panel destroys the iframe; returning always reloads + restores save.
 *   - Agent `completed` must not pause or destroy the game.
 */

/**
 * Client module contract (packages/client/src/main.js).
 *
 * Registers with the DSH Client plugin context:
 *   ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key:'dsh-game-market', ... }, GameMarketPanel))
 *   ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id:'dsh-game-market', order:40, label, locale }, GameMarketIcon))
 *   ctx.slots.inject('conversation.view', () => ctx.slots.register({ name:'conversation.view', id:'game', label, locale }, GameEntryView))
 *
 * Module store (outside React) shape:
 * @typedef {Object} ClientStore
 * @property {'market'|'my-games'|'runtime'} page
 * @property {string|null} bindingSessionId
 * @property {AgentSnapshot|null} agent
 * @property {{gameId:string, reason:'waiting-user'|'view-result'|'leave', at:number}|null} pausedGame
 * @property {{turnId:string|null, ignoredTurnId:string|null}} waitEntry
 * @property {{gameId:string|null, state:string, saveStatus:string, error:object|null}} runtime
 *
 * Client owns:
 *   - panel switching: ctx.layout.selectPanel('dsh-game-market') / selectPanel(null)
 *   - 1s agent snapshot polling (shared poller; stops when page hidden)
 *   - chip priority: waiting > resume > running > hidden
 *   - whale visuals + waiting-user leave protocol + completed reminder
 *   - pause overlay + resume-paused confirmation
 * Runtime owns everything inside the iframe and the bridge.
 */

/**
 * Snake game contract (games/snake).
 *
 * game.json: manifest fields from PRD §8.2 that V0 uses:
 *   { manifestVersion:1, id:'snake', name:'Snake', version:'0.1.0',
 *     author:{name:'DSH'}, description, entry:'dist/index.html',
 *     categories:['arcade'], capabilities:['storage','score'],
 *     sdkVersion:'^0.1.0', runtimeVersion:'^0.1.0',
 *     viewport:{width:960,height:540,fit:'contain'},
 *     score:{direction:'higher-better',min:0,max:1000000,integer:true},
 *     save:{schemaVersion:1} }
 *
 * Source layout:
 *   games/snake/src/index.html.tpl   placeholder __INLINE_SCRIPT__
 *   games/snake/src/game.js          plain script; uses global DSH_GAME_SDK
 *   packages/sdk/src/sdk.js          ESM entry exporting { createGameSDK }
 *
 * Build contract (scripts/build-snake.mjs):
 *   - bundles packages/sdk/src/sdk.js into an expression assigned to global DSH_GAME_SDK
 *   - bundles games/snake/src/game.js (ESM, may import ./logic.js) and appends it
 *   - inlines everything into dist/index.html; no external script/link/img/URLs
 *   - game code must read `DSH_GAME_SDK.createGameSDK()`.
 *
 * Game behavior:
 *   - canvas 2D, keyboard arrows/WASD, pause on Space/P, Enter restart after game over
 *   - calls game.session.start() on ready; game.session.end({outcome:'completed'}) on game over
 *   - calls game.score.submit(score) on game over; renders best score
 *   - saves state via lifecycle 'before-save' + periodic storage.save('current', state)
 *   - restores save on boot; if an unfinished session exists, resumes board
 *   - never uses network, never assumes a specific port, never touches parent DOM.
 */

/** Validate the shape every module boundary relies on. Throws on programmer error. */
export function assertLimitsConsistency() {
  if (LIMITS.saveValueBytes > LIMITS.saveTotalBytes) throw new Error('saveValueBytes > saveTotalBytes');
  if (TIMING.autosaveMs <= TIMING.saveTimeoutMs) throw new Error('autosave interval must exceed save timeout');
  return true;
}
