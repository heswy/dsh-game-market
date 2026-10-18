/**
 * Test doubles for the Runtime controller tests: a deterministic clock, a tiny
 * DOM (container / iframe / document / window) and an in-memory Host API.
 */

export function createClock(startAt = 0) {
  let current = startAt;
  let nextId = 1;
  const scheduled = new Map();

  function setTimeout(fn, ms) {
    const id = nextId;
    nextId += 1;
    const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
    scheduled.set(id, { fn, at: current + delay, id });
    return id;
  }

  function clearTimeout(id) {
    scheduled.delete(id);
  }

  function tick(ms) {
    const target = current + (Number.isFinite(ms) && ms > 0 ? ms : 0);
    let guard = 0;
    while (guard < 200000) {
      guard += 1;
      let bestId = null;
      let bestTimer = null;
      for (const [id, timer] of scheduled) {
        if (timer.at > target) continue;
        if (bestTimer === null || timer.at < bestTimer.at || (timer.at === bestTimer.at && id < bestTimer.id)) {
          bestTimer = timer;
          bestId = id;
        }
      }
      if (bestTimer === null) break;
      scheduled.delete(bestId);
      current = bestTimer.at;
      bestTimer.fn();
    }
    current = target;
  }

  return {
    now: function now() {
      return current;
    },
    setTimeout,
    clearTimeout,
    tick,
    pendingCount: function pendingCount() {
      return scheduled.size;
    },
  };
}

export function createFakeElement(tagName) {
  const listeners = new Map();
  const attributes = new Map();
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    style: {},
    children: [],
    parentNode: null,
    focused: false,
    clientWidth: 960,
    clientHeight: 540,
    rect: { width: 960, height: 540 },
    setAttribute: function setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute: function getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute: function hasAttribute(name) {
      return attributes.has(name);
    },
    getAttributes: function getAttributes() {
      return Object.fromEntries(attributes.entries());
    },
    addEventListener: function addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener: function removeEventListener(type, handler) {
      const list = listeners.get(type);
      if (!list) return;
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent: function dispatchEvent(type, event) {
      const list = listeners.get(type) || [];
      for (const handler of list.slice()) handler(event || {});
    },
    listenerCount: function listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
    appendChild: function appendChild(child) {
      child.parentNode = element;
      element.children.push(child);
      return child;
    },
    removeChild: function removeChild(child) {
      const index = element.children.indexOf(child);
      if (index >= 0) element.children.splice(index, 1);
      child.parentNode = null;
    },
    remove: function remove() {
      if (element.parentNode) element.parentNode.removeChild(element);
    },
    focus: function focus() {
      element.focused = true;
    },
    getBoundingClientRect: function getBoundingClientRect() {
      return element.rect;
    },
  };
  if (String(tagName).toLowerCase() === 'iframe') {
    element.sent = [];
    element.contentWindow = {
      postMessage: function postMessage(message, targetOrigin) {
        element.sent.push({ message, targetOrigin });
      },
    };
  }
  return element;
}

export function createFakeDocument() {
  const listeners = new Map();
  const doc = {
    hidden: false,
    createElement: function createElement(tagName) {
      return createFakeElement(tagName);
    },
    addEventListener: function addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener: function removeEventListener(type, handler) {
      const list = listeners.get(type);
      if (!list) return;
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent: function dispatchEvent(type, event) {
      const list = listeners.get(type) || [];
      for (const handler of list.slice()) handler(event || {});
    },
    listenerCount: function listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
    setHidden: function setHidden(hidden) {
      doc.hidden = Boolean(hidden);
      doc.dispatchEvent('visibilitychange', {});
    },
  };
  return doc;
}

export function createFakeWindow(doc) {
  const listeners = new Map();
  const win = {
    devicePixelRatio: 2,
    document: doc,
    addEventListener: function addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener: function removeEventListener(type, handler) {
      const list = listeners.get(type);
      if (!list) return;
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent: function dispatchEvent(type, event) {
      const list = listeners.get(type) || [];
      for (const handler of list.slice()) handler(event || {});
    },
    listenerCount: function listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
  };
  return win;
}

export function createFakeApi() {
  const calls = [];
  const state = { save: null, nextRevision: 0, failNextSave: null };
  const api = {
    calls,
    state,
    setSave: function setSave(payload) {
      calls.push(['setSave', payload]);
      if (state.failNextSave) {
        const error = state.failNextSave;
        state.failNextSave = null;
        return Promise.reject(error);
      }
      const current = state.save || { gameId: payload.gameId, values: {}, revision: 0, updatedAt: null };
      const values = Object.assign({}, current.values);
      if (payload.data === null) delete values[payload.key];
      else values[payload.key] = payload.data;
      state.nextRevision += 1;
      state.save = {
        gameId: payload.gameId,
        values,
        revision: state.nextRevision,
        updatedAt: '2026-10-18T00:00:00.000Z',
      };
      return Promise.resolve({
        gameId: payload.gameId,
        keys: Object.keys(values).length,
        bytes: JSON.stringify(values).length,
        revision: state.save.revision,
        updatedAt: state.save.updatedAt,
      });
    },
    getSave: function getSave(gameId, options) {
      calls.push(['getSave', gameId, options]);
      if (!state.save) {
        const error = new Error('Save not found');
        error.code = 'GM-4041';
        error.retryable = false;
        return Promise.reject(error);
      }
      return Promise.resolve({
        gameId,
        keys: Object.keys(state.save.values).length,
        bytes: JSON.stringify(state.save.values).length,
        revision: state.save.revision,
        updatedAt: state.save.updatedAt,
        values: options && options.includeData ? Object.assign({}, state.save.values) : undefined,
      });
    },
    startSession: function startSession(request) {
      calls.push(['startSession', request]);
      return Promise.resolve({
        playSessionId: 'ps_1234567890abcdef',
        startedAt: '2026-10-18T00:00:00.000Z',
        adopted: false,
      });
    },
    endSession: function endSession(request) {
      calls.push(['endSession', request]);
      return Promise.resolve({
        playSessionId: request.playSessionId,
        startedAt: '2026-10-18T00:00:00.000Z',
        endedAt: '2026-10-18T00:01:00.000Z',
        outcome: request.outcome,
        score: request.score === undefined ? null : request.score,
        ignored: false,
      });
    },
    submitScore: function submitScore(request) {
      calls.push(['submitScore', request]);
      return Promise.resolve({
        best: Math.max(request.score, 100),
        isBest: request.score >= 100,
        submittedAt: '2026-10-18T00:01:00.000Z',
      });
    },
    getScores: function getScores(gameId) {
      calls.push(['getScores', gameId]);
      return Promise.resolve({
        best: { value: 120, achievedAt: '2026-10-18T00:00:00.000Z', playSessionId: 'ps_1234567890abcdef' },
        history: [],
        direction: 'higher-better',
      });
    },
  };
  return api;
}

export function flushAsync() {
  return new Promise(function wait(resolve) {
    setImmediate(resolve);
  });
}
