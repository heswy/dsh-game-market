/**
 * Module-level registry of the Runtime controller instances active in this
 * browser window (V1.5 M3 coordination support).
 *
 * The `main` slot is keyed: a playing game lives in the Runtime page, while the
 * update UI lives in the Market page. When the Host enters the coordination
 * phase, the coordinator must pause and save *every* running instance in this
 * window — which is only possible through the live Runtime controllers, not
 * through store state. RuntimeView registers its controller here and removes it
 * on teardown so the registry never outlives an iframe.
 */

const instances = new Map();

/**
 * Register one active Runtime instance.
 * @param {{instanceId: string, gameId: string, controller: object}} entry
 * @returns {Function} unregister (idempotent)
 */
export function registerRuntimeInstance(entry) {
  if (!entry || typeof entry !== 'object') return function noop() {};
  const instanceId = typeof entry.instanceId === 'string' ? entry.instanceId : '';
  const gameId = typeof entry.gameId === 'string' ? entry.gameId : '';
  if (instanceId.length === 0 || gameId.length === 0) return function noop() {};
  // Never let a stale controller replace a live one for the same instance id.
  const existing = instances.get(instanceId);
  if (existing && existing.controller !== entry.controller) return function noop() {};
  instances.set(
    instanceId,
    Object.freeze({ instanceId: instanceId, gameId: gameId, controller: entry.controller || null })
  );
  return function unregister() {
    const current = instances.get(instanceId);
    if (current && current.controller === (entry.controller || null)) instances.delete(instanceId);
  };
}

/** Remove one instance (no-op when it is already gone). */
export function unregisterRuntimeInstance(instanceId) {
  if (typeof instanceId !== 'string') return false;
  return instances.delete(instanceId);
}

/** Active instances in this window, in registration order. */
export function listRuntimeInstances() {
  return Array.from(instances.values());
}

/** Number of active instances (idle-window reporting). */
export function runtimeInstanceCount() {
  return instances.size;
}

/** Test seam: drop every registration. */
export function clearRuntimeInstances() {
  instances.clear();
}
