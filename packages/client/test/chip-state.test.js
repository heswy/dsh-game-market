import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/store.js';
import {
  CHIP_STATUS,
  SIDEBAR_STATUS,
  activePausedGame,
  deriveChipState,
  deriveSidebarStatus,
  deriveTurnKey,
  findResumableGame,
  pausedBelongsToSession,
  RESUME_WINDOW_MS,
  deriveTabStatus,
} from '../src/chip-state.js';

const NOW = 1_800_000_000_000;
const SESSION = 'session-A';

function agent(overrides) {
  return {
    state: 'running',
    label: 'Working...',
    labelKey: 'agent.state.running',
    sessionId: SESSION,
    updatedAt: new Date(NOW).toISOString(),
    source: 'turn',
    seq: 3,
    since: new Date(NOW - 6000).toISOString(),
    turnId: 'turn-1',
    hostEpoch: 'epoch-1',
    ...(overrides || {}),
  };
}

function state(overrides) {
  return createInitialState({
    bindingSessionId: SESSION,
    agent: agent(),
    agentFetchedAt: NOW,
    ...(overrides || {}),
  });
}

function paused(overrides) {
  return {
    gameId: 'snake',
    reason: 'waiting-user',
    at: NOW - 60_000,
    saveStale: false,
    sessionId: SESSION,
    ...(overrides || {}),
  };
}

test('chip is hidden without an agent snapshot', function () {
  const chip = deriveChipState(state({ agent: null, agentFetchedAt: 0 }), NOW);
  assert.equal(chip.status, CHIP_STATUS.HIDDEN);
});

test('waiting-user has the highest priority and no 5s threshold', function () {
  const chip = deriveChipState(
    state({
      agent: agent({ state: 'waiting-user', since: new Date(NOW - 10).toISOString() }),
      pausedGame: paused(),
    }),
    NOW
  );
  assert.equal(chip.status, CHIP_STATUS.WAITING);
  assert.equal(chip.waitingKind, 'generic');
});

test('waiting label kinds come from the Host labelKey', function () {
  const approval = deriveChipState(
    state({ agent: agent({ state: 'waiting-user', labelKey: 'agent.state.waiting.approval' }) }),
    NOW
  );
  const question = deriveChipState(
    state({ agent: agent({ state: 'waiting-user', labelKey: 'agent.state.waiting.question' }) }),
    NOW
  );
  assert.equal(approval.waitingKind, 'approval');
  assert.equal(question.waitingKind, 'question');
});

test('resume wins over running and expires after ten minutes', function () {
  const fresh = deriveChipState(state({ pausedGame: paused() }), NOW);
  assert.equal(fresh.status, CHIP_STATUS.RESUME);
  assert.equal(fresh.resumeGameId, 'snake');
  const expired = deriveChipState(state({ pausedGame: paused({ at: NOW - RESUME_WINDOW_MS - 1 }) }), NOW);
  assert.equal(expired.status, CHIP_STATUS.RUNNING);
});

test('a paused game from another session does not show its resume chip', function () {
  const chip = deriveChipState(
    state({ pausedGame: paused({ sessionId: 'session-B' }) }),
    NOW
  );
  assert.equal(chip.status, CHIP_STATUS.RUNNING);
  assert.equal(pausedBelongsToSession(paused({ sessionId: 'session-B' }), SESSION), false);
  assert.equal(pausedBelongsToSession(paused({ sessionId: null }), SESSION), true);
});

test('running needs five full seconds from the Host since timestamp', function () {
  const before = deriveChipState(
    state({ agent: agent({ since: new Date(NOW - 4999).toISOString() }) }),
    NOW
  );
  const atThreshold = deriveChipState(
    state({ agent: agent({ since: new Date(NOW - 5000).toISOString() }) }),
    NOW
  );
  assert.equal(before.status, CHIP_STATUS.HIDDEN);
  assert.equal(atThreshold.status, CHIP_STATUS.RUNNING);
});

test('ignoring a turn hides only that turn; a new turn reappears', function () {
  const ignored = deriveChipState(
    state({ waitEntry: { sessionId: SESSION, ignoredTurnId: 'turn-1' } }),
    NOW
  );
  const nextTurn = deriveChipState(
    state({ waitEntry: { sessionId: SESSION, ignoredTurnId: 'turn-1' }, agent: agent({ turnId: 'turn-2' }) }),
    NOW
  );
  assert.equal(ignored.status, CHIP_STATUS.HIDDEN);
  assert.equal(nextTurn.status, CHIP_STATUS.RUNNING);
});

test('waiting-user overrides a previous turn ignore', function () {
  const chip = deriveChipState(
    state({
      waitEntry: { sessionId: SESSION, ignoredTurnId: 'turn-1' },
      agent: agent({ state: 'waiting-user', turnId: 'turn-1' }),
    }),
    NOW
  );
  assert.equal(chip.status, CHIP_STATUS.WAITING);
});

test('stale snapshots hide running and waiting but keep a local paused game', function () {
  const stale = state({ agentFetchedAt: NOW - 6000 });
  assert.equal(deriveChipState(stale, NOW).status, CHIP_STATUS.HIDDEN);
  assert.equal(
    deriveChipState({ ...stale, agent: agent({ state: 'waiting-user' }) }, NOW).status,
    CHIP_STATUS.HIDDEN
  );
  assert.equal(deriveChipState({ ...stale, pausedGame: paused() }, NOW).status, CHIP_STATUS.RESUME);
});

