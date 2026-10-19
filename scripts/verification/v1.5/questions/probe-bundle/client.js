/**
 * V1.5 M0 S-Q1/S-Q2 probe — browser half.
 *
 * This is a third-party `dsh.client` package. It does exactly what the planned
 * V1.5 game platform question adapter would have to do:
 *
 *   - register a `main` panel (the same registration form the real Game Market
 *     uses) so `ctx.layout.selectPanel()` can replace the conversation view with
 *     a "game" surface;
 *   - subscribe to / read `ctx.uiSession.sessionStatus` and pick the **live
 *     PendingQuestion object** the native `dsh-client-ui-user-questions` plugin
 *     publishes for the bound Session;
 *   - call `pending.answer({ answers })` on that object (open/waterfall path) or
 *     `ctx.remote.userQuestions.answer(...)` once the question is continued.
 *
 * The probe only *observes and reports*; assertions live in the Node runner.
 * `window.__QPROBE__` is the test control surface the CDP driver calls.
 */
window.__ModuleLoader__.load({
  id: 'dsh-qprobe',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');

    var PANEL_KEY = 'qprobe-game';
    var REDACTED_URL = function () {
      try {
        return String(location.href).replace(/token=[^&]+/, 'token=<redacted>');
      } catch (error) {
        return null;
      }
    };

    /** A zero-interaction "game" surface: enough to replace the conversation view. */
    function QProbeGamePanel() {
      return React.createElement(
        'div',
        {
          'data-qprobe-panel': PANEL_KEY,
          style: {
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            height: '100%',
            padding: '24px',
            font: '14px/1.5 system-ui, sans-serif',
            color: 'var(--dsw-alias-label-primary, #14161a)',
          },
        },
        React.createElement('div', { style: { fontWeight: 600 } }, 'QPROBE GAME PANEL'),
        React.createElement(
          'div',
          { style: { opacity: 0.7 } },
          'simulated game view: ctx.layout.selectPanel() replaced the conversation view',
        ),
      );
    }

    /** Durable, JSON-safe summary of one PendingQuestion (no answer text is invented). */
    function summarizePending(pending) {
      if (!pending || typeof pending !== 'object') return null;
      var snapshot = null;
      try {
        snapshot = typeof pending.snapshot === 'function' ? pending.snapshot() : null;
      } catch (error) {
        snapshot = { error: String(error && error.message) };
      }
      var questions = Array.isArray(pending.questions) ? pending.questions : [];
      return {
        kind: pending.kind,
        key: pending.key,
        sessionId: pending.sessionId,
        callId: pending.callId === undefined ? null : pending.callId,
        dismissal: pending.dismissal,
        isReview: pending.review !== undefined,
        hasWaterfall: typeof pending.hasWaterfall === 'function' ? pending.hasWaterfall() : null,
        snapshot: snapshot
          ? {
              state: snapshot.state,
              waitState: snapshot.waitState,
              channel: snapshot.channel,
              closed: snapshot.closed,
              countdown: snapshot.countdown
                ? { remainingMs: snapshot.countdown.remainingMs, running: snapshot.countdown.running }
                : null,
            }
          : null,
        questions: questions.map(function (question) {
          return {
            id: question.id,
            header: question.header === undefined ? null : question.header,
            question: question.question,
            multiSelect: question.multiSelect === true,
            optionLabels: (question.options || []).map(function (option) {
              return option.label;
            }),
            kind: question.kind === undefined ? null : question.kind,
          };
        }),
      };
    }

    /** Visible-DOM signals for "is the native question composer on screen". */
    function domSignals() {
      var visible = function (element) {
        return Boolean(element && element.offsetParent !== null);
      };
      var editors = [];
      try {
        editors = Array.prototype.filter.call(
          document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]'),
          visible,
        );
      } catch (error) {
        editors = [];
      }
      var bodyText = '';
      try {
        bodyText = document.body ? document.body.innerText || '' : '';
      } catch (error) {
        bodyText = '';
      }
      return {
        composerEditorCount: editors.length,
        questionTextVisible: bodyText.indexOf('QPROBE_') !== -1,
        probePanelVisible: Boolean(document.querySelector('[data-qprobe-panel]')),
        url: REDACTED_URL(),
      };
    }

    /** Install the client-half probe and its control surface. */
    function apply(ctx) {
      // Same registration form the real game market uses: a keyed `main` slot.
      var disposePanel = ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: PANEL_KEY }, QProbeGamePanel);
      });

      function statusSnapshot() {
        try {
          return ctx.uiSession.sessionStatus.getSnapshot();
        } catch (error) {
          return null;
        }
      }

      function statusOf(sessionId) {
        var snapshot = statusSnapshot();
        if (!snapshot || typeof snapshot.get !== 'function') return null;
        return snapshot.get(sessionId) || null;
      }

      // Live references captured before a native close/hide, so the probe can
      // observe what the contract says about the request's continued lifetime.
      var capturedPending = Object.create(null);

      var api = {
        probeVersion: 1,
        panelKey: PANEL_KEY,
        /** Hold the live PendingQuestion reference for this Session. */
        capturePending: function (sessionId) {
          var value = statusOf(sessionId);
          var pending = value && value.pendingInteraction;
          if (!pending) return { ok: false, code: 'NO_PENDING_OBJECT' };
          capturedPending[sessionId] = pending;
          return { ok: true, key: pending.key, callId: pending.callId === undefined ? null : pending.callId };
        },
        /** Answer through the captured reference even after the card left sessionStatus. */
        answerCaptured: async function (sessionId, batch) {
          var pending = capturedPending[sessionId];
          if (!pending) return { ok: false, code: 'NO_CAPTURED_PENDING' };
          var startedAt = Date.now();
          try {
            await pending.answer(batch);
            return { ok: true, elapsedMs: Date.now() - startedAt, summaryAfter: summarizePending(pending) };
          } catch (error) {
            return {
              ok: false,
              elapsedMs: Date.now() - startedAt,
              code: (error && error.code) || (error && error.name) || 'ERROR',
              message: String((error && error.message) || error),
            };
          }
        },
        /** Drop the captured reference for one Session. */
        releaseCaptured: function (sessionId) {
          delete capturedPending[sessionId];
          return true;
        },
        /** Selected main panel id (null means the conversation view). */
        panelSelected: function () {
          try {
            return ctx.layout.panelInfo.getSnapshot().activePanelId;
          } catch (error) {
            return { error: String(error && error.message) };
          }
        },
        selectGamePanel: function () {
          var boundSessionId = api.mainSessionId();
          ctx.layout.selectPanel(PANEL_KEY);
          return { selectedPanel: api.panelSelected(), boundSessionId: boundSessionId };
        },
        selectConversation: function () {
          ctx.layout.selectPanel(null);
          return { selectedPanel: api.panelSelected() };
        },
        /** Session currently shown in the main view (what a game panel would bind). */
        mainSessionId: function () {
          try {
            var workspace = ctx.get('uiWorkspace');
            return workspace && workspace.mainReference ? workspace.mainReference.sessionId : null;
          } catch (error) {
            return null;
          }
        },
        /** Per-Session running/pending projection the native UI publishes. */
        statusAll: function () {
          var snapshot = statusSnapshot();
          var out = {};
          if (!snapshot || typeof snapshot.forEach !== 'function') return out;
          snapshot.forEach(function (value, sessionId) {
            out[sessionId] = {
              running: value.running === true,
              completionUnread: value.completionUnread === true,
              pending: summarizePending(value.pendingInteraction),
              hasPendingObject: value.pendingInteraction !== undefined && value.pendingInteraction !== null,
            };
          });
          return out;
        },
        statusOf: function (sessionId) {
          var value = statusOf(sessionId);
          if (value === null) return null;
          return {
            running: value.running === true,
            pending: summarizePending(value.pendingInteraction),
            hasPendingObject: value.pendingInteraction !== undefined && value.pendingInteraction !== null,
          };
        },
        /** The raw live PendingQuestion instance is intentionally *not* serialized; this
         *  method only proves identity/type for the evidence trail. */
        pendingType: function (sessionId) {
          var value = statusOf(sessionId);
          var pending = value && value.pendingInteraction;
          if (!pending) return null;
          var proto = Object.getPrototypeOf(pending);
          return {
            constructorName: proto && proto.constructor ? proto.constructor.name : null,
            methodNames: ['answer', 'dismiss', 'delegate', 'close', 'snapshot', 'hasWaterfall', 'subscribe'].filter(
              function (name) {
                return typeof pending[name] === 'function';
              },
            ),
            ownKeys: Object.keys(pending),
          };
        },
        domSignals: domSignals,
        /** Create a Session through the same Remote method the Web UI uses. */
        createSession: async function (cwd, agentPreset) {
          try {
            var request = { cwd: cwd };
            if (agentPreset !== undefined && agentPreset !== null) request.agentPreset = agentPreset;
            var result = await ctx.remote.session.create(request);
            return { transport: 'ok', result: JSON.parse(JSON.stringify(result)) };
          } catch (error) {
            return {
              transport: 'threw',
              code: (error && error.code) || (error && error.name) || 'ERROR',
              message: String((error && error.message) || error),
            };
          }
        },
        /** Admit one user prompt through the same Remote method the composer uses. */
        promptSession: async function (sessionId, text) {
          try {
            var request = {
              requestId: 'qprobe-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
              sessionId: sessionId,
              mode: 'queue',
              content: [{ type: 'text', text: text }],
            };
            var result = await ctx.remote.session.prompt(request);
            return { transport: 'ok', requestId: request.requestId, result: JSON.parse(JSON.stringify(result)) };
          } catch (error) {
            return {
              transport: 'threw',
              code: (error && error.code) || (error && error.name) || 'ERROR',
              message: String((error && error.message) || error),
            };
          }
        },
        /** Show one Session in the main view exactly like clicking it in the sidebar. */
        openSession: function (sessionId) {
          try {
            var workspace = ctx.get('uiWorkspace');
            if (!workspace || typeof workspace.openSession !== 'function') return { ok: false, code: 'NO_WORKSPACE' };
            workspace.openSession(sessionId);
            return { ok: true };
          } catch (error) {
            return { ok: false, code: (error && error.code) || 'ERROR', message: String((error && error.message) || error) };
          }
        },
        /** Fresh blank Session in the current workspace, used for "switch Session" tests. */
        startBlankSession: function () {
          try {
            var workspace = ctx.get('uiWorkspace');
            if (!workspace || typeof workspace.startSession !== 'function') return { ok: false, code: 'NO_WORKSPACE' };
            workspace.startSession();
            return { ok: true };
          } catch (error) {
            return { ok: false, code: (error && error.code) || 'ERROR', message: String((error && error.message) || error) };
          }
        },
        /** Answer an open (or continued) question through the live PendingQuestion. */
        answerPending: async function (sessionId, batch) {
          var value = statusOf(sessionId);
          var pending = value && value.pendingInteraction;
          if (!pending) return { ok: false, code: 'NO_PENDING_OBJECT', sessionId: sessionId };
          var startedAt = Date.now();
          try {
            await pending.answer(batch);
            return {
              ok: true,
              elapsedMs: Date.now() - startedAt,
              summaryAfter: summarizePending(pending),
            };
          } catch (error) {
            return {
              ok: false,
              elapsedMs: Date.now() - startedAt,
              code: (error && error.code) || (error && error.name) || 'ERROR',
              message: String((error && error.message) || error),
            };
          }
        },
        /** Call the continued-path Remote method directly and keep its raw envelope. */
        answerViaRpc: async function (sessionId, callId, batch) {
          try {
            var remote = ctx.remote && ctx.remote.userQuestions ? ctx.remote.userQuestions : null;
            if (!remote || typeof remote.answer !== 'function') return { ok: false, code: 'NO_REMOTE_METHOD' };
            var result = await remote.answer(sessionId, callId, batch);
            return { transport: 'ok', result: JSON.parse(JSON.stringify(result)) };
          } catch (error) {
            return {
              transport: 'threw',
              code: (error && error.code) || (error && error.name) || 'ERROR',
              message: String((error && error.message) || error),
            };
          }
        },
        /** Close the panel through the native PendingQuestion contract (hide, not cancel). */
        dismissPending: async function (sessionId) {
          var value = statusOf(sessionId);
          var pending = value && value.pendingInteraction;
          if (!pending) return { ok: false, code: 'NO_PENDING_OBJECT' };
          try {
            await pending.dismiss();
            return { ok: true };
          } catch (error) {
            return { ok: false, code: (error && error.code) || 'ERROR', message: String((error && error.message) || error) };
          }
        },
        /** Raw session list identity, for switching/competition evidence. */
        sessions: function () {
          try {
            var controller = ctx.get('sessions');
            var list = controller && controller.list ? controller.list.getSnapshot() : null;
            var main = api.mainSessionId();
            return {
              mainSessionId: main,
              ids: list && list.ids ? list.ids.slice() : [],
              phase: list ? list.phase : null,
            };
          } catch (error) {
            return { error: String(error && error.message) };
          }
        },
        runtime: function () {
          return {
            probeVersion: 1,
            url: REDACTED_URL(),
            readyState: document.readyState,
            panelSelected: api.panelSelected(),
            mainSessionId: api.mainSessionId(),
            dom: domSignals(),
            statusAll: api.statusAll(),
          };
        },
      };

      globalThis.__QPROBE__ = api;
      ctx.effect(function () {
        return function () {
          if (globalThis.__QPROBE__ === api) delete globalThis.__QPROBE__;
          if (typeof disposePanel === 'function') disposePanel();
        };
      }, 'qprobe: control surface');
    }

    exports.apply = apply;
    exports.inject = ['slots', 'layout', 'uiSession', 'sessions', 'remote', 'remote.session', 'remote.userQuestions'];
    return module.exports;
  },
});
