import assert from 'node:assert/strict';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { createHarness } from '../support/harness.js';

const DEFAULTS = Object.freeze({
  schemaVersion: 1,
  lastPlayedGameId: null,
  lastMarketTab: 'discover',
  marketFilter: { categories: [], query: '' },
  notifySoundEnabled: true,
  dismissedHints: [],
  lastUpdateCheckAt: null,
});

function assertErrorEnvelope(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

export function register() {
  test('preferences start with the documented defaults (no file side effect)', async (t) => {
    const host = await createHarness(t);
    const preferences = await host.data(ROUTES.PREFERENCES);
    assert.deepEqual(preferences, DEFAULTS);
    assert.deepEqual(await host.listDataFiles('.'), []);
  });

  test('preferences merge writes and persist across reads', async (t) => {
    const host = await createHarness(t);
    const updated = await host.data(ROUTES.PREFERENCES, {
      body: {
        lastPlayedGameId: 'snake',
        lastMarketTab: 'mine',
        marketFilter: { categories: ['arcade', 'puzzle'], query: 'sn' },
        notifySoundEnabled: false,
        dismissedHints: ['waiting-chip-intro'],
        lastUpdateCheckAt: '2026-10-18T08:12:31.402Z',
      },
    });
    assert.equal(updated.lastPlayedGameId, 'snake');
    assert.equal(updated.lastMarketTab, 'mine');
    assert.deepEqual(updated.marketFilter, { categories: ['arcade', 'puzzle'], query: 'sn' });
    assert.equal(updated.notifySoundEnabled, false);
    assert.deepEqual(updated.dismissedHints, ['waiting-chip-intro']);
    assert.equal(updated.lastUpdateCheckAt, '2026-10-18T08:12:31.402Z');

    const partial = await host.data(ROUTES.PREFERENCES, {
      body: { lastMarketTab: 'discover', marketFilter: { query: 'snake' } },
    });
    assert.equal(partial.lastMarketTab, 'discover');
    assert.deepEqual(partial.marketFilter, { categories: ['arcade', 'puzzle'], query: 'snake' });
    assert.equal(partial.lastPlayedGameId, 'snake');

    const reread = await host.data(ROUTES.PREFERENCES);
    assert.deepEqual(reread, partial);
    const file = await host.readDataJson('preferences.json');
    assert.deepEqual(file, partial);
  });

  test('theme and session fields are never persisted', async (t) => {
    const host = await createHarness(t);
    await host.data(ROUTES.PREFERENCES, {
      body: {
        theme: 'dark',
        sessionId: 'session-secret',
        window: { width: 100 },
        lastPlayedGameId: 'snake',
      },
    });
    const file = await host.readDataJson('preferences.json');
    assert.deepEqual(Object.keys(file).sort(), [
      'dismissedHints',
      'lastMarketTab',
      'lastPlayedGameId',
      'lastUpdateCheckAt',
      'marketFilter',
      'notifySoundEnabled',
      'schemaVersion',
    ]);
    assert.equal(file.theme, undefined);
    assert.equal(file.sessionId, undefined);
    assert.equal(file.window, undefined);
    assert.equal(JSON.stringify(file).includes('session-secret'), false);
  });

  test('invalid preference fields are rejected', async (t) => {
    const host = await createHarness(t);
    const cases = [
      [{ lastMarketTab: 'search' }, GM.INVALID_PARAM],
      [{ lastPlayedGameId: 'Bad_ID' }, GM.BAD_GAME_ID],
      [{ notifySoundEnabled: 'yes' }, GM.INVALID_PARAM],
      [{ marketFilter: { categories: [1] } }, GM.INVALID_PARAM],
      [{ marketFilter: { query: 42 } }, GM.INVALID_PARAM],
      [{ dismissedHints: [null] }, GM.INVALID_PARAM],
      [{ lastUpdateCheckAt: 'yesterday' }, GM.INVALID_PARAM],
    ];
    for (const [body, code] of cases) {
      const { response, payload } = await host.requestJson(ROUTES.PREFERENCES, { body });
      assert.equal(response.status, 400);
      assertErrorEnvelope(payload, code);
    }
    assert.deepEqual(await host.data(ROUTES.PREFERENCES), DEFAULTS);
  });

  test('a malformed preferences file falls back to defaults', async (t) => {
    const host = await createHarness(t);
    await host.writeDataFile('preferences.json', '{not json');
    const preferences = await host.data(ROUTES.PREFERENCES);
    assert.deepEqual(preferences, DEFAULTS);
    const files = await host.listDataFiles('.');
    assert.equal(files.some((file) => file.includes('.corrupt-')), true);
  });
}
