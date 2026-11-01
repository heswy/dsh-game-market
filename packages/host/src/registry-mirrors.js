/**
 * Host-only mirror endpoints for the official catalog indexes.
 *
 * Some networks intermittently block `raw.githubusercontent.com` while leaving
 * GitHub's API and the jsDelivr CDN reachable. These live here (not in
 * `shared/src/constants.js`) so the SDK and every game bundle do not grow bytes
 * for host-only fallback data.
 *
 * jsDelivr serves a repository file from `gh/<owner>/<repo>@<ref>/<path>`; the
 * GitHub contents API returns the raw file when asked for
 * `application/vnd.github.raw`.
 */
export const DEFAULT_OFFICIAL_REGISTRY_V2_FALLBACK_URLS = Object.freeze([
  'https://cdn.jsdelivr.net/gh/heswy/dsh-game-registry@main/registry/v2/games.json',
  'https://api.github.com/repos/heswy/dsh-game-registry/contents/registry/v2/games.json?ref=main',
]);

export const DEFAULT_OFFICIAL_REGISTRY_FALLBACK_URLS = Object.freeze([
  'https://cdn.jsdelivr.net/gh/heswy/dsh-game-registry@main/registry/games.json',
  'https://api.github.com/repos/heswy/dsh-game-registry/contents/registry/games.json?ref=main',
]);
