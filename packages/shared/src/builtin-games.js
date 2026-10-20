/**
 * Built-in game catalog (V0/V1 snake + V1.5 M2 orbit-courier).
 *
 * Kept OUT of `constants.js` on purpose: the SDK bundles `constants.js` into
 * every single-file game package, so declaring the platform's built-in catalog
 * there would inline it into every distributed package — bloating them and
 * making all package bytes change whenever a built-in is added. The Host is the
 * only consumer.
 *
 * Paths are relative to the bundle root.
 */

/** V0/V1 built-in games. Paths are relative to the bundle root. */
export const BUILTIN_GAMES = Object.freeze([
  Object.freeze({
    id: 'snake',
    name: 'Snake',
    version: '1.0.0',
    dir: 'games/snake',
    manifestFile: 'game.json',
    entryFile: 'dist/index.html',
    viewport: Object.freeze({ width: 960, height: 540, fit: 'contain' }),
  }),
  /**
   * M2: first built-in `asset-zip-v2` resource package (docs/V1.5-CONTRACTS §7).
   *
   * `snake` keeps the V1 `html-v1` single-file layout above; this entry adds the
   * optional `format` / `packageDir` fields so the Host can validate a built-in
   * with the *same* descriptor + file-manifest rules as an installed ZIP package
   * instead of inventing a second serving path. `dist/` is the already-extracted
   * package directory (`dsh-package.json` + `game.json` + resources).
   */
  Object.freeze({
    id: 'orbit-courier',
    name: '轨道信使',
    version: '1.0.0',
    dir: 'games/orbit-courier',
    manifestFile: 'game.json',
    entryFile: 'dist/index.html',
    format: 'asset-zip-v2',
    packageDir: 'dist',
    viewport: Object.freeze({ width: 720, height: 1280, fit: 'contain' }),
  }),
]);
