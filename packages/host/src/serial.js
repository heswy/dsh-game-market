/**
 * Tiny in-process keyed serialiser for read-modify-write service operations.
 *
 * `HostStorage` already serialises atomic file writes; this layer additionally
 * prevents two requests from reading the same revision before either writes
 * (save CAS, session start adoption, score history, preferences merge).
 */

export function createKeyedSerialiser() {
  const chains = new Map();
  return function serialise(key, task) {
    const previous = chains.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    chains.set(key, current);
    const cleanup = () => {
      if (chains.get(key) === current) chains.delete(key);
    };
    current.then(cleanup, cleanup);
    return current;
  };
}
