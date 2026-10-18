import assert from 'node:assert/strict';
import test from 'node:test';

import { AGENT_LABEL_KEYS, AGENT_LABELS_ZH } from '../../../shared/src/constants.js';
import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { createHarness } from '../support/harness.js';

function assertErrorEnvelope(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

async function agentState(host, sessionId) {
  return host.data(ROUTES.AGENT_STATE, { query: { sessionId } });
}

export function register() {
  test('unknown DSH sessions return a cached idle snapshot', async (t) => {
    const host = await createHarness(t);
    const first = await agentState(host, 'ses-unknown-1');
    assert.equal(first.state, 'idle');
    assert.equal(first.label, AGENT_LABELS_ZH.idle);
    assert.equal(first.labelKey, AGENT_LABEL_KEYS.idle);
    assert.equal(first.sessionId, 'ses-unknown-1');
    assert.equal(first.seq, 0);
    assert.equal(first.source, 'lifecycle');
    assert.equal(first.turnId, null);
    assert.match(first.hostEpoch, /^he_[a-f0-9]{16}$/);
    assert.ok(!Number.isNaN(Date.parse(first.updatedAt)));
    const second = await agentState(host, 'ses-unknown-1');
    assert.deepEqual(second, first);

    const missing = await host.requestJson(ROUTES.AGENT_STATE);
    assert.equal(missing.response.status, 400);
    assertErrorEnvelope(missing.payload, GM.INVALID_PARAM);
    const etag = await host.request(ROUTES.AGENT_STATE, { query: { sessionId: 'ses-unknown-1' } });
    assert.match(etag.headers.get('etag'), /^W\/"he_[a-f0-9]{16}:0"$/);
  });

  test('dev override sets state/label/labelKey and validates input', async (t) => {
    const host = await createHarness(t, { config: { devMode: true } });
    const running = await host.data(ROUTES.DEV_AGENT_STATE, {
      body: { sessionId: 'ses-dev-1', state: 'running' },
    });
    assert.equal(running.state, 'running');
    assert.equal(running.label, AGENT_LABELS_ZH.running);
    assert.equal(running.labelKey, AGENT_LABEL_KEYS.running);
    assert.equal(running.seq, 1);

    const testLabel = await host.data(ROUTES.DEV_AGENT_STATE, {
      body: {
        sessionId: 'ses-dev-1',
        state: 'running',
        labelKey: AGENT_LABEL_KEYS.test,
        turnId: 'turn-dev',
      },
    });
    assert.equal(testLabel.state, 'running');
    assert.equal(testLabel.label, AGENT_LABELS_ZH.test);
    assert.equal(testLabel.labelKey, AGENT_LABEL_KEYS.test);
    assert.equal(testLabel.turnId, 'turn-dev');
    assert.equal(testLabel.seq, 2);

    const waiting = await host.data(ROUTES.DEV_AGENT_STATE, {
      body: {
        sessionId: 'ses-dev-1',
        state: 'waiting-user',
        labelKey: AGENT_LABEL_KEYS['waiting-approval'],
        label: '需要你确认一项操作',
      },
    });
    assert.equal(waiting.state, 'waiting-user');
    assert.equal(waiting.label, '需要你确认一项操作');
    assert.equal(waiting.seq, 3);

    for (const body of [
      { sessionId: 'ses-dev-1', state: 'dancing' },
      { sessionId: 'ses-dev-1', state: 'running', labelKey: 'agent.state.nope' },
      { sessionId: 'bad session', state: 'running' },
    ]) {
      const { response, payload } = await host.requestJson(ROUTES.DEV_AGENT_STATE, { body });
      assert.equal(response.status, 400);
      assertErrorEnvelope(payload, GM.INVALID_PARAM);
    }

    const regular = await createHarness(t);
    assert.equal(regular.routes.has(ROUTES.DEV_AGENT_STATE), false);
  });

  test('real event mapping: running → tool label → completed/error → ack', async (t) => {
    const host = await createHarness(t);
    const sessionId = 'ses-event-1';
    host.trigger('agent/pre-step', { sessionId, turnId: 'turn-1' });
    const running = await agentState(host, sessionId);
    assert.equal(running.state, 'running');
    assert.equal(running.labelKey, AGENT_LABEL_KEYS.running);
    assert.equal(running.source, 'turn');
    assert.equal(running.turnId, 'turn-1');
    assert.equal(running.seq, 1);
    const runningSince = running.since;

    host.trigger('tool/result', { sessionId, toolName: 'run_tests', turnId: 'turn-1' });
    const testing = await agentState(host, sessionId);
    assert.equal(testing.state, 'running');
    assert.equal(testing.labelKey, AGENT_LABEL_KEYS.test);
    assert.equal(testing.label, AGENT_LABELS_ZH.test);
    assert.equal(testing.source, 'tool');
    assert.equal(testing.seq, 2);
    assert.equal(testing.since, runningSince);

    host.trigger('tool/result', { sessionId, toolName: 'bash', turnId: 'turn-1' });
    const command = await agentState(host, sessionId);
    assert.equal(command.labelKey, AGENT_LABEL_KEYS.command);
    assert.equal(command.seq, 3);
    assert.equal(command.since, runningSince);

    host.trigger('assistant/message', { sessionId, turnId: 'turn-1' });
    const unchanged = await agentState(host, sessionId);
    assert.equal(unchanged.state, 'running');
    assert.equal(unchanged.seq, 3);

    host.trigger('turn/end', { sessionId, turnId: 'turn-1', outcome: 'completed' });
    const completed = await agentState(host, sessionId);
    assert.equal(completed.state, 'completed');
    assert.equal(completed.label, AGENT_LABELS_ZH.completed);
    assert.equal(completed.seq, 4);
    assert.equal(completed.since, completed.updatedAt);
    assert.ok(Date.parse(completed.since) >= Date.parse(runningSince));

    host.trigger('tool/result', { sessionId, toolName: 'bash' });
    host.trigger('assistant/message', { sessionId });
    const stillCompleted = await agentState(host, sessionId);
    assert.equal(stillCompleted.state, 'completed');
    assert.equal(stillCompleted.seq, 4);

    const acked = await host.data(ROUTES.AGENT_ACK, {
      body: { sessionId, seq: completed.seq },
    });
    assert.deepEqual(acked, { state: 'idle', seq: 5 });
    const idle = await agentState(host, sessionId);
    assert.equal(idle.state, 'idle');
    assert.equal(idle.turnId, null);
    const ackAgain = await host.data(ROUTES.AGENT_ACK, { body: { sessionId, seq: 5 } });
    assert.deepEqual(ackAgain, { state: 'idle', seq: 5 });

    host.trigger('agent/pre-step', { sessionId, turnId: 'turn-2' });
    const newTurn = await agentState(host, sessionId);
    assert.equal(newTurn.state, 'running');
    assert.equal(newTurn.turnId, 'turn-2');
    assert.equal(newTurn.seq, 6);

    host.trigger('turn/end', { sessionId, turnId: 'turn-2', error: { code: 'E_MODEL' } });
    const error = await agentState(host, sessionId);
    assert.equal(error.state, 'error');
    assert.equal(error.labelKey, AGENT_LABEL_KEYS.error);
    assert.equal(error.label, AGENT_LABELS_ZH.error);
    assert.equal(error.seq, 7);
  });

  test('waiting-user has highest priority and survives lower-priority events', async (t) => {
    const host = await createHarness(t);
    const sessionId = 'ses-wait-1';
    host.trigger('agent/pre-step', { sessionId });
    host.trigger('approval/asked', { sessionId, turnId: 'turn-w' });
    const waiting = await agentState(host, sessionId);
    assert.equal(waiting.state, 'waiting-user');
    assert.equal(waiting.labelKey, AGENT_LABEL_KEYS['waiting-approval']);
    assert.equal(waiting.source, 'approval');
    assert.equal(waiting.turnId, 'turn-w');
    assert.equal(waiting.seq, 2);

    host.trigger('tool/result', { sessionId, toolName: 'bash' });
    host.trigger('turn/end', { sessionId, outcome: 'completed' });
    host.trigger('assistant/message', { sessionId });
    const stillWaiting = await agentState(host, sessionId);
    assert.equal(stillWaiting.state, 'waiting-user');
    assert.equal(stillWaiting.seq, 2);
    assert.equal(stillWaiting.labelKey, AGENT_LABEL_KEYS['waiting-approval']);

    const ackWhileWaiting = await host.data(ROUTES.AGENT_ACK, {
      body: { sessionId, seq: 2 },
    });
    assert.deepEqual(ackWhileWaiting, { state: 'waiting-user', seq: 2 });

    host.trigger('approval/decided', { sessionId });
    const resumed = await agentState(host, sessionId);
    assert.equal(resumed.state, 'running');
    assert.equal(resumed.source, 'approval');
    assert.equal(resumed.turnId, 'turn-w');
    assert.equal(resumed.seq, 3);
  });

  test('turn/end error detection tolerates multiple payload field names', async (t) => {
    const host = await createHarness(t);
    const cases = [
      [{ status: 'cancelled' }, 'error'],
      [{ ok: false }, 'error'],
      [{ result: { error: { code: 'X' } } }, 'error'],
      [{ isError: true }, 'error'],
      [{ outcome: 'completed' }, 'completed'],
      [{}, 'completed'],
    ];
    let index = 0;
    for (const [payload, expectedState] of cases) {
      const sessionId = `ses-err-${index}`;
      index += 1;
      host.trigger('agent/pre-step', { sessionId });
      host.trigger('turn/end', { sessionId, ...payload });
      const snapshot = await agentState(host, sessionId);
      assert.equal(snapshot.state, expectedState);
    }
    host.trigger('turn/end', { prompt: 'no session id here' });
  });

  test('dedupe, label-only changes, stale ack and pre-step waterfall', async (t) => {
    const host = await createHarness(t);
    const sessionId = 'ses-dedupe-1';
    host.trigger('agent/pre-step', { sessionId, turnId: 'turn-a' });
    const first = await agentState(host, sessionId);
    host.trigger('agent/pre-step', { sessionId, turnId: 'turn-a' });
    const duplicate = await agentState(host, sessionId);
    assert.deepEqual(duplicate, first);

    let nextCalled = 0;
    const returns = host.trigger('agent/pre-step', { sessionId, turnId: 'turn-a' }, () => {
      nextCalled += 1;
      return 'next-result';
    });
    assert.equal(nextCalled, 1);
    assert.deepEqual(returns, ['next-result']);

    host.trigger('tool/result', { sessionId, toolName: 'read_file' });
    const read = await agentState(host, sessionId);
    assert.equal(read.state, 'running');
    assert.equal(read.labelKey, AGENT_LABEL_KEYS.read);
    assert.equal(read.seq, first.seq + 1);
    assert.equal(read.since, first.since);

    host.trigger('tool/result', { sessionId, toolName: 'web_search' });
    const search = await agentState(host, sessionId);
    assert.equal(search.labelKey, AGENT_LABEL_KEYS.search);
    assert.equal(search.seq, read.seq + 1);
    assert.equal(search.since, first.since);

    const stale = await host.data(ROUTES.AGENT_ACK, { body: { sessionId, seq: 0 } });
    assert.equal(stale.state, 'running');
    assert.equal(stale.seq, search.seq);
    const badSeq = await host.requestJson(ROUTES.AGENT_ACK, {
      body: { sessionId, seq: -1 },
    });
    assert.equal(badSeq.response.status, 400);
    assertErrorEnvelope(badSeq.payload, GM.INVALID_PARAM);
  });

  test('agent snapshots never include prompt/tool content and logs stay redacted', async (t) => {
    const host = await createHarness(t);
    const sessionId = 'ses-canary-1';
    const canary = 'CANARY_PROMPT_9f2c41a0';
    host.trigger('agent/pre-step', {
      sessionId,
      prompt: canary,
      messages: [{ role: 'user', content: canary }],
    });
    host.trigger('tool/result', {
      sessionId,
      toolName: 'bash',
      command: `echo ${canary}`,
      toolArguments: { command: canary },
      result: { stdout: canary },
    });
    const snapshot = await agentState(host, sessionId);
    assert.equal(snapshot.state, 'running');
    assert.equal(snapshot.labelKey, AGENT_LABEL_KEYS.command);
    const text = JSON.stringify(snapshot);
    assert.equal(text.includes(canary), false);
    assert.equal(text.includes('prompt'), false);
    assert.equal(text.includes('stdout'), false);
    const raw = await host.request(ROUTES.AGENT_STATE, { query: { sessionId } });
    const rawText = await raw.text();
    assert.equal(rawText.includes(canary), false);
    assert.equal(JSON.stringify(host.logs).includes(canary), false);
  });

  test('ETag / If-None-Match returns 304 and changes after a transition', async (t) => {
    const host = await createHarness(t, { config: { devMode: true } });
    await host.data(ROUTES.DEV_AGENT_STATE, {
      body: { sessionId: 'ses-etag-1', state: 'running' },
    });
    const first = await host.request(ROUTES.AGENT_STATE, { query: { sessionId: 'ses-etag-1' } });
    const etag = first.headers.get('etag');
    assert.match(etag, /^W\/"he_[a-f0-9]{16}:1"$/);
    const notModified = await host.request(ROUTES.AGENT_STATE, {
      query: { sessionId: 'ses-etag-1' },
      headers: { 'if-none-match': etag },
    });
    assert.equal(notModified.status, 304);
    assert.equal(await notModified.text(), '');
    await host.data(ROUTES.DEV_AGENT_STATE, {
      body: { sessionId: 'ses-etag-1', state: 'completed' },
    });
    const changed = await host.request(ROUTES.AGENT_STATE, {
      query: { sessionId: 'ses-etag-1' },
      headers: { 'if-none-match': etag },
    });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get('etag'), etag);
  });
}
