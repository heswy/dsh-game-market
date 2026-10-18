/** Shared React hooks for the standard Session props, store, and wall clock. */
import React from 'react';
import { store } from './store.js';
import { selectCurrentSessionId, selectSessionStatus, summarizeSessionStatus } from './binding.js';
import { reportDiagnostic } from './diagnostics.js';

/** Subscribe to the module store with `useSyncExternalStore`. */
export function useStoreState() {
  return React.useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Re-render once per interval so 5s / 10min thresholds are evaluated live. */
export function useClock(intervalMs) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(
    function tick() {
      const timer = setInterval(function update() {
        setNow(Date.now());
      }, intervalMs);
      return function cleanup() {
        clearInterval(timer);
      };
    },
    [intervalMs]
  );
  return now;
}

/**
 * Resolve the current DSH Session id from the slot's standard hooks.
 * Any hook failure degrades to null and records one diagnostic; it never throws
 * out of render. The hook call order is fixed by the registration kit.
 */
export function useSessionBinding(props, diagnosticRef) {
  const source = props && typeof props === 'object' ? props : {};
  let sessionId = null;
  let dshStatus = null;

  if (typeof source.useSessions === 'function') {
    try {
      sessionId = source.useSessions(selectCurrentSessionId);
    } catch (error) {
      if (diagnosticRef && !diagnosticRef.current) {
        diagnosticRef.current = true;
        reportDiagnostic('session-props-unavailable', error);
      }
      sessionId = null;
    }
  }

  if (typeof source.useSessionStatus === 'function') {
    try {
      const status = source.useSessionStatus(function pick(map) {
        return selectSessionStatus(map, sessionId);
      });
      dshStatus = summarizeSessionStatus(status);
    } catch (error) {
      if (diagnosticRef && !diagnosticRef.current) {
        diagnosticRef.current = true;
        reportDiagnostic('session-status-unavailable', error);
      }
      dshStatus = null;
    }
  }

  return { sessionId: sessionId, dshStatus: dshStatus };
}

/** Subscribe to `usePanelInfo(activePanelId)` when the kit provides it. */
export function useActivePanel(props, diagnosticRef) {
  const source = props && typeof props === 'object' ? props : {};
  let activePanelId = null;
  if (typeof source.usePanelInfo === 'function') {
    try {
      activePanelId = source.usePanelInfo(function pick(info) {
        return info ? info.activePanelId : null;
      });
    } catch (error) {
      if (diagnosticRef && !diagnosticRef.current) {
        diagnosticRef.current = true;
        reportDiagnostic('panel-info-unavailable', error);
      }
      activePanelId = null;
    }
  }
  return activePanelId === undefined ? null : activePanelId;
}

/** Store dispatch helper. */
export function dispatch(action) {
  return store.dispatch(action);
}

/** Convenient store read for event handlers. */
export function readStore() {
  return store.getState();
}