test('the chip never renders while the Game Market panel is active', function () {
  const chip = deriveChipState(state({ pausedGame: paused() }), NOW, { activePanelId: 'dsh-game-market' });
  assert.equal(chip.status, CHIP_STATUS.HIDDEN);
  assert.equal(chip.reason, 'panel-active');
});

test('turn key falls back from turnId to since and reports resumable saves', function () {
  const noTurn = agent({ turnId: null });
  assert.equal(deriveTurnKey(noTurn), noTurn.since);
  const marketState = state({
    agent: agent({ turnId: null }),
    market: { status: 'ready', games: [{ id: 'snake', canContinue: true, installed: true }], refreshedAt: NOW },
  });
  const chip = deriveChipState(marketState, NOW);
  assert.equal(chip.status, CHIP_STATUS.RUNNING);
  assert.equal(chip.turnKey, noTurn.since);
  assert.equal(chip.canResume, true);
  assert.equal(chip.resumeSource, 'save');
});

test('findResumableGame prefers the paused game over a Host save', function () {
  const result = findResumableGame(
    state({
      pausedGame: paused({ gameId: 'snake' }),
      market: { status: 'ready', games: [{ id: 'other', canContinue: true, installed: true }], refreshedAt: NOW },
    }),
    NOW,
    SESSION
  );
  assert.deepEqual(result, { gameId: 'snake', source: 'paused', at: NOW - 60_000 });
  assert.equal(activePausedGame(paused({ at: NOW - RESUME_WINDOW_MS - 1 }), NOW), null);
});

test('sidebar status follows waiting > completed > running > resume', function () {
  assert.equal(
    deriveSidebarStatus(state({ agent: agent({ state: 'waiting-user' }) }), NOW),
    SIDEBAR_STATUS.WAITING
  );
  assert.equal(
    deriveSidebarStatus(state({ agent: agent({ state: 'completed' }) }), NOW),
    SIDEBAR_STATUS.COMPLETED
  );
  assert.equal(deriveSidebarStatus(state(), NOW), SIDEBAR_STATUS.RUNNING);
  assert.equal(
    deriveSidebarStatus(state({ agent: null, agentFetchedAt: 0, pausedGame: paused() }), NOW),
    SIDEBAR_STATUS.RESUME
  );
  assert.equal(deriveSidebarStatus(state({ agent: agent({ state: 'idle' }) }), NOW), SIDEBAR_STATUS.HIDDEN);
  assert.equal(
    deriveSidebarStatus(state(), NOW, { activePanelId: 'dsh-game-market' }),
    SIDEBAR_STATUS.HIDDEN
  );
  assert.equal(
    deriveSidebarStatus(state({ agent: agent({ state: 'waiting-user' }) }), NOW, { activePanelId: 'dsh-game-market' }),
    SIDEBAR_STATUS.WAITING
  );
});

test('sidebar completed clears after acknowledgement and DSH status supplements waiting', function () {
  const completed = state({ agent: agent({ state: 'completed', seq: 7 }) });
  assert.equal(deriveSidebarStatus(completed, NOW), SIDEBAR_STATUS.COMPLETED);
  assert.equal(
    deriveSidebarStatus({ ...completed, acknowledged: { sessionId: SESSION, seq: 7 } }, NOW),
    SIDEBAR_STATUS.HIDDEN
  );
  const pending = { running: false, pendingInteraction: { kind: 'approval' }, completionUnread: false };
  assert.equal(
    deriveSidebarStatus(state({ agent: null, agentFetchedAt: 0 }), NOW, { dshStatus: pending }),
    SIDEBAR_STATUS.WAITING
  );
});

test('deriveTabStatus surfaces waiting/error/completed/resume only', () => {
  const now = 1000 * 1000;
  function agent(overrides) {
    return { state: 'running', sessionId: 's1', since: new Date(now - 60_000).toISOString(), seq: 2, ...overrides };
  }
  const base = { bindingSessionId: 's1', agentFetchedAt: now, acknowledged: null, pausedGame: null };
  assert.equal(deriveTabStatus({ ...base, agent: agent({ state: 'waiting-user' }) }, now), 'waiting');
  assert.equal(deriveTabStatus({ ...base, agent: agent({ state: 'error' }) }, now), 'error');
  assert.equal(deriveTabStatus({ ...base, agent: agent({ state: 'completed' }) }, now), 'completed');
  assert.equal(
    deriveTabStatus({ ...base, agent: agent({ state: 'completed' }), acknowledged: { sessionId: 's1', seq: 2 } }, now),
    null
  );
  assert.equal(
    deriveTabStatus({ ...base, agent: null, pausedGame: { gameId: 'jump', sessionId: 's1', at: now - 1000 } }, now),
    'resume'
  );
  assert.equal(deriveTabStatus({ ...base, agent: null, pausedGame: { gameId: 'jump', sessionId: 's2', at: now - 1000 } }, now), null);
  assert.equal(deriveTabStatus({ ...base, agent: agent({ state: 'running' }) }, now), null);
  // stale snapshot must not badge
  assert.equal(deriveTabStatus({ ...base, agentFetchedAt: now - 60 * 60 * 1000, agent: agent({ state: 'waiting-user' }) }, now), null);
});
