/**
 * Host half of the S-B1 brand probe.
 *
 * Deliberately inert: the probe only needs a Loader row so that the host scans
 * this package's `dsh.client` declaration, composes its browser bundle into the
 * boot graph, and the page materializes `client.js`. Registering nothing keeps
 * the probe independent of any real Game Market behavior.
 */

/** No host-side services are required or provided. */
export const inject = [];

/** Host plugin body — contributes browser presentation only. */
export function apply() {}
