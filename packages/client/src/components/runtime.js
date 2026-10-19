/**
 * Runtime page: mounts the Runtime controller, renders the floating controls,
 * the Agent Presence and every leave/error flow from PRD 9.2 / 9.6.
 */
import React from 'react';
import { TIMING } from '../../../shared/src/constants.js';
import { GM } from '../../../shared/src/errors.js';
import { store, agentSnapshotReceived, runtimePatched, runtimeFailed, runtimeRetried, runtimeLaunchInfo, surfaceChanged, leaveCompleted } from '../store.js';
import { applyRuntimeEvent, acknowledgeCompleted, finishLeave, gameNameFromState, recordPausedGame } from '../actions.js';
import { getApiClient } from '../api.js';
import { MAIN_PANEL_KEY } from '../constants.js';
import { isRuntimeLoadingState, validateLaunchInfo } from '../runtime-utils.js';
import { createRuntimeController, destroyRuntime, forwardAgentState, pauseRuntimeBounded, resumeRuntime } from '../runtime-adapter.js';
import { normalizeUiError, runtimeErrorBodyKey, runtimeErrorRetryable, runtimeErrorTitleKey, uiError } from '../ui-errors.js';
import { derivePresenceState } from '../presence.js';
import { makeT, detectLocale } from '../locale.js';
import { BackIcon, PauseIcon, PlayIcon } from '../icons.js';
import { backToConversation } from '../navigation.js';
import { useClock, useStoreState } from '../hooks.js';
import { reportDiagnostic } from '../diagnostics.js';
import { AgentPresence } from './whale.js';

const h = React.createElement;

function prefersReducedMotion() {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_error) {
    return false;
  }
}

/**
 * Best-effort theme for the Runtime environment. The DSH theme is exposed
 * through CSS tokens, not a public client hook, so V0 follows the OS scheme and
 * lets the token-based platform UI stay correct either way.
 */
function detectTheme() {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (_error) {
    return 'light';
  }
}

function saveStatusKey(status) {
  if (status === 'saving') return 'runtime.save.saving';
  if (status === 'failed') return 'runtime.save.failed';
  return 'runtime.save.saved';
}

function RuntimeErrorCard(props) {
  const error = props.error || uiError(GM.INTERNAL);
  const t = props.t;
  const titleRef = React.useRef(null);
  const [copied, setCopied] = React.useState(false);
  const titleKey = runtimeErrorTitleKey(error.code);
  const bodyKey = runtimeErrorBodyKey(error.code);
  const retryable = runtimeErrorRetryable(error) || props.forceRetry === true;

  React.useEffect(
    function focusTitle() {
      const title = titleRef.current;
      if (title && typeof title.focus === 'function') {
        try {
          title.focus({ preventScroll: true });
        } catch (_error) {
          title.focus();
        }
      }
    },
    [error.code]
  );

  function copyCode() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        void navigator.clipboard.writeText(error.code).then(function copiedCode() {
          setCopied(true);
        }).catch(function ignore() {});
      }
    } catch (_error) {
      // Clipboard is optional.
    }
  }

  return h(
    'div',
    { className: 'dgm-error-card', role: 'alert' },
    h(
      'div',
      { className: 'dgm-error-inner' },
      h('h2', { className: 'dgm-error-title', ref: titleRef, tabIndex: -1 }, props.title || t(titleKey)),
      bodyKey ? h('p', { className: 'dgm-error-body' }, t(bodyKey)) : null,
      h(
        'div',
        { className: 'dgm-error-actions' },
        retryable
          ? h(
              'button',
              { type: 'button', className: 'dgm-btn dgm-btn-primary', onClick: props.onRetry },
              t('runtime.error.retry')
            )
          : null,
        h('button', { type: 'button', className: 'dgm-btn', onClick: props.onBack }, t('runtime.error.backMarket'))
      ),
      h(
        'div',
        { className: 'dgm-diagnostic' },
        h('span', null, t('runtime.diagnostic', { code: error.code })),
        h('button', { type: 'button', className: 'dgm-diagnostic-copy', onClick: copyCode }, copied ? t('runtime.diagnostic.copied') : t('runtime.diagnostic.copy'))
      )
    )
  );
}

