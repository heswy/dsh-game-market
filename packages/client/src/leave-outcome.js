/**
 * Classify the pause step of the leave protocol.
 *
 * `skipped` means the Runtime waited for `storage.save` and the game never
 * issued one (menu/fresh states deliberately skip persisting). That is not a
 * failure, so the Client must not show the "could not save" dialog for it.
 */

export const LEAVE_OUTCOME = Object.freeze({
  SAVED: 'saved',
  NO_PROGRESS: 'no-progress',
  BLOCKED: 'blocked',
});

/**
 * @param {{ok?: boolean, saveStale?: boolean, skipped?: boolean, unresponsive?: boolean}|null} result
 * @returns {'saved'|'no-progress'|'blocked'}
 */
export function classifyLeave(result) {
  if (!result || typeof result !== 'object') return LEAVE_OUTCOME.BLOCKED;
  if (result.ok === true) {
    return result.saveStale === true ? LEAVE_OUTCOME.BLOCKED : LEAVE_OUTCOME.SAVED;
  }
  if (result.skipped === true && result.unresponsive !== true) return LEAVE_OUTCOME.NO_PROGRESS;
  return LEAVE_OUTCOME.BLOCKED;
}
