/**
 * Host-authoritative platform-update admission barrier (audit M3-AUD-03).
 *
 * Updating the plugin package replaces the Host code that serves games. A user
 * starting a new game while an update is between "coordination satisfied" and
 * "package change" would bypass the pause+save gate, so the Host — not the UI —
 * must block new runtime entries for that window.
 *
 * Lifecycle (owned by `createUpdateOperationService`):
 *   - `block(operationId)` when an operation is created (before any package
 *     change), i.e. coordination/installing of a real update;
 *   - `release(operationId)` when the package change completes/fails/cancels or
 *     the operation terminates, and on Host dispose. Idempotent and scoped to the
 *     owning operation id so a stale release cannot unblock a newer operation.
 *
 * Scope: only the game entry admission path (`entry.launch`, including
 * `resume-paused` launches) is blocked. Discovery/inspect/health/game-list and
 * other read routes stay available while an update is in progress.
 */

import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';

/**
 * @param {{now?: () => Date}} [options]
 */
export function createUpdateAdmissionBarrier({ now = () => new Date() } = {}) {
  /** @type {{operationId:string|null, since:string}|null} */
  let blocked = null;

  /** Block new entries for `operationId` (called before the package change). */
  function block(operationId) {
    const id = typeof operationId === 'string' && operationId.length > 0 ? operationId : null;
    blocked = { operationId: id, since: now().toISOString() };
    return true;
  }

  /**
   * Release the barrier. With an `operationId`, only the owning operation can
   * release it (a late completion must not unblock a newer operation); without
   * one (dispose) the barrier is always cleared.
   *
   * @returns {boolean} true when the barrier is no longer blocking
   */
  function release(operationId) {
    if (blocked === null) return true;
    if (operationId !== undefined && blocked.operationId !== null && blocked.operationId !== operationId) {
      return false;
    }
    blocked = null;
    return true;
  }

  function isBlocked() {
    return blocked !== null;
  }

  function blockedOperationId() {
    return blocked === null ? null : blocked.operationId;
  }

  /** Read-only diagnostic snapshot (no operation ids in public error details). */
  function snapshot() {
    return blocked === null ? null : { blocked: true, operationId: blocked.operationId, since: blocked.since };
  }

  /**
   * Entry admission check used by `entry.launch()`. Fails closed with the
   * documented retryable busy code; the message makes clear this is a platform
   * plugin update, not a game install.
   */
  function assertEntryAllowed() {
    if (blocked === null) return;
    throw hostError(
      GM.INSTALL_IN_PROGRESS,
      'A platform plugin update is in progress; new game launches are temporarily blocked',
      { retryable: true }
    );
  }

  return { block, release, isBlocked, blockedOperationId, snapshot, assertEntryAllowed };
}
