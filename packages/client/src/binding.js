/**
 * Pure helpers for the DSH Session standard hooks.
 *
 * `useSessions` receives `{ ids, byId }` (see dsh-api-session-controller). The
 * active Conversation is the Session retained by the `mainView` source. When the
 * sidebar/panel is mounted without a mainView retention we keep the previous
 * binding instead of guessing another Session (PRD S-12 degradation).
 */

function rowFor(snapshot, sessionId) {
  if (!snapshot || !snapshot.byId || typeof snapshot.byId !== 'object') return null;
  const row = snapshot.byId[sessionId];
  return row && typeof row === 'object' ? row : null;
}

function listIds(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  if (Array.isArray(snapshot.ids)) return snapshot.ids;
  if (snapshot.byId && typeof snapshot.byId === 'object') return Object.keys(snapshot.byId);
  return [];
}

function mainViewCount(row) {
  if (!row || !row.retainedBy || typeof row.retainedBy !== 'object') return 0;
  const count = row.retainedBy.mainView;
  return typeof count === 'number' && count > 0 ? count : 0;
}

/**
 * Selector for `useSessions`. Prefers the non-blank session retained by the
 * host main view; falls back to a blank selected session (still the current
 * Session), and finally to null so callers can keep their previous binding.
 */
export function selectCurrentSessionId(snapshot) {
  const ids = listIds(snapshot);
  let blankCandidate = null;
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) continue;
    const row = rowFor(snapshot, id);
    if (!row || mainViewCount(row) === 0) continue;
    if (row.blank === true) {
      if (blankCandidate === null) blankCandidate = id;
      continue;
    }
    return id;
  }
  return blankCandidate;
}

/** Selector for `useSessionStatus`: the map is keyed by session id. */
export function selectSessionStatus(statuses, sessionId) {
  if (!statuses || typeof statuses.get !== 'function' || typeof sessionId !== 'string') return null;
  return statuses.get(sessionId) || null;
}

/** Read the fields we use without assuming the whole DSH status shape. */
export function summarizeSessionStatus(status) {
  if (!status || typeof status !== 'object') {
    return { running: false, pendingInteraction: null, completionUnread: false };
  }
  return {
    running: status.running === true,
    pendingInteraction: status.pendingInteraction || null,
    completionUnread: status.completionUnread === true,
  };
}

/** Whether a Session still exists in the list snapshot. */
export function sessionExists(snapshot, sessionId) {
  if (typeof sessionId !== 'string') return false;
  return rowFor(snapshot, sessionId) !== null;
}
