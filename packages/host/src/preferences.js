/**
 * Platform UI preferences (PRD §8.6.4, contracts.js `Preferences`).
 *
 * Theme, window geometry, session content and game data are never stored here.
 * POST merges known fields; unknown fields are ignored.
 */

import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { createKeyedSerialiser } from './serial.js';
import {
  isIsoTimestamp,
  isPlainObject,
  validateGameId,
} from './validation.js';

export function defaultPreferences() {
  return {
    schemaVersion: 1,
    lastPlayedGameId: null,
    lastMarketTab: 'discover',
    marketFilter: { categories: [], query: '' },
    notifySoundEnabled: true,
    dismissedHints: [],
    lastUpdateCheckAt: null,
  };
}

function clonePreferences(value) {
  return {
    schemaVersion: 1,
    lastPlayedGameId: value.lastPlayedGameId,
    lastMarketTab: value.lastMarketTab,
    marketFilter: {
      categories: value.marketFilter.categories.slice(),
      query: value.marketFilter.query,
    },
    notifySoundEnabled: value.notifySoundEnabled,
    dismissedHints: value.dismissedHints.slice(),
    lastUpdateCheckAt: value.lastUpdateCheckAt,
  };
}

function normalizePreferences(raw) {
  const out = defaultPreferences();
  if (!isPlainObject(raw)) return out;
  if (raw.lastPlayedGameId === null) out.lastPlayedGameId = null;
  else if (typeof raw.lastPlayedGameId === 'string' && /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(raw.lastPlayedGameId)) {
    out.lastPlayedGameId = raw.lastPlayedGameId;
  }
  if (raw.lastMarketTab === 'discover' || raw.lastMarketTab === 'mine') {
    out.lastMarketTab = raw.lastMarketTab;
  }
  if (isPlainObject(raw.marketFilter)) {
    if (Array.isArray(raw.marketFilter.categories)) {
      out.marketFilter.categories = raw.marketFilter.categories.filter(
        (item) => typeof item === 'string' && item.length > 0 && item.length <= 32
      ).slice(0, 16);
    }
    if (typeof raw.marketFilter.query === 'string') {
      out.marketFilter.query = raw.marketFilter.query.slice(0, 128);
    }
  }
  if (typeof raw.notifySoundEnabled === 'boolean') out.notifySoundEnabled = raw.notifySoundEnabled;
  if (Array.isArray(raw.dismissedHints)) {
    out.dismissedHints = raw.dismissedHints
      .filter((item) => typeof item === 'string' && item.length > 0 && item.length <= 64)
      .slice(0, 64);
  }
  if (raw.lastUpdateCheckAt === null) out.lastUpdateCheckAt = null;
  else if (isIsoTimestamp(raw.lastUpdateCheckAt)) out.lastUpdateCheckAt = raw.lastUpdateCheckAt;
  return out;
}

function invalid(field) {
  return hostError(GM.INVALID_PARAM, `Invalid ${field}`);
}

export function createPreferencesService({ storage, logger = null }) {
  const serialisePreferences = createKeyedSerialiser();

  function filePath() {
    return storage.filePath('preferences.json');
  }

  async function read() {
    const result = await storage.readJson(filePath(), { schemaVersion: 1 });
    if (!result) return defaultPreferences();
    if (result.recovered) logger?.warn?.('[game-market/host] preferences-recovered');
    return normalizePreferences(result.value);
  }

  async function get() {
    return clonePreferences(await read());
  }

  async function update(patch) {
    if (!isPlainObject(patch)) throw hostError(GM.INVALID_PARAM, 'Request body must be an object');
    return serialisePreferences('preferences', () => updateLocked(patch));
  }

  async function updateLocked(patch) {
    const current = await read();

    if (Object.prototype.hasOwnProperty.call(patch, 'lastPlayedGameId')) {
      if (patch.lastPlayedGameId === null) current.lastPlayedGameId = null;
      else current.lastPlayedGameId = validateGameId(patch.lastPlayedGameId, 'lastPlayedGameId');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'lastMarketTab')) {
      if (patch.lastMarketTab !== 'discover' && patch.lastMarketTab !== 'mine') {
        throw invalid('lastMarketTab');
      }
      current.lastMarketTab = patch.lastMarketTab;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'marketFilter')) {
      if (!isPlainObject(patch.marketFilter)) throw invalid('marketFilter');
      if (Object.prototype.hasOwnProperty.call(patch.marketFilter, 'categories')) {
        const categories = patch.marketFilter.categories;
        if (!Array.isArray(categories) || categories.length > 16) throw invalid('marketFilter.categories');
        for (const item of categories) {
          if (typeof item !== 'string' || item.length === 0 || item.length > 32) {
            throw invalid('marketFilter.categories');
          }
        }
        current.marketFilter.categories = [...new Set(categories)];
      }
      if (Object.prototype.hasOwnProperty.call(patch.marketFilter, 'query')) {
        if (typeof patch.marketFilter.query !== 'string' || patch.marketFilter.query.length > 128) {
          throw invalid('marketFilter.query');
        }
        current.marketFilter.query = patch.marketFilter.query;
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'notifySoundEnabled')) {
      if (typeof patch.notifySoundEnabled !== 'boolean') throw invalid('notifySoundEnabled');
      current.notifySoundEnabled = patch.notifySoundEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'dismissedHints')) {
      const hints = patch.dismissedHints;
      if (!Array.isArray(hints) || hints.length > 64) throw invalid('dismissedHints');
      for (const item of hints) {
        if (typeof item !== 'string' || item.length === 0 || item.length > 64) throw invalid('dismissedHints');
      }
      current.dismissedHints = [...new Set(hints)];
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'lastUpdateCheckAt')) {
      if (patch.lastUpdateCheckAt !== null && !isIsoTimestamp(patch.lastUpdateCheckAt)) {
        throw invalid('lastUpdateCheckAt');
      }
      current.lastUpdateCheckAt = patch.lastUpdateCheckAt;
    }

    // `theme`, window geometry, session ids and game data in the patch are
    // intentionally ignored: preferences.json must never store them.
    current.schemaVersion = 1;
    await storage.writeJson(filePath(), current);
    return clonePreferences(current);
  }

  return { get, update, read, filePath, defaultPreferences };
}
