/**
 * Verified author-asset download + package/media checks for the publishing tool.
 * Reuses the Host's bounded downloader and the shared package validators.
 */
import { createHash } from 'node:crypto';

import { validatePackageHtml } from '../../../packages/shared/src/manifest.js';
import { validatePackageUrl } from '../../../packages/shared/src/registry.js';
import { checkCompatibility } from '../../../packages/host/src/semver.js';
import { fetchBytes } from '../../../packages/host/src/download.js';
import { sniffImageType } from '../../../packages/host/src/registry.js';

const DEFAULT_HTTP = Object.freeze({
  connectMs: 15000,
  idleMs: 30000,
  totalMs: 180000,
  retries: 1,
  maxRedirects: 5,
});

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function downloadOptions(http) {
  const options = { ...DEFAULT_HTTP, ...(http || {}) };
  return {
    fetchImpl: options.fetch,
    sleep: options.sleep,
    resolveHost: options.resolveHost,
    devMode: options.devMode === true,
    retries: Number.isInteger(options.retries) ? options.retries : DEFAULT_HTTP.retries,
    retryDelaysMs: options.retryDelaysMs,
    connectMs: options.connectMs || DEFAULT_HTTP.connectMs,
    idleMs: options.idleMs || DEFAULT_HTTP.idleMs,
    totalMs: options.totalMs || DEFAULT_HTTP.totalMs,
    maxRedirects: options.maxRedirects || DEFAULT_HTTP.maxRedirects,
    maxBytes: options.maxBytes,
    errorCodes: {
      rejected: 'E_PUBLISH_URL_REJECTED',
      fetch: 'E_PUBLISH_DOWNLOAD_FAILED',
      timeout: 'E_PUBLISH_DOWNLOAD_TIMEOUT',
      tooLarge: 'E_PUBLISH_TOO_LARGE',
    },
  };
}

function publishError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

/** Download one URL and verify its exact bytes/sha256 (and optional max size). */
export async function downloadVerified(url, expected, http = {}, label = 'asset') {
  const options = downloadOptions(http);
  if (options.maxBytes === undefined) options.maxBytes = 20 * 1024 * 1024 + 1;
  let response;
  try {
    response = await fetchBytes(url, options);
  } catch (error) {
    if (error && error.name === 'HostError') {
      throw publishError('E_PUBLISH_DOWNLOAD_FAILED', `${label} download failed (${error.code || 'unknown'})`);
    }
    throw publishError('E_PUBLISH_DOWNLOAD_FAILED', `${label} download failed`);
  }
  const bytes = Buffer.from(response.bytes || new Uint8Array(0));
  const digest = sha256(bytes);
  if (!Number.isSafeInteger(expected.size) || bytes.length !== expected.size) {
    throw publishError('E_PUBLISH_SIZE_MISMATCH', `${label} size mismatch: expected ${expected.size}, got ${bytes.length}`);
  }
  if (typeof expected.sha256 === 'string' && digest !== expected.sha256) {
    throw publishError('E_PUBLISH_SHA_MISMATCH', `${label} sha256 mismatch`);
  }
  return { bytes, sha256: digest, size: bytes.length, finalUrl: response.url };
}

function imageDimensions(type, bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  try {
    if (type === 'png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (type === 'jpeg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
    if (type === 'webp' && buffer.length >= 30) {
      const chunk = buffer.toString('ascii', 12, 16);
      if (chunk === 'VP8X') {
        return {
          width: 1 + buffer.readUIntLE(24, 3),
          height: 1 + buffer.readUIntLE(27, 3),
        };
      }
    }
  } catch (_error) {
    return null;
  }
  return null;
}

export function validatePackageBytes({ bytes, manifest, id, version }) {
  let html;
  try {
    html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (_error) {
    throw publishError('E_PUBLISH_PACKAGE_UTF8', 'package is not valid UTF-8 HTML; Host install would reject it');
  }
  const validation = validatePackageHtml(html, { packageBytes: 20 * 1024 * 1024 });
  if (!validation.ok || !validation.manifest) {
    throw publishError('E_PUBLISH_PACKAGE_INVALID', 'package failed the shared validator', validation.errors.slice(0, 8));
  }
  const built = validation.manifest;
  if (built.id !== id || built.version !== version) {
    throw publishError('E_PUBLISH_MANIFEST_MISMATCH', 'package manifest id/version does not match the submission', { expected: `${id}@${version}`, actual: `${built.id}@${built.version}` });
  }
  try {
    checkCompatibility(built);
  } catch (error) {
    throw publishError('E_PUBLISH_INCOMPATIBLE', 'package is not compatible with this Runtime', {
      code: error && error.code ? error.code : null,
      reason: error && error.message ? error.message : 'incompatible',
    });
  }
  return built;
}

export function validateMediaBytes({ bytes, media, label }) {
  const sniffed = sniffImageType(bytes);
  if (sniffed === null) throw publishError('E_PUBLISH_MEDIA_INVALID', `${label} is not a PNG/WebP/JPEG image`);
  if (sniffed !== media.type) {
    throw publishError('E_PUBLISH_MEDIA_TYPE', `${label} sniffed type ${sniffed} does not match declared ${media.type}`);
  }
  const dimensions = imageDimensions(sniffed === 'jpeg' ? 'jpeg' : sniffed, bytes);
  if (dimensions && (dimensions.width < 1 || dimensions.height < 1)) {
    throw publishError('E_PUBLISH_MEDIA_INVALID', `${label} has invalid dimensions`);
  }
  return { type: sniffed, extension: sniffed === 'jpeg' ? 'jpg' : sniffed, dimensions };
}

/** Verify the author's `.sha256` file content matches the approved package digest. */
export async function downloadShaFile(url, expectedSha, http = {}) {
  const options = downloadOptions(http);
  options.maxBytes = 4096;
  let response;
  try {
    response = await fetchBytes(url, options);
  } catch (_error) {
    throw publishError('E_PUBLISH_SHA_FILE', 'package .sha256 URL is not reachable');
  }
  const text = Buffer.from(response.bytes || new Uint8Array(0)).toString('utf8').trim();
  const match = text.match(/^([a-f0-9]{64})(?:\s+|$)/);
  if (!match || match[1] !== expectedSha) {
    throw publishError('E_PUBLISH_SHA_FILE', 'package .sha256 file does not match the declared digest');
  }
  return match[1];
}

export function extensionForType(type) {
  return type === 'jpeg' ? 'jpg' : type;
}

/** Validate a package URL against the official https Registry source. */
export function validateAuthorPackageUrl(url, { id, version }) {
  const result = validatePackageUrl(url, {
    id,
    version,
    sourceType: 'https',
    sourceUrl: 'https://raw.githubusercontent.com/heswy/dsh-game-registry/main/registry/games.json',
  });
  if (!result.ok) throw publishError('E_PUBLISH_URL_REJECTED', result.message);
  return result.url;
}

export { imageDimensions };
