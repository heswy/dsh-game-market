/**
 * Orbit Courier audio: WebAudio one-shots from the package's own WAV files.
 *
 * Autoplay policy: the AudioContext is created and resumed only after a real
 * user gesture (`unlock()` from pointerdown/keydown). Nothing plays before that,
 * so a game sitting on the "press start" screen is silent by construction.
 * The mute switch is persisted through the adapter's storage.
 */

import { unwrapStorageValue } from './storage-shapes.js';

const AUDIO_FILES = Object.freeze({
  collect: 'audio/collect.wav',
  deliver: 'audio/deliver.wav',
  fast: 'audio/deliver-fast.wav',
  hit: 'audio/hit.wav',
  act: 'audio/act.wav',
  end: 'audio/end.wav',
});

const MUTE_KEY = 'muted';

export function createAudio(adapter, options = {}) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const supported = typeof AudioContextClass === 'function';
  const buffers = new Map();
  const pending = new Set();
  let context = null;
  let muted = Boolean(options.muted);
  let unlocked = false;
  let loadPromise = null;

  function ensureContext() {
    if (!supported) return null;
    if (context) return context;
    try {
      context = new AudioContextClass();
    } catch (error) {
      context = null;
    }
    return context;
  }

  async function loadOne(name, url) {
    const ctx = ensureContext();
    if (!ctx || typeof fetch !== 'function') return;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return;
      const bytes = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(bytes);
      buffers.set(name, buffer);
    } catch (error) {
      /* a missing sound must never break the game */
    }
  }

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all(Object.entries(AUDIO_FILES).map(([name, url]) => loadOne(name, url)));
    return loadPromise;
  }

  /** Resume the context on the first real gesture; returns true when live. */
  function unlock() {
    if (!supported) return false;
    const ctx = ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      const resumed = ctx.resume();
      if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
    }
    if (!unlocked) {
      unlocked = true;
      load();
    }
    return ctx.state !== 'suspended';
  }

  function play(name) {
    if (muted || !supported) return false;
    const ctx = ensureContext();
    const buffer = buffers.get(name);
    if (!ctx || !buffer || ctx.state === 'suspended') return false;
    try {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
      pending.add(source);
      source.onended = () => pending.delete(source);
      return true;
    } catch (error) {
      return false;
    }
  }

  function stopAll() {
    for (const source of pending) {
      try {
        source.stop();
      } catch (error) {
        /* already stopped */
      }
    }
    pending.clear();
  }

  function setMuted(next) {
    muted = Boolean(next);
    if (muted) stopAll();
    if (typeof options.onMutedChange === 'function') options.onMutedChange(muted);
    return muted;
  }

  function toggleMuted() {
    const next = setMuted(!muted);
    if (adapter && adapter.storage) {
      adapter.storage.save(MUTE_KEY, next).catch(() => {});
    }
    return next;
  }

  return {
    get muted() {
      return muted;
    },
    get unlocked() {
      return unlocked;
    },
    supported,
    load,
    unlock,
    play,
    setMuted,
    toggleMuted,
    stopAll,
    async restoreMuted() {
      try {
        // storage.load returns the host envelope; the flag is in `.data`.
        const value = unwrapStorageValue(await adapter.storage.load(MUTE_KEY));
        if (typeof value === 'boolean') muted = value;
      } catch (error) {
        /* default stays unmuted */
      }
      return muted;
    },
  };
}
