/**
 * Local package selection policy (V1.5-CONTRACTS §1.8).
 *
 * Local install accepts two carriers with different transports:
 *   - `html-v1`        — `<id>-<version>.html`, uploaded as `text/html` text;
 *   - `asset-zip-v2`   — `<id>-<version>.dshgame.zip`, uploaded as raw
 *                        `application/zip` bytes (never text-decoded).
 *
 * The format is decided from the file name first (that is what the Host
 * re-validates) and from the declared MIME type only as a fallback. Pure helpers
 * so the picker policy is unit-testable without a React render.
 */
import { GAME_ID_PATTERN, LIMITS } from '../../shared/src/constants.js';

/** Same 20 MiB ceiling for both carriers (contract §1.8 / §3). */
export const MAX_LOCAL_INSTALL_BYTES = LIMITS.packageBytes || 20 * 1024 * 1024;

/** File picker filter: HTML + ZIP, by extension and MIME. */
export const LOCAL_INSTALL_ACCEPT = '.html,.htm,.dshgame.zip,text/html,application/zip,application/x-zip-compressed';

export const LOCAL_PACKAGE_FORMATS = Object.freeze(['html-v1', 'asset-zip-v2']);

const HTML_EXTENSION_RE = /\.html?$/i;
const ZIP_EXTENSION_RE = /\.dshgame\.zip$/i;
const ZIP_MIME_TYPES = Object.freeze(['application/zip', 'application/x-zip-compressed']);

function mimeOf(value) {
  if (typeof value !== 'string') return '';
  const [mediaType] = value.split(';');
  return mediaType ? mediaType.trim().toLowerCase() : '';
}

/**
 * Decide the package format for a picked local file.
 * @param {{fileName?: string, type?: string}} input
 * @returns {'html-v1'|'asset-zip-v2'|null}
 */
export function detectLocalInstallFormat(input) {
  const source = input && typeof input === 'object' ? input : {};
  const fileName = typeof source.fileName === 'string' ? source.fileName : '';
  const mime = mimeOf(source.type);
  // Extension wins: the Host's filename rule is authoritative, and a browser
  // may report an empty/unknown MIME for a `.dshgame.zip` file.
  if (ZIP_EXTENSION_RE.test(fileName)) return 'asset-zip-v2';
  if (HTML_EXTENSION_RE.test(fileName)) return 'html-v1';
  if (ZIP_MIME_TYPES.includes(mime)) return 'asset-zip-v2';
  if (mime === 'text/html') return 'html-v1';
  return null;
}

/**
 * Parse `<id>-<version>.html` / `<id>-<version>.dshgame.zip` so the confirmation
 * dialog can name the installation record that will be replaced. Returns `null`
 * for arbitrary local file names (the manifest is only read by the Host).
 * @returns {{gameId:string, version:string, format:string}|null}
 */
export function parseLocalPackageFileName(fileName) {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 255) return null;
  const match = /^(.+)-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)\.(html|dshgame\.zip)$/i.exec(
    fileName
  );
  if (!match) return null;
  const gameId = match[1];
  if (!GAME_ID_PATTERN.test(gameId)) return null;
  return {
    gameId,
    version: match[2],
    format: /dshgame\.zip$/i.test(match[3]) ? 'asset-zip-v2' : 'html-v1',
  };
}

/**
 * Validate a picked file before the confirmation dialog.
 * @returns {{ok:true, format:string} | {ok:false, reason:'unsupported'|'tooLarge'}}
 */
export function validateLocalInstallSelection(input) {
  const source = input && typeof input === 'object' ? input : {};
  const format = detectLocalInstallFormat({ fileName: source.fileName, type: source.type });
  if (!format) return { ok: false, reason: 'unsupported' };
  if (typeof source.size === 'number' && Number.isFinite(source.size) && source.size > MAX_LOCAL_INSTALL_BYTES) {
    return { ok: false, reason: 'tooLarge' };
  }
  return { ok: true, format };
}

/**
 * Match a package file name against the currently installed (non-builtin)
 * games, so the confirmation can say which version will be replaced.
 * @returns {{gameId:string, gameName:string, currentVersion:string, version:string}|null}
 */
export function findLocalOverwriteTarget(games, fileName) {
  const parsed = parseLocalPackageFileName(fileName);
  if (!parsed) return null;
  const list = Array.isArray(games) ? games : [];
  for (const game of list) {
    if (!game || game.id !== parsed.gameId) continue;
    if (game.builtin === true) return null;
    if (game.installed === false) return null;
    if (typeof game.version !== 'string' || game.version.length === 0) return null;
    return {
      gameId: parsed.gameId,
      gameName: typeof game.name === 'string' && game.name.length > 0 ? game.name : parsed.gameId,
      currentVersion: game.version,
      version: parsed.version,
    };
  }
  return null;
}