function SaveFailureDialog(props) {
  const t = props.t;
  const retryRef = React.useRef(null);
  React.useEffect(
    function focusRetry() {
      const button = retryRef.current;
      if (button && typeof button.focus === 'function') {
        try {
          button.focus({ preventScroll: true });
        } catch (_error) {
          button.focus();
        }
      }
    },
    []
  );
  const bodyKey = props.unresponsive ? 'runtime.leave.blocked.unresponsive' : 'runtime.leave.blocked.body';
  return h(
    'div',
    {
      className: 'dgm-overlay',
      onKeyDown: function saveDialogKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onStay();
        }
      },
    },
    h(
      'div',
      { className: 'dgm-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': t('runtime.leave.blocked.title') },
      h('h2', { className: 'dgm-modal-title' }, t('runtime.leave.blocked.title')),
      h('p', { className: 'dgm-modal-body' }, t(bodyKey)),
      h(
        'div',
        { className: 'dgm-modal-actions' },
        h('button', { type: 'button', className: 'dgm-btn dgm-btn-quiet', onClick: props.onStay }, t('runtime.leave.stay')),
        h(
          'button',
          { type: 'button', className: 'dgm-btn dgm-btn-danger', onClick: props.onForce },
          t('runtime.leave.force')
        ),
        h(
          'button',
          { type: 'button', className: 'dgm-btn dgm-btn-primary', ref: retryRef, onClick: props.onRetry },
          t('runtime.leave.retry')
        )
      )
    )
  );
}

