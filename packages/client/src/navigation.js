/** Panel navigation indirection so every surface uses the same DSH layout call. */
import { reportDiagnostic } from './diagnostics.js';
import { MAIN_PANEL_KEY } from './constants.js';

let selectImpl = null;

/**
 * Install the panel selector from `ctx.layout`. Returns a disposer owned by the
 * plugin fiber / `ctx.effect`.
 */
export function configureNavigation(layout) {
  if (layout && typeof layout.selectPanel === 'function') {
    selectImpl = function selectPanel(panelId) {
      try {
        layout.selectPanel(panelId);
        return true;
      } catch (error) {
        reportDiagnostic('select-panel-failed', error);
        return false;
      }
    };
  } else {
    selectImpl = null;
  }
  return function disposeNavigation() {
    selectImpl = null;
  };
}

/** Select the Game Market main panel. */
export function openGameMarket() {
  return selectImpl ? selectImpl(MAIN_PANEL_KEY) : false;
}

/** Return to the host Conversation (null panel id). */
export function backToConversation() {
  return selectImpl ? selectImpl(null) : false;
}

/** Whether layout wiring is available (diagnostics/tests). */
export function isNavigationReady() {
  return selectImpl !== null;
}
