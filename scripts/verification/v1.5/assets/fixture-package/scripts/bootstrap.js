/**
 * Classic-script probe: proves an independent non-module JS file executes in
 * the opaque-origin sandbox. Classic scripts are no-cors requests, so this
 * works even without CORS headers; a CSP `script-src` entry is still required.
 */
(() => {
  const params = new URLSearchParams(location.search);
  window.__PROBE_CLASSIC__ = {
    ok: true,
    ranAt: Date.now(),
    urlOrigin: location.origin,
    documentOrigin: window.origin,
    // Never keep the one-shot launch credential in evidence.
    path: location.pathname.replace(/[^/]+$/, '<file>'),
    variant: params.get('variant') || 'none',
  };
})();