export function RuntimeView(props) {
  const state = useStoreState();
  const now = useClock(1000);
  const locale = detectLocale();
  const t = makeT(props && props.t, locale);
  const runtime = state.runtime;
  const gameName = runtime.gameId ? gameNameFromState(state, runtime.gameId) : '';
  const agent = state.agent;
  const presence = derivePresenceState(
    {
      agent: agent,
      agentFetchedAt: state.agentFetchedAt,
      runtimeError: runtime.error,
    },
    now,
    { sessionId: runtime.bindingSessionId || state.bindingSessionId }
  );

  const stageRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const controllerRef = React.useRef(null);
  const leavingRef = React.useRef(false);
  const [busy, setBusy] = React.useState(false);
  const [slow, setSlow] = React.useState(false);
  const [resumeConfirmed, setResumeConfirmed] = React.useState(false);
  const [saveFailure, setSaveFailure] = React.useState(null);
  const [exitedReason, setExitedReason] = React.useState(null);
  const pausePrimaryRef = React.useRef(null);

  const gameId = runtime.gameId;
  const attempt = runtime.attempt;
  const mode = runtime.mode;
  const loading = isRuntimeLoadingState(runtime.state) || runtime.state === 'launching';
  const showPauseOverlay = runtime.state === 'paused' && !runtime.error && !autoResuming;

  React.useEffect(
    function bootRuntime() {
      let mounted = true;
      let controller = null;
      store.dispatch(surfaceChanged('runtime', true));
      setSlow(false);
      setResumeConfirmed(false);
      setSaveFailure(null);
      setBusy(false);
      leavingRef.current = false;

      function fail(error) {
        if (!mounted) return;
        store.dispatch(runtimeFailed(normalizeUiError(error, GM.NO_RUNTIME)));
      }

      function handleEvent(event) {
        if (!mounted || !event || typeof event !== 'object') return;
        if (event.type === 'agent-state' && event.snapshot) {
          store.dispatch(agentSnapshotReceived(event.snapshot, Date.now()));
          return;
        }
        if (event.type === 'exit') {
          setExitedReason(typeof event.reason === 'string' ? event.reason : 'exited');
          applyRuntimeEvent(store, event);
          return;
        }
        applyRuntimeEvent(store, event);
      }

      async function boot() {
        const api = getApiClient();
        if (!api) {
          fail(uiError(GM.NO_RUNTIME));
          return;
        }
        const view = store.getState();
        let info = view.runtime.launchInfo;
        if (!info) {
          store.dispatch(runtimePatched({ state: 'launching' }));
          try {
            info = await api.launch({
              gameId: gameId,
              dshSessionId: view.runtime.bindingSessionId || view.bindingSessionId || null,
              mode: mode,
            });
          } catch (error) {
            fail(normalizeUiError(error, GM.HOST_UNAVAILABLE));
            return;
          }
          if (!mounted) return;
          const checked = validateLaunchInfo(info);
          if (!checked.ok) {
            fail(checked.error);
            return;
          }
          store.dispatch(runtimeLaunchInfo(info));
        } else {
          const checked = validateLaunchInfo(info);
          if (!checked.ok) {
            fail(checked.error);
            return;
          }
        }
        if (!mounted) return;

        const created = createRuntimeController({
          container: canvasRef.current,
          api: api,
          environment: {
            theme: detectTheme(),
            reducedMotion: prefersReducedMotion(),
            locale: locale,
          },
          onEvent: handleEvent,
        });
        if (!created.ok) {
          fail(created.error);
          return;
        }
        controller = created.controller;
        controllerRef.current = controller;
        if (!mounted) {
          controllerRef.current = null;
          destroyRuntime(controller);
          return;
        }
        forwardAgentState(controller, store.getState().agent);
        try {
          await controller.launch(info);
        } catch (error) {
          if (mounted) fail(normalizeUiError(error, GM.LOAD_TIMEOUT));
        }
      }

      void boot();

      return function teardown() {
        mounted = false;
        store.dispatch(surfaceChanged('runtime', false));
        const current = controller;
        controller = null;
        if (controllerRef.current === current) controllerRef.current = null;
        if (!current) return;
        const currentState = store.getState().runtime.state;
        if (leavingRef.current || currentState === 'error' || currentState === 'exited') {
          destroyRuntime(current);
          return;
        }
        // External unmount (host navigation, plugin disable): give pause a chance,
        // then tear the iframe down. No UI can await this cleanup.
        try {
          const pending = current.pause();
          if (pending && typeof pending.then === 'function') {
            pending.then(
              function done() {
                destroyRuntime(current);
              },
              function failed() {
                destroyRuntime(current);
              }
            );
          } else {
            destroyRuntime(current);
          }
        } catch (_error) {
          destroyRuntime(current);
        }
      };
    },
    [gameId, mode, attempt, locale]
  );

  React.useEffect(
    function watchLoadDeadlines() {
      setSlow(false);
      const slowTimer = setTimeout(function markSlow() {
        setSlow(true);
      }, TIMING.loadSlowMs);
      const failTimer = setTimeout(function hardFail() {
        const current = store.getState().runtime;
        if (isRuntimeLoadingState(current.state)) {
          store.dispatch(runtimeFailed(uiError(GM.LOAD_TIMEOUT, { retryable: true })));
        }
      }, TIMING.loadErrorMs);
      return function cleanup() {
        clearTimeout(slowTimer);
        clearTimeout(failTimer);
      };
    },
    [gameId, attempt]
  );

  React.useEffect(
    function focusStage() {
      const stage = stageRef.current;
      if (stage && typeof stage.focus === 'function') {
        try {
          stage.focus({ preventScroll: true });
        } catch (_error) {
          stage.focus();
        }
      }
    },
    [gameId]
  );

  React.useEffect(
    function focusPauseOverlay() {
      if (!showPauseOverlay) return;
      const button = pausePrimaryRef.current;
      if (button && typeof button.focus === 'function') {
        try {
          button.focus({ preventScroll: true });
        } catch (_error) {
          button.focus();
        }
      }
    },
    [showPauseOverlay]
  );

  React.useEffect(
    function forwardAgent() {
      forwardAgentState(controllerRef.current, agent);
    },
    [agent]
  );

  React.useEffect(
    function autoResumeFromTab() {
      if (!autoResuming) return;
      if (runtime.state !== 'paused') return;
      if (busy || leavingRef.current) return;
      setResumeConfirmed(true);
      resumeGame();
    },
    [autoResuming, runtime.state, busy]
  );

  // Game-tab return: the click is the confirmation. Skip the platform resume
  // dialog and start playing right away (D-024 dialog stays for other paths).
  const autoResuming = runtime.autoResume === true && runtime.mode === 'resume-paused' && !resumeConfirmed;
  const isResumeMode = runtime.mode === 'resume-paused' && !resumeConfirmed && !autoResuming;
  const saveStatus = runtime.saveStatus;
  const showSavePill = saveStatus !== 'idle' || runtime.lastSaveAt > 0;

  function releaseHostInstance(gameId) {
    if (typeof gameId !== 'string' || gameId.length === 0) return;
    const api = getApiClient();
    if (!api || typeof api.releaseRuntime !== 'function') return;
    Promise.resolve(api.releaseRuntime({ gameId })).catch(function ignore() {});
  }

  function destroyCurrent() {
    const gameId = store.getState().runtime.gameId;
    const controller = controllerRef.current;
    controllerRef.current = null;
    destroyRuntime(controller);
    // Leaving the Runtime unlocks update/uninstall while keeping the Play
    // Session (and therefore Continue) intact.
    releaseHostInstance(gameId);
  }

  function completeLeave(target, reason, saveStale) {
    const view = store.getState();
    const sessionId = view.runtime.bindingSessionId || view.bindingSessionId;
    recordPausedGame(store, {
      gameId: view.runtime.gameId,
      reason: reason,
      at: Date.now(),
      saveStale: saveStale === true,
      sessionId: sessionId,
    });
    const snapshot = view.agent;
    const shouldAck =
      target === 'conversation' &&
      snapshot &&
      snapshot.state === 'completed' &&
      snapshot.sessionId &&
      snapshot.sessionId === sessionId;
    leavingRef.current = true;
    setBusy(false);
    setSaveFailure(null);
    destroyCurrent();
    finishLeave(store, {
      sessionId: shouldAck ? snapshot.sessionId : null,
      seq: shouldAck ? snapshot.seq : null,
      acknowledge: Boolean(shouldAck),
    });
    if (shouldAck) {
      void acknowledgeCompleted({
        store: store,
        api: getApiClient(),
        sessionId: snapshot.sessionId,
        seq: snapshot.seq,
      });
    }
    if (target === 'conversation') backToConversation();
  }

  async function requestLeave(target, reason) {
    if (leavingRef.current || busy) return;
    leavingRef.current = true;
    setBusy(true);
    const result = await pauseRuntimeBounded(controllerRef.current);
    if (!result.ok) {
      leavingRef.current = false;
      setBusy(false);
      setSaveFailure({ target: target, reason: reason, unresponsive: result.unresponsive === true });
      return;
    }
    completeLeave(target, reason, result.saveStale);
  }

  function forceLeave() {
    if (!saveFailure) return;
    const pending = saveFailure;
    reportDiagnostic('save-forced');
    setSaveFailure(null);
    completeLeave(pending.target, pending.reason, true);
  }

  function retryFromFailure() {
    if (!saveFailure) return;
    const pending = saveFailure;
    setSaveFailure(null);
    void requestLeave(pending.target, pending.reason);
  }

  function stayInGame() {
    setSaveFailure(null);
    leavingRef.current = false;
    setBusy(false);
  }

  function handlePauseToggle() {
    if (busy || leavingRef.current) return;
    if (runtime.state === 'paused') {
      resumeGame();
      return;
    }
    if (runtime.state !== 'playing') return;
    setBusy(true);
    void pauseRuntimeBounded(controllerRef.current).then(function paused(result) {
      setBusy(false);
      if (result.ok) {
        store.dispatch(runtimePatched({ state: 'paused', saveStatus: result.saveStale ? 'failed' : 'saved' }));
      } else {
        store.dispatch(runtimePatched({ saveStatus: 'failed' }));
      }
    });
  }

  function resumeGame() {
    if (leavingRef.current || busy) return;
    const resumed = resumeRuntime(controllerRef.current);
    if (resumed) {
      setResumeConfirmed(true);
      store.dispatch(runtimePatched({ state: 'playing' }));
    } else {
      store.dispatch(runtimeFailed(uiError(GM.NO_RUNTIME, { retryable: true })));
    }
  }

  function retryRuntime() {
    leavingRef.current = true;
    store.dispatch(runtimeRetried());
  }

  function backToMarketWithoutRuntime() {
    leavingRef.current = true;
    destroyCurrent();
    store.dispatch(leaveCompleted());
    store.dispatch(surfaceChanged('runtime', false));
  }

  function handleStageKeyDown(event) {
    if (!event || event.target !== stageRef.current) return;
    if (event.key === 'Escape' && runtime.state === 'playing') {
      event.preventDefault();
      handlePauseToggle();
    }
  }

  function handlePresenceAction(kind) {
    if (busy || leavingRef.current) return;
    if (kind === 'waiting') {
      void requestLeave('conversation', 'waiting-user');
      return;
    }
    if (kind === 'results') {
      void requestLeave('conversation', 'view-result');
      return;
    }
    void requestLeave('conversation', 'leave');
  }

  const error = runtime.error;
  const showError = runtime.state === 'error' && error;
  const showExited = runtime.state === 'exited';

  return h(
    'div',
    { className: 'dgm-runtime', 'data-panel': MAIN_PANEL_KEY, 'data-runtime-state': runtime.state },
    h(
      'div',
      { className: 'dgm-runtime-stage-wrap' },
      h(
        'div',
        {
          className: 'dgm-stage',
          ref: stageRef,
          tabIndex: 0,
          role: 'group',
          'aria-label': t('runtime.stage.a11y'),
          onKeyDown: handleStageKeyDown,
        },
        h('div', { className: 'dgm-stage-canvas', ref: canvasRef }),
        loading && !showError
          ? h(
              'div',
              { className: 'dgm-runtime-loading', role: 'status' },
              h('span', { className: 'dgm-spinner', 'aria-hidden': 'true' }),
              h('p', { className: 'dgm-runtime-loading-title' }, t('runtime.loading', { gameName: gameName })),
              slow
                ? h('p', { className: 'dgm-runtime-loading-body' }, t('runtime.loading.slow'))
                : null,
              slow
                ? h(
                    'div',
                    { className: 'dgm-runtime-loading-actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dgm-btn dgm-btn-quiet',
                        onClick: function keepWaiting() {
                          setSlow(false);
                        },
                      },
                      t('runtime.loading.wait')
                    ),
                    h(
                      'button',
                      { type: 'button', className: 'dgm-btn', onClick: backToMarketWithoutRuntime },
                      t('runtime.loading.back')
                    )
                  )
                : null
            )
          : null,
        showError
          ? h(RuntimeErrorCard, {
              t: t,
              error: error,
              onRetry: retryRuntime,
              onBack: backToMarketWithoutRuntime,
            })
          : null,
        showExited
          ? h(
              'div',
              { className: 'dgm-error-card', role: 'alert' },
              h(
                'div',
                { className: 'dgm-error-inner' },
                h('h2', { className: 'dgm-error-title', tabIndex: -1 }, t('runtime.exited.title')),
                h('p', { className: 'dgm-error-body' }, t('runtime.exited.body')),
                h(
                  'div',
                  { className: 'dgm-error-actions' },
                  h(
                    'button',
                    { type: 'button', className: 'dgm-btn dgm-btn-primary', onClick: backToMarketWithoutRuntime },
                    t('runtime.exited.back')
                  )
                )
              )
            )
          : null
      )
    ),
    h(
      'div',
      { className: 'dgm-runtime-controls' },
      h(
        'div',
        { className: 'dgm-control-group' },
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-control-btn',
            onClick: function back() {
              if (loading || runtime.state === 'error' || runtime.state === 'exited') {
                backToMarketWithoutRuntime();
                return;
              }
              void requestLeave('market', 'leave');
            },
            'aria-label': t('runtime.action.back'),
            title: t('runtime.action.back'),
            disabled: busy,
          },
          h(BackIcon, { size: 15 })
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-control-btn',
            onClick: handlePauseToggle,
            'aria-label': runtime.state === 'paused' ? t('runtime.action.resume') : t('runtime.action.pause'),
            title: runtime.state === 'paused' ? t('runtime.action.resume') : t('runtime.action.pause'),
            disabled: busy || runtime.state === 'saving' || (runtime.state !== 'playing' && runtime.state !== 'paused'),
          },
          runtime.state === 'paused' ? h(PlayIcon, { size: 15 }) : h(PauseIcon, { size: 15 })
        )
      ),
      h('span', { className: 'dgm-spacer' }),
      showSavePill
        ? h(
            saveStatus === 'failed' ? 'button' : 'span',
            {
              type: saveStatus === 'failed' ? 'button' : undefined,
              className: 'dgm-save-pill',
              'data-status': saveStatus === 'idle' ? 'saved' : saveStatus,
              onClick: saveStatus === 'failed' ? handlePauseToggle : undefined,
              'aria-label': t(saveStatusKey(saveStatus)),
            },
            h('span', { className: 'dgm-save-dot', 'aria-hidden': 'true' }),
            saveStatus === 'failed' ? t('runtime.save.retry') : t(saveStatusKey(saveStatus))
          )
        : null,
    ),
    !loading && !showError && !showExited
      ? h(AgentPresence, {
          presence: presence,
          agent: agent,
          t: t,
          busy: busy || runtime.state === 'saving',
          dimmed: showPauseOverlay,
          onAction: handlePresenceAction,
        })
      : null,
    showPauseOverlay
      ? h(
          'div',
          {
            className: 'dgm-overlay',
            onKeyDown: function pauseOverlayKeyDown(event) {
              if (event.key === 'Escape' && !isResumeMode) {
                event.preventDefault();
                resumeGame();
              }
            },
          },
          h(
            'div',
            { className: 'dgm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': isResumeMode ? t('runtime.resume.title') : t('runtime.pause.title') },
            h('h2', { className: 'dgm-modal-title' }, isResumeMode ? t('runtime.resume.title') : t('runtime.pause.title')),
            isResumeMode ? h('p', { className: 'dgm-modal-body' }, t('runtime.resume.body')) : null,
            isResumeMode
              ? null
              : h('p', { className: 'dgm-modal-body' }, t('runtime.pause.audioNote')),
            h(
              'div',
              { className: 'dgm-modal-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dgm-btn dgm-btn-quiet',
                  onClick: function exitMarket() {
                    void requestLeave('market', 'leave');
                  },
                  disabled: busy,
                },
                t('runtime.pause.exitMarket')
              ),
              isResumeMode
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'dgm-btn',
                      onClick: function returnWork() {
                        void requestLeave('conversation', 'leave');
                      },
                      disabled: busy,
                    },
                    t('runtime.pause.saveReturn')
                  ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dgm-btn dgm-btn-primary',
                  ref: pausePrimaryRef,
                  onClick: resumeGame,
                  disabled: busy,
                },
                isResumeMode ? t('runtime.resume.action') : t('runtime.pause.resume')
              )
            )
          )
        )
      : null,
    busy && !showPauseOverlay
      ? h(
          'div',
          { className: 'dgm-overlay' },
          h(
            'div',
            { className: 'dgm-modal', role: 'status' },
            h('h2', { className: 'dgm-modal-title' }, t('agent.state.saving')),
            h('p', { className: 'dgm-modal-body' }, t('agent.a11y.saveBusy'))
          )
        )
      : null,
    saveFailure
      ? h(SaveFailureDialog, {
          t: t,
          unresponsive: saveFailure.unresponsive,
          onRetry: retryFromFailure,
          onStay: stayInGame,
          onForce: forceLeave,
        })
      : null,
    exitedReason
      ? h('span', { className: 'dgm-sr-only', role: 'status' }, exitedReason)
      : null,
    h(
      'span',
      { className: 'dgm-sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' },
      presence === 'completed'
        ? t('a11y.live.completed')
        : presence === 'error'
          ? t('a11y.live.error')
          : presence === 'waiting-user'
            ? t('a11y.live.waiting')
            : ''
    )
  );
}
