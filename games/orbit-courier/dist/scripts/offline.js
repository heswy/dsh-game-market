/**
 * Offline adapter for Orbit Courier.
 *
 * The game normally runs inside the DSH Runtime iframe and talks to the host
 * through the bundled SDK (`scripts/vendor/dsh-sdk.js`). When the built package
 * is opened directly (a file:///http:// page outside DSH, used for local
 * development and screenshots) there is no parent handshake, so this adapter
 * provides the same small surface backed by localStorage and matchMedia.
 *
 * It never replaces host behaviour in production: the platform adapter is
 * chosen whenever the page is embedded.
 */

const PREFIX = 'orbit-courier.offline.';

function safeStorage() {
  try {
    const probe = '__orbit_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function media(query, fallback) {
  if (typeof window.matchMedia !== 'function') return fallback;
  try {
    return window.matchMedia(query).matches;
  } catch (error) {
    return fallback;
  }
}

export function createOfflineAdapter() {
  const store = safeStorage();
  const read = (key) => {
    if (!store) return null;
    try {
      const raw = store.getItem(PREFIX + key);
      return raw === null ? null : JSON.parse(raw);
    } catch (error) {
      return null;
    }
  };
  const write = (key, value) => {
    if (!store) return;
    try {
      if (value === null) store.removeItem(PREFIX + key);
      else store.setItem(PREFIX + key, JSON.stringify(value));
    } catch (error) {
      /* quota/private mode: the run is still playable */
    }
  };

  const runtime = {
    theme: media('(prefers-color-scheme: dark)', true) ? 'dark' : 'light',
    reducedMotion: media('(prefers-reduced-motion: reduce)', false),
    launchMode: 'start',
    viewport: null,
  };

  let saveRevision = 0;
  const revisionOf = (key) => {
    const meta = read(`revision.${key}`);
    return meta && Number.isInteger(meta.value) ? meta.value : 0;
  };

  return {
    mode: 'offline',
    runtime,
    async ready() {
      return runtime;
    },
    // Mirrors the host wire shapes (V1 contract §8.3): storage results are
    // envelopes `{key,data,revision,updatedAt}`, never bare payloads.
    storage: {
      async load(key) {
        const stored = read(key);
        if (stored === null) return null;
        if (stored && typeof stored === 'object' && stored.key === key && 'data' in stored) return stored;
        // Legacy bare payload (older preview builds): wrap it like the host.
        return { key, data: stored, revision: revisionOf(key) || 1, updatedAt: new Date().toISOString() };
      },
      async save(key, value) {
        const revision = revisionOf(key) + 1;
        const updatedAt = new Date().toISOString();
        write(`revision.${key}`, { value: revision });
        write(key, { key, data: value, revision, updatedAt });
        return { key, bytes: JSON.stringify(value).length, revision, updatedAt };
      },
      async remove(key) {
        write(`revision.${key}`, null);
        write(key, null);
        return { key, removed: true };
      },
    },
    score: {
      async submit(score) {
        const best = read('best');
        const previous = best && Number.isFinite(best.score) ? best.score : null;
        const isBest = previous === null || score > previous;
        if (isBest) write('best', { score, achievedAt: new Date().toISOString(), meta: null });
        return { best: isBest ? score : previous, isBest, submittedAt: new Date().toISOString() };
      },
      async getBest() {
        const best = read('best');
        return best && Number.isFinite(best.score) ? best : null;
      },
    },
    session: {
      async start() {
        return { playSessionId: 'offline', startedAt: new Date().toISOString() };
      },
      async end() {
        return { ok: true };
      },
    },
    lifecycle: {
      on(event, handler) {
        const name = String(event);
        const forward = (type) => handler({ event: type });
        if (name === 'hidden') document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') forward('hidden');
        });
        if (name === 'visible') document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') forward('visible');
        });
        return () => {};
      },
    },
    onFatal() {
      return () => {};
    },
  };
}
