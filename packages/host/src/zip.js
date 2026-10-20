/**
 * `asset-zip-v2` archive reader + policy layer
 * (docs/V1.5-CONTRACTS.md §1.3–§1.5, §2, §3, §4).
 *
 * This is the ONLY module in the repository allowed to import `yauzl`
 * (contract §2.3 item 4). Everything byte-level lives here: EOCD/central-
 * directory parsing, streaming extraction with measured counters, CRC-32,
 * local-file-header vs central-directory comparison and nested-archive magic
 * detection. Pure policy (paths, descriptor schema, manifest comparison,
 * content patterns) is imported from `packages/shared/src/package-v2.js` so the
 * Host, CLI and tests share one rule set (contract §0.3).
 *
 * Safety model (contract §2.3 item 5):
 *   - `yauzl.open(path, { lazyEntries: true, decodeStrings: false,
 *     validateEntrySizes: true, autoClose: true })`;
 *   - pass 1 reads the central directory, applies every path/type/size rule and
 *     buffers ONLY the descriptor (≤ 256 KiB) — no files are created;
 *   - pass 2 re-opens the archive, compares each local header with its central
 *     directory record and streams each entry to `outDir` in 64 KiB chunks,
 *     measuring bytes/CRC/sha256 instead of trusting the central directory;
 *   - the output directory is removed on any failure, so a rejected archive
 *     never leaves a version directory behind (§6.3 failure semantics);
 *   - no system `unzip`/`tar` is ever invoked and no package content is
 *     executed (§2.3 item 5).
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import yauzl from 'yauzl';

import {
  DESCRIPTOR_FILE,
  LIMITS,
  TIMING,
  ZIP_GAME_MANIFEST_FILE,
} from '../../shared/src/constants.js';
import { GM, gmForInternal } from '../../shared/src/errors.js';
import { validateManifest } from '../../shared/src/manifest.js';
import {
  checkCssContent,
  checkHtmlContent,
  checkManifestConflict,
  checkPathConflicts,
  checkReservedNames,
  checkZipEntryPath,
  fileManifestDigest,
  normalizeZipPath,
  validateDescriptor,
} from '../../shared/src/package-v2.js';
import { hostError } from './errors.js';
import { sha256Hex } from './ids.js';

const ZIP_LIMITS = LIMITS.zip;
const CHUNK_BYTES = Number.isSafeInteger(ZIP_LIMITS.zipChunkBytes) && ZIP_LIMITS.zipChunkBytes > 0
  ? ZIP_LIMITS.zipChunkBytes
  : 64 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const MAX_COMMENT_BYTES = 0xffff;
const EOCD_MIN_BYTES = 22;
/** Local header GP flag bit 3: sizes/CRC live in a trailing data descriptor. */
const GP_BIT_DATA_DESCRIPTOR = 0x0008;
/**
 * General-purpose bits we accept: bits 1/2 (compression options),
 * bit 3 (data descriptor) and bit 11 (UTF-8 file name). Everything else —
 * encryption (0/6), enhanced deflate (4), patched data (5), masked headers
 * (13) and the reserved high bits — is an unsupported feature (§3, §4.4).
 */
const GP_ALLOWED_MASK = 0x0008 | 0x0006 | 0x0800;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const ZIP64_VERSION_NEEDED = 45;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

/** Unix file-type bits (high 16 bits of `externalFileAttributes`). */
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
const S_IFCHR = 0o020000;
const S_IFBLK = 0o060000;
const S_IFIFO = 0o010000;
const S_IFSOCK = 0o140000;

/** Extensions that mark a nested archive by name; rejected (§4.4). */
const NESTED_ARCHIVE_EXTENSIONS = Object.freeze([
  '.zip',
  '.gz',
  '.tgz',
  '.tar',
  '.7z',
  '.rar',
  '.bz2',
  '.xz',
  '.zst',
]);

/** Signatures that mark a nested archive by content; rejected (§4.4). */
const NESTED_ARCHIVE_MAGICS = Object.freeze([
  { label: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { label: 'zip-empty', bytes: [0x50, 0x4b, 0x05, 0x06] },
  { label: 'zip-spanned', bytes: [0x50, 0x4b, 0x07, 0x08] },
  { label: 'gzip', bytes: [0x1f, 0x8b] },
  { label: 'bzip2', bytes: [0x42, 0x5a, 0x68] },
  { label: '7z', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { label: 'rar', bytes: [0x52, 0x61, 0x72, 0x21] },
  { label: 'xz', bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  { label: 'zstd', bytes: [0x28, 0xb5, 0x2f, 0xfd] },
]);

/**
 * JavaScript constructs that are never acceptable in a package script
 * (contract §4.6/§4.7: no remote/absolute/data fetch, no eval/new Function,
 * no serviceWorker/window.open). Package-relative `fetch('./x')`,
 * `import('./x')` and `XMLHttpRequest` stay allowed (Q-6).
 */
const SCRIPT_FORBIDDEN = Object.freeze([
  { rule: 'eval', pattern: /\beval\s*\(/ },
  { rule: 'new-function', pattern: /\bnew\s+Function\s*\(/ },
  { rule: 'service-worker', pattern: /\bserviceWorker\b/ },
  { rule: 'window-open', pattern: /\bwindow\s*\.\s*open\s*\(/ },
  { rule: 'remote-fetch', pattern: /\bfetch\s*\(\s*["'`]\s*(?:https?:)?\/\// },
  { rule: 'absolute-fetch', pattern: /\bfetch\s*\(\s*["'`]\s*\// },
  { rule: 'data-fetch', pattern: /\bfetch\s*\(\s*["'`]\s*data:/ },
  { rule: 'remote-import', pattern: /\bimport\s*\(\s*["'`]\s*(?:https?:)?\/\// },
  { rule: 'absolute-import', pattern: /\bimport\s*\(\s*["'`]\s*\// },
]);

/** Absolute markup references are a creator-time rule (§4.7), not a security proof. */
const HTML_ABSOLUTE_REFERENCE = /\b(?:src|href)\s*=\s*["']?\s*\/(?!\/)/i;
/** Absolute CSS `url()` references a path outside the package (§4.6). */
const CSS_ABSOLUTE_URL = /url\(\s*["']?\s*\/(?!\/)/i;
/** Inline SVG active content is rejected as defence in depth (§4.6 image rules). */
const SVG_FORBIDDEN = Object.freeze([
  { rule: 'inline-script', pattern: /<\s*script\b/i },
  { rule: 'javascript-url', pattern: /\bjavascript\s*:/i },
  { rule: 'inline-handler', pattern: /\son[a-z]+\s*=/i },
]);

// ---------------------------------------------------------------------------
// CRC-32
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** `node:zlib.crc32` exists from Node 22.2 / 20.15; older runtimes use the table. */
const NATIVE_CRC32 = typeof zlib.crc32 === 'function' ? zlib.crc32 : null;

function tableCrc32(state, chunk) {
  let crc = (state ^ 0xffffffff) >>> 0;
  for (let index = 0; index < chunk.length; index += 1) {
    crc = (CRC_TABLE[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Continue a CRC-32/ISO-HDLC computation.
 * @param {number} state Previous return value (0 for a fresh stream).
 * @param {Uint8Array} chunk Next bytes.
 * @returns {number}
 */
export function crc32Update(state, chunk) {
  const seed = Number.isInteger(state) ? state >>> 0 : 0;
  const bytes = chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk || []);
  return NATIVE_CRC32 ? NATIVE_CRC32(bytes, seed) >>> 0 : tableCrc32(seed, bytes);
}

/**
 * CRC-32 of a complete buffer. Self-test vector:
 * `crc32Of(Buffer.from('123456789')) === 0xCBF43926` (contract §4.5 item 4).
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32Of(bytes) {
  return crc32Update(0, bytes);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const ZIP_ERROR_MESSAGES = Object.freeze({
  [GM.ZIP_INVALID]: 'Package archive is not a valid ZIP',
  [GM.ZIP_UNSUPPORTED]: 'Package archive uses an unsupported ZIP feature',
  [GM.ZIP_LIMIT]: 'Package archive exceeds an extraction limit',
  [GM.ZIP_PATH_INVALID]: 'Package archive contains an invalid path',
  [GM.ZIP_PATH_CONFLICT]: 'Package archive contains conflicting paths',
  [GM.ZIP_HEADER_MISMATCH]: 'Package archive headers are inconsistent',
  [GM.ZIP_CRC_MISMATCH]: 'Package archive entry failed its CRC check',
  [GM.DESCRIPTOR_INVALID]: 'Package descriptor is missing or invalid',
  [GM.DESCRIPTOR_MISMATCH]: 'Package file manifest does not match the archive',
  [GM.MANIFEST_CONFLICT]: 'Package declares more than one authoritative manifest',
  [GM.ASSET_TYPE_UNSUPPORTED]: 'Package contains an unsupported or unsafe asset',
  [GM.ASSET_INLINE_FORBIDDEN]: 'Resource packages cannot use inline scripts, styles, handlers or javascript: URLs',
});

function zipError(code, message) {
  const gm = ZIP_ERROR_MESSAGES[code] ? code : GM.ZIP_INVALID;
  return hostError(gm, message || ZIP_ERROR_MESSAGES[gm], { retryable: false });
}

/** Limit errors carry ONLY `{limit, actual, kind}` (contract §3 rule 2). */
function limitError(kind, limit, actual) {
  return hostError(GM.ZIP_LIMIT, `Package archive exceeds the ${kind} limit`, {
    retryable: false,
    details: { limit, actual, kind },
  });
}

/** Paths in `details` must be sanitized relative paths without host paths (§8.4). */
function sanitizePath(value) {
  if (typeof value !== 'string') return undefined;
  const printable = value.replace(/[\u0000-\u001f\u007f]/g, '?');
  return printable.length > 120 ? `${printable.slice(0, 120)}…` : printable;
}

/**
 * Attach the shared policy layer's `E_*` failure to the matching public `GM-*`
 * code, keeping `details` within the §8.4 allowlist.
 * @param {{code:string, details?:object}} failure
 * @param {string} fallback
 * @returns {import('./errors.js').HostError}
 */
function policyError(failure, fallback = GM.ZIP_INVALID) {
  const mapped = gmForInternal(failure?.code);
  const gm = mapped === GM.INTERNAL ? fallback : mapped;
  const source = failure?.details || {};
  let details;
  if (gm === GM.ZIP_LIMIT) {
    if (Number.isFinite(source.limit) && Number.isFinite(source.actual)) {
      details = { limit: source.limit, actual: source.actual, kind: String(source.kind || 'limit') };
    }
  } else if (gm === GM.ZIP_PATH_INVALID || gm === GM.ZIP_PATH_CONFLICT || gm === GM.DESCRIPTOR_MISMATCH
    || gm === GM.ASSET_TYPE_UNSUPPORTED) {
    const sanitized = sanitizePath(source.path);
    if (sanitized !== undefined) details = { path: sanitized };
  } else if (gm === GM.DESCRIPTOR_INVALID && typeof source.field === 'string') {
    details = { field: source.field };
  }
  return hostError(gm, ZIP_ERROR_MESSAGES[gm], {
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
}

function ensure(condition, code, message) {
  if (condition) return;
  throw zipError(code, message);
}

/**
 * Map a raw yauzl/Node error to a public archive error.
 * @param {unknown} error
 * @returns {import('./errors.js').HostError}
 */
function mapArchiveError(error) {
  if (error && error.name === 'HostError') return error;
  const message = String(error?.message || '');
  if (/multi-disk/i.test(message)) return zipError(GM.ZIP_UNSUPPORTED, 'Multi-disk archives are not supported');
  if (/strong encryption/i.test(message)) return zipError(GM.ZIP_UNSUPPORTED, 'Encrypted archives are not supported');
  if (/zip64/i.test(message)) return zipError(GM.ZIP_UNSUPPORTED, 'ZIP64 archives are not supported');
  if (/invalid local file header signature/i.test(message)) {
    return zipError(GM.ZIP_HEADER_MISMATCH, 'Local file header signature does not match the central directory');
  }
  if (error && (error.code === 'Z_BUF_ERROR' || error.code === 'Z_DATA_ERROR' || error.code === 'Z_NEED_DICT')) {
    return zipError(GM.ZIP_HEADER_MISMATCH, 'Archive entry compression data is incomplete or corrupt');
  }
  if (/compressed\/uncompressed size mismatch/i.test(message)) {
    return zipError(GM.ZIP_HEADER_MISMATCH, 'Central directory sizes are inconsistent');
  }
  if (/too many bytes|not enough bytes|unexpected end of file|end of central directory/i.test(message)) {
    return zipError(GM.ZIP_HEADER_MISMATCH, 'Archive entry sizes do not match the central directory');
  }
  if (/invalid central directory file header signature|end of central directory record/i.test(message)) {
    return zipError(GM.ZIP_INVALID, 'Archive central directory is malformed');
  }
  if (/invalid characters in fileName|absolute path|invalid relative path|fileName is directory/i.test(message)) {
    return zipError(GM.ZIP_PATH_INVALID, 'Archive contains an invalid entry path');
  }
  return zipError(GM.ZIP_INVALID, 'Package archive could not be read');
}

// ---------------------------------------------------------------------------
// Container pre-scan: outer size, magic and EOCD (§4.1 steps 1–2)
// ---------------------------------------------------------------------------

/**
 * Validate the ZIP magic of a staged outer archive (contract §1.1 step 4).
 * A non-empty ZIP starts with `PK\x03\x04`; an empty ZIP is also accepted here
 * (it will fail later for a missing descriptor with GM-4277).
 * @param {string} zipPath Absolute path to the staged ZIP.
 */
export async function assertZipMagic(zipPath) {
  let handle;
  try {
    handle = await fs.open(zipPath, 'r');
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    if (bytesRead < 4) throw zipError(GM.ZIP_INVALID, 'Package archive is empty');
    const signature = header.readUInt32LE(0);
    if (signature !== 0x04034b50 && signature !== EOCD_SIGNATURE) {
      throw zipError(GM.ZIP_INVALID, 'Package archive does not start with a ZIP signature');
    }
  } catch (error) {
    if (error && error.name === 'HostError') throw error;
    if (error && error.code === 'ENOENT') throw zipError(GM.ZIP_INVALID, 'Package archive could not be read');
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
      throw hostError(GM.INSTALL_IO, 'Package archive could not be read', { retryable: true });
    }
    throw zipError(GM.ZIP_INVALID, 'Package archive could not be read');
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

/**
 * Parse the end-of-central-directory record ourselves so ZIP64 sentinels,
 * multi-disk fields and the central-directory bounds are rejected explicitly
 * (yauzl supports ZIP64, so it cannot be used for this decision — §4.4).
 * @param {string} zipPath
 * @param {number} fileSize
 * @returns {Promise<{entries:number, centralSize:number, centralOffset:number, commentBytes:number}>}
 */
async function readEndOfCentralDirectory(zipPath, fileSize) {
  if (fileSize < EOCD_MIN_BYTES) throw zipError(GM.ZIP_INVALID, 'Package archive is too small');
  if (fileSize > ZIP_LIMITS.zipOuterBytes) {
    throw limitError('zipOuterBytes', ZIP_LIMITS.zipOuterBytes, fileSize);
  }
  const tailLength = Math.min(fileSize, EOCD_MIN_BYTES + MAX_COMMENT_BYTES);
  const tailStart = fileSize - tailLength;
  let handle;
  try {
    handle = await fs.open(zipPath, 'r');
    const tail = Buffer.alloc(tailLength);
    const { bytesRead } = await handle.read(tail, 0, tailLength, tailStart);
    if (bytesRead !== tailLength) throw zipError(GM.ZIP_INVALID, 'Package archive could not be read');

    let eocdAt = -1;
    for (let offset = tail.length - EOCD_MIN_BYTES; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
      const commentBytes = tail.readUInt16LE(offset + 20);
      if (offset + EOCD_MIN_BYTES + commentBytes === tail.length) {
        eocdAt = offset;
        break;
      }
    }
    if (eocdAt === -1) throw zipError(GM.ZIP_INVALID, 'End of central directory record was not found');

    const diskNumber = tail.readUInt16LE(eocdAt + 4);
    const centralDisk = tail.readUInt16LE(eocdAt + 6);
    const entriesOnDisk = tail.readUInt16LE(eocdAt + 8);
    const entriesTotal = tail.readUInt16LE(eocdAt + 10);
    const centralSize = tail.readUInt32LE(eocdAt + 12);
    const centralOffset = tail.readUInt32LE(eocdAt + 16);
    const commentBytes = tail.readUInt16LE(eocdAt + 20);
    const eocdOffset = tailStart + eocdAt;

    // ZIP64 sentinels (§4.4): yauzl would happily follow the ZIP64 records.
    if (
      diskNumber === UINT16_MAX
      || centralDisk === UINT16_MAX
      || entriesOnDisk === UINT16_MAX
      || entriesTotal === UINT16_MAX
      || centralSize === UINT32_MAX
      || centralOffset === UINT32_MAX
    ) {
      throw zipError(GM.ZIP_UNSUPPORTED, 'ZIP64 archives are not supported');
    }
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entriesTotal) {
      throw zipError(GM.ZIP_UNSUPPORTED, 'Multi-disk archives are not supported');
    }
    if (commentBytes > MAX_COMMENT_BYTES) throw zipError(GM.ZIP_INVALID, 'Invalid EOCD comment length');
    if (centralOffset + centralSize > eocdOffset) {
      throw zipError(GM.ZIP_INVALID, 'Central directory points outside the archive');
    }
    if (centralSize < 0 || centralOffset < 0) throw zipError(GM.ZIP_INVALID, 'Central directory bounds are invalid');
    if (entriesTotal > ZIP_LIMITS.zipEntries) {
      throw limitError('zipEntries', ZIP_LIMITS.zipEntries, entriesTotal);
    }
    return { entries: entriesTotal, centralSize, centralOffset, commentBytes };
  } catch (error) {
    if (error && error.name === 'HostError') throw error;
    if (error && error.code === 'ENOENT') throw zipError(GM.ZIP_INVALID, 'Package archive could not be read');
    throw zipError(GM.ZIP_INVALID, 'Package archive could not be read');
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// yauzl wrappers (§2.3 item 5) — the only place yauzl is used
// ---------------------------------------------------------------------------

/** Open with the frozen option set; `decodeStrings:false` keeps raw name bytes. */
function openArchive(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, decodeStrings: false, validateEntrySizes: true, autoClose: true },
      (error, archive) => {
        if (error) {
          reject(mapArchiveError(error));
          return;
        }
        // Same reasoning as openReadStream: a late close/read error must never
        // become an unhandled `'error'` event. forEachEntry adds its own
        // listener on top and still rejects.
        archive.on('error', () => {});
        resolve(archive);
      }
    );
  });
}

/**
 * Drive a lazy archive entry-by-entry, awaiting the handler before requesting
 * the next record. yauzl requires reading the next entry only after the current
 * stream has been consumed when `autoClose:true` is in effect.
 */
function forEachEntry(archive, handler) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      archive.removeListener('entry', onEntry);
      archive.removeListener('end', onEnd);
      archive.removeListener('error', onError);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        try {
          archive.close();
        } catch (_error) {
          // Already closed by autoClose.
        }
        reject(mapArchiveError(error));
      } else {
        resolve();
      }
    };
    const onEntry = (entry) => {
      Promise.resolve()
        .then(() => handler(entry))
        .then(() => {
          if (!settled) archive.readEntry();
        })
        .catch(finish);
    };
    const onEnd = () => finish();
    const onError = (error) => finish(error);
    archive.on('entry', onEntry);
    archive.on('end', onEnd);
    archive.on('error', onError);
    archive.readEntry();
  });
}

/**
 * Open an entry as a *pull* stream whose failure state is captured from the
 * moment the handle exists.
 *
 * Why not `for await (const chunk of stream)` directly: yauzl forwards inflate
 * errors to the client stream with `setImmediate`, but the async iterator only
 * attaches its listeners when the consumer calls `next()`. Under load a zlib
 * error (e.g. `Z_BUF_ERROR: unexpected end of file` from a deliberately
 * truncated Deflate entry) can be emitted in that window; the error event is
 * then lost/garbled — the iterator never settles and, without a listener, the
 * process sees an unhandled `'error'`. Both outcomes violate the requirement
 * that every hostile archive ends in a controlled `GM-*` error.
 *
 * The state object below listens to `error`/`end`/`close`/`readable`
 * synchronously in the `openReadStream` callback, so no event can be missed,
 * and {@link streamChunks} turns it into an async generator with `GM-*` errors.
 *
 * @returns {Promise<{stream:object, failure:Error|null, ended:boolean, closed:boolean, wake:(()=>void)|null}>}
 */
function openReadStream(archive, entry) {
  return new Promise((resolve, reject) => {
    archive.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(mapArchiveError(error));
        return;
      }
      const state = { stream, failure: null, ended: false, closed: false, wake: null };
      const notify = () => {
        const wake = state.wake;
        state.wake = null;
        if (wake) wake();
      };
      stream.on('error', (streamError) => {
        if (state.failure === null) state.failure = streamError;
        notify();
      });
      stream.on('end', () => {
        state.ended = true;
        notify();
      });
      stream.on('close', () => {
        state.closed = true;
        notify();
      });
      stream.on('readable', notify);
      stream.pause();
      resolve(state);
    });
  });
}

/** Async chunk generator over an {@link openReadStream} state. */
async function* streamChunks(state) {
  for (;;) {
    if (state.failure !== null) throw mapArchiveError(state.failure);
    const chunk = state.stream.read();
    if (chunk !== null) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      continue;
    }
    if (state.ended) return;
    if (state.closed) {
      throw zipError(GM.ZIP_HEADER_MISMATCH, 'Archive entry stream closed before it ended');
    }
    await new Promise((iterate) => {
      state.wake = iterate;
    });
  }
}

/** Destroy a stream state opened by {@link openReadStream}. */
async function abortStreamState(state) {
  if (!state || !state.stream) return;
  try {
    if (typeof state.stream.destroy === 'function') state.stream.destroy();
    else if (typeof state.stream.cancel === 'function') await state.stream.cancel();
  } catch (_error) {
    // Best effort; the archive is closed in the caller's finally block.
  }
}

function readLocalFileHeader(archive, entry) {
  return new Promise((resolve, reject) => {
    archive.readLocalFileHeader(entry, {}, (error, header) => {
      if (error) reject(mapArchiveError(error));
      else resolve(header);
    });
  });
}

// ---------------------------------------------------------------------------
// Central-directory entry policy (§4.1 steps 3–4)
// ---------------------------------------------------------------------------

function nestedArchiveExtension(lowerPath) {
  return NESTED_ARCHIVE_EXTENSIONS.some((extension) => lowerPath.endsWith(extension));
}

function archiveMagicOf(chunk) {
  if (!chunk || chunk.length === 0) return null;
  for (const magic of NESTED_ARCHIVE_MAGICS) {
    if (chunk.length < magic.bytes.length) continue;
    let matches = true;
    for (let index = 0; index < magic.bytes.length; index += 1) {
      if (chunk[index] !== magic.bytes[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return magic.label;
  }
  return null;
}

/**
 * Validate one central-directory record and normalize its path.
 * @param {import('yauzl').Entry} entry
 * @param {number} index
 * @returns {{path:string, index:number, kind:string, entry:object, size:number, compressedSize:number}}
 */
function inspectEntry(entry, index) {
  const flag = entry.generalPurposeBitFlag >>> 0;

  // ZIP64 (§4.4): yauzl supports it, we must not.
  if (entry.versionNeededToExtract >= ZIP64_VERSION_NEEDED) {
    throw zipError(GM.ZIP_UNSUPPORTED, 'ZIP64 archives are not supported');
  }
  if (Array.isArray(entry.extraFields) && entry.extraFields.some((field) => field && field.id === ZIP64_EXTRA_FIELD_ID)) {
    throw zipError(GM.ZIP_UNSUPPORTED, 'ZIP64 archives are not supported');
  }
  if (
    (entry.compressedSize >>> 0) === UINT32_MAX
    || (entry.uncompressedSize >>> 0) === UINT32_MAX
    || (entry.relativeOffsetOfLocalHeader >>> 0) === UINT32_MAX
  ) {
    throw zipError(GM.ZIP_UNSUPPORTED, 'ZIP64 archives are not supported');
  }

  // Encryption: traditional (bit 0) and strong (bit 6) are both rejected before
  // any stream is opened (§4.4); never attempt decryption.
  if ((flag & 0x0001) !== 0 || (flag & 0x0040) !== 0) {
    throw zipError(GM.ZIP_UNSUPPORTED, 'Encrypted archives are not supported');
  }
  if ((flag & ~GP_ALLOWED_MASK) !== 0) {
    throw zipError(GM.ZIP_UNSUPPORTED, 'Archive entry uses an unsupported feature flag');
  }

  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw zipError(GM.ZIP_UNSUPPORTED, 'Only Stored and Deflate entries are supported');
  }

  const compressedSize = entry.compressedSize >>> 0;
  const uncompressedSize = entry.uncompressedSize >>> 0;
  if (compressedSize > ZIP_LIMITS.zipEntryCompressedBytes) {
    throw limitError('zipEntryCompressedBytes', ZIP_LIMITS.zipEntryCompressedBytes, compressedSize);
  }
  if (uncompressedSize > ZIP_LIMITS.zipEntryBytes) {
    throw limitError('zipEntryBytes', ZIP_LIMITS.zipEntryBytes, uncompressedSize);
  }
  if (compressedSize === 0 ? uncompressedSize > 0 : uncompressedSize / compressedSize > ZIP_LIMITS.zipEntryRatio) {
    throw limitError('zipEntryRatio', ZIP_LIMITS.zipEntryRatio,
      compressedSize === 0 ? Infinity : Math.round(uncompressedSize / compressedSize));
  }

  // Strict UTF-8 (§4.2 step 1): raw bytes only, no yauzl string decoding.
  let rawName;
  try {
    rawName = new TextDecoder('utf-8', { fatal: true }).decode(entry.fileNameRaw);
  } catch (_error) {
    throw zipError(GM.ZIP_PATH_INVALID, 'Archive entry name is not valid UTF-8');
  }
  if (rawName.endsWith('/')) {
    throw zipError(GM.ZIP_INVALID, 'Directory entries are not allowed in a package archive');
  }

  const normalized = normalizeZipPath(rawName);
  if (!normalized.ok) throw policyError(normalized);

  const lowerPath = normalized.value.toLowerCase();
  if (nestedArchiveExtension(lowerPath)) {
    throw zipError(GM.ZIP_UNSUPPORTED, 'Nested archives are not allowed in a package');
  }

  // Shared policy: normalization + descriptor-rename + static asset type in one.
  const checked = checkZipEntryPath(rawName);
  if (!checked.ok) throw policyError(checked);

  // Unix type bits (§4.4): links/devices/FIFOs/sockets are rejected; regular
  // files, DOS attribute-only entries (mode 0) and executable permissions are
  // allowed (the archive is never executed).
  const mode = ((entry.externalFileAttributes >>> 0) >>> 16) & 0xffff;
  const fileType = mode & S_IFMT;
  if (
    fileType === S_IFLNK
    || fileType === S_IFCHR
    || fileType === S_IFBLK
    || fileType === S_IFIFO
    || fileType === S_IFSOCK
  ) {
    throw zipError(GM.ZIP_UNSUPPORTED, 'Links, devices and FIFOs are not allowed in a package');
  }
  if (fileType !== 0 && fileType !== S_IFREG) {
    throw zipError(GM.ZIP_UNSUPPORTED, 'Unsupported entry file type');
  }

  return {
    path: checked.value,
    index,
    kind: checked.kind,
    entry,
    size: uncompressedSize,
    compressedSize,
  };
}

/**
 * Compare the local file header with its central-directory record
 * (contract §4.4 last paragraph — yauzl does NOT report these mismatches).
 */
async function assertLocalHeaderMatches(archive, info, fileSize) {
  const { entry } = info;
  let local;
  try {
    local = await readLocalFileHeader(archive, entry);
  } catch (error) {
    // `readLocalFileHeader` already maps invalid signatures to GM-4275.
    throw error;
  }
  const centralName = Buffer.from(entry.fileNameRaw || []);
  const localName = Buffer.from(local.fileName || []);
  if (centralName.length !== localName.length || !centralName.equals(localName)) {
    throw zipError(GM.ZIP_HEADER_MISMATCH, 'Local header file name differs from the central directory');
  }
  const centralFlag = entry.generalPurposeBitFlag >>> 0;
  const localFlag = local.generalPurposeBitFlag >>> 0;
  // Bit 3 may legitimately differ (data descriptor); every other bit must match.
  if ((centralFlag & ~GP_BIT_DATA_DESCRIPTOR) !== (localFlag & ~GP_BIT_DATA_DESCRIPTOR)) {
    throw zipError(GM.ZIP_HEADER_MISMATCH, 'Local header flags differ from the central directory');
  }
  if (local.compressionMethod !== entry.compressionMethod) {
    throw zipError(GM.ZIP_HEADER_MISMATCH, 'Local header compression method differs from the central directory');
  }
  if ((centralFlag & GP_BIT_DATA_DESCRIPTOR) === 0) {
    if ((local.compressedSize >>> 0) !== (entry.compressedSize >>> 0)) {
      throw zipError(GM.ZIP_HEADER_MISMATCH, 'Local header compressed size differs from the central directory');
    }
    if ((local.uncompressedSize >>> 0) !== (entry.uncompressedSize >>> 0)) {
      throw zipError(GM.ZIP_HEADER_MISMATCH, 'Local header uncompressed size differs from the central directory');
    }
  }
  // The compressed byte range actually read must stay inside the archive
  // (contract §4.4: "实际读取到的压缩字节区间（= entry.compressedSize）").
  if (Number.isFinite(fileSize) && local.fileDataStart + (entry.compressedSize >>> 0) > fileSize) {
    throw zipError(GM.ZIP_HEADER_MISMATCH, 'Entry data range overflows the archive');
  }
}

/**
 * Stream one archive entry into memory with hard byte/CRC accounting.
 * Used for the descriptor (≤ 256 KiB) and `game.json` limits.
 * @returns {Promise<{bytes:Buffer, crc:number}>}
 */
async function readEntryIntoMemory(archive, info, { maxBytes, kind, startedAt, now, maxExtractMs }) {
  const streamState = await openReadStream(archive, info.entry);
  const chunks = [];
  let bytes = 0;
  let crc = 0;
  try {
    for await (const chunk of streamChunks(streamState)) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw limitError(kind, maxBytes, bytes);
      if (bytes > ZIP_LIMITS.zipEntryBytes) throw limitError('zipEntryBytes', ZIP_LIMITS.zipEntryBytes, bytes);
      if (now() - startedAt > maxExtractMs) throw limitError('zipExtractMs', maxExtractMs, now() - startedAt);
      crc = crc32Update(crc, chunk);
      chunks.push(chunk);
    }
  } catch (error) {
    await abortStreamState(streamState);
    throw mapArchiveError(error);
  }
  if (bytes !== (info.entry.uncompressedSize >>> 0)) {
    throw zipError(GM.ZIP_HEADER_MISMATCH, 'Entry size does not match the central directory');
  }
  if (crc !== (info.entry.crc32 >>> 0)) {
    throw zipError(GM.ZIP_CRC_MISMATCH, 'Entry CRC-32 does not match the central directory');
  }
  return { bytes: Buffer.concat(chunks), crc };
}

// ---------------------------------------------------------------------------
// Content scanning (§4.6 / §4.7 — defence in depth, explicitly NOT a proof)
// ---------------------------------------------------------------------------

/** Longest pattern we must still detect across a chunk boundary. */
const SCAN_OVERLAP_CHARS = 8192;

/**
 * Stream a text resource through `inspect(window)` in bounded chunks.
 *
 * Reading a 20 MiB HTML/JS file whole would break the §3 memory budget, so the
 * scan keeps only `SCAN_OVERLAP_CHARS` of carry-over between 64 KiB chunks.
 * Patterns longer than the overlap could in theory straddle a boundary and be
 * missed; the §4.7 scan is explicitly defence in depth (the runtime CSP is the
 * enforcement boundary), so the bounded-memory trade-off is the intended one.
 *
 * @param {string} filePath
 * @param {(window:string) => void} inspect May throw a HostError to reject.
 */
async function scanTextFile(filePath, inspect) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let firstChunk = true;
  let carry = '';
  let rejectInvalid = null;
  try {
    const stream = createReadStream(filePath, { highWaterMark: CHUNK_BYTES });
    for await (const chunk of stream) {
      if (firstChunk) {
        firstChunk = false;
        const head = chunk.subarray(0, 3);
        if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
          throw zipError(GM.ASSET_TYPE_UNSUPPORTED, 'Package text resources must be UTF-8 without BOM');
        }
      }
      carry += decoder.decode(chunk, { stream: true });
      inspect(carry);
      if (carry.length > SCAN_OVERLAP_CHARS) carry = carry.slice(-SCAN_OVERLAP_CHARS);
    }
    carry += decoder.decode();
    if (carry.length > 0) inspect(carry);
  } catch (error) {
    rejectInvalid = error;
  }
  if (rejectInvalid) {
    if (rejectInvalid && rejectInvalid.name === 'HostError') throw rejectInvalid;
    throw zipError(GM.ASSET_TYPE_UNSUPPORTED, 'Package text resources must be valid UTF-8');
  }
}

function forbiddenInScript(text) {
  for (const rule of SCRIPT_FORBIDDEN) {
    if (rule.pattern.test(text)) return rule.rule;
  }
  return null;
}

/**
 * Scan the extracted HTML/CSS/JS/SVG resources. Errors:
 *   - a second authoritative manifest declaration → GM-4279;
 *   - inline script/style/handler/`javascript:` in `asset-zip-v2` → GM-4283;
 *   - external/absolute/remote/data references and dangerous APIs → GM-4280.
 */
async function scanExtractedContent(options, outDir, descriptor) {
  for (const file of descriptor.files) {
    const lowerPath = file.path.toLowerCase();
    const absolute = path.join(outDir, file.path);
    if (lowerPath.endsWith('.html')) {
      await scanTextFile(absolute, (window) => {
        const conflict = checkManifestConflict(window);
        if (!conflict.ok) throw policyError(conflict, GM.MANIFEST_CONFLICT);
        const inline = checkHtmlContent(window, { inlineForbidden: true });
        if (!inline.ok) throw policyError(inline, GM.ASSET_TYPE_UNSUPPORTED);
        if (HTML_ABSOLUTE_REFERENCE.test(window)) {
          throw zipError(GM.ASSET_TYPE_UNSUPPORTED, 'Package HTML must only reference package-relative paths');
        }
      });
    } else if (lowerPath.endsWith('.css')) {
      await scanTextFile(absolute, (window) => {
        const result = checkCssContent(window);
        if (!result.ok) throw policyError(result, GM.ASSET_TYPE_UNSUPPORTED);
        if (CSS_ABSOLUTE_URL.test(window)) {
          throw zipError(GM.ASSET_TYPE_UNSUPPORTED, 'Package CSS must only reference package-relative paths');
        }
      });
    } else if (lowerPath.endsWith('.js') || lowerPath.endsWith('.mjs')) {
      await scanTextFile(absolute, (window) => {
        const rule = forbiddenInScript(window);
        if (rule) throw zipError(GM.ASSET_TYPE_UNSUPPORTED, `Package script uses a forbidden construct: ${rule}`);
      });
    } else if (lowerPath.endsWith('.svg')) {
      await scanTextFile(absolute, (window) => {
        for (const rule of SVG_FORBIDDEN) {
          if (rule.pattern.test(window)) {
            throw zipError(GM.ASSET_TYPE_UNSUPPORTED, `Package SVG uses active content: ${rule.rule}`);
          }
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Descriptor handling (§1.4)
// ---------------------------------------------------------------------------

function parseDescriptor(buffer, warnings) {
  if (buffer.length > ZIP_LIMITS.descriptorBytes) {
    throw limitError('descriptorBytes', ZIP_LIMITS.descriptorBytes, buffer.length);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (_error) {
    throw policyError({ code: 'E_DESCRIPTOR_INVALID', details: { field: 'descriptor' } });
  }
  if (text.startsWith('\uFEFF')) throw policyError({ code: 'E_DESCRIPTOR_INVALID', details: { field: 'descriptor' } });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    throw policyError({ code: 'E_DESCRIPTOR_INVALID', details: { field: 'descriptor' } });
  }
  const result = validateDescriptor(parsed);
  if (!result.ok) throw policyError(result, GM.DESCRIPTOR_INVALID);
  if (Array.isArray(result.warnings)) {
    for (const warning of result.warnings) warnings.push({ code: warning.code, field: warning.field });
  }
  return result.value;
}

/** Set comparison of descriptor `files[]` against real entries (step 7). */
function assertFileSetMatches(files, entries) {
  const expected = new Set(files.map((file) => file.path));
  const actual = new Set(entries.map((entry) => entry.path));
  for (const file of files) {
    if (!actual.has(file.path)) {
      throw policyError({ code: 'E_DESCRIPTOR_MISMATCH', details: { path: file.path } });
    }
  }
  for (const entry of entries) {
    if (!expected.has(entry.path)) {
      throw policyError({ code: 'E_DESCRIPTOR_MISMATCH', details: { path: entry.path } });
    }
  }
}

// ---------------------------------------------------------------------------
// Extraction (steps 8–10)
// ---------------------------------------------------------------------------

async function extractOneEntry(archive, info, outDir, context) {
  const { limits, startedAt, now, maxExtractMs, extractedBytes, fileSize } = context;
  // Step 9 runs before any byte is written for this entry: the local header is
  // the only record an attacker can desynchronise from the central directory.
  await assertLocalHeaderMatches(archive, info, fileSize);

  const absolute = path.join(outDir, info.path);
  const relative = path.relative(outDir, absolute);
  ensure(
    relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative),
    GM.ZIP_PATH_INVALID,
    'Archive entry escapes the extraction directory'
  );
  await fs.mkdir(path.dirname(absolute), { recursive: true, mode: 0o755 });

  const streamState = await openReadStream(archive, info.entry);
  const hash = createHash('sha256');
  let bytes = 0;
  let crc = 0;
  let nested = null;
  let handle = null;
  try {
    handle = await fs.open(absolute, 'wx', 0o644);
    for await (const chunk of streamChunks(streamState)) {
      if (bytes === 0) {
        nested = archiveMagicOf(chunk);
        if (nested) throw zipError(GM.ZIP_UNSUPPORTED, `Nested ${nested} archive detected by content magic`);
      }
      bytes += chunk.length;
      if (bytes > limits.zipEntryBytes) throw limitError('zipEntryBytes', limits.zipEntryBytes, bytes);
      if (extractedBytes.total + bytes > limits.zipUnpackedBytes) {
        throw limitError('zipUnpackedBytes', limits.zipUnpackedBytes, extractedBytes.total + bytes);
      }
      if (now() - startedAt > maxExtractMs) {
        throw limitError('zipExtractMs', maxExtractMs, now() - startedAt);
      }
      crc = crc32Update(crc, chunk);
      hash.update(chunk);
      await handle.write(chunk);
    }
  } catch (error) {
    await abortStreamState(streamState);
    throw mapArchiveError(error);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }

  // Measured vs central directory (§3 rule 1, §4.5 item 5).
  if (bytes !== (info.entry.uncompressedSize >>> 0)) {
    throw zipError(GM.ZIP_HEADER_MISMATCH, 'Extracted size does not match the central directory');
  }
  // Measured CRC vs central directory (§4.5 item 3).
  if (crc !== (info.entry.crc32 >>> 0)) {
    throw zipError(GM.ZIP_CRC_MISMATCH, 'Extracted CRC-32 does not match the central directory');
  }
  if (info.compressedSize === 0 ? bytes > 0 : bytes / info.compressedSize > limits.zipEntryRatio) {
    throw limitError('zipEntryRatio', limits.zipEntryRatio,
      info.compressedSize === 0 ? Infinity : Math.round(bytes / info.compressedSize));
  }
  extractedBytes.total += bytes;
  return { path: info.path, bytes, sha256: hash.digest('hex') };
}

/**
 * Extract and validate one `asset-zip-v2` package.
 *
 * Implements the §4.1 check order: outer checks → EOCD/central directory →
 * per-entry metadata/path/type policy → conflicts → descriptor schema →
 * manifest set comparison → measured extraction (size/CRC/sha256) → local
 * header consistency → game.json + entry/content scans. Nothing is written
 * before step 7 completes, and `outDir` is removed on any failure.
 *
 * @param {{
 *   zipPath: string,
 *   outDir: string,
 *   expected?: {id?: string, version?: string} | null,
 *   maxExtractMs?: number,
 *   now?: () => number,
 *   limits?: object
 * }} options
 * @returns {Promise<{
 *   format: 'asset-zip-v2',
 *   descriptor: object,
 *   entry: string,
 *   files: Array<{path:string,size:number,sha256:string}>,
 *   fileManifestDigest: string,
 *   fileCount: number,
 *   unpackedBytes: number,
 *   outerBytes: number,
 *   manifest: object,
 *   warnings: Array<object>
 * }>}
 */
export async function extractPackageArchive(options) {
  const {
    zipPath,
    outDir,
    expected = null,
    maxExtractMs = TIMING.zipExtractMs,
    now = () => Date.now(),
    limits = ZIP_LIMITS,
  } = options || {};
  ensure(typeof zipPath === 'string' && zipPath.length > 0, GM.ZIP_INVALID, 'Package archive path is missing');
  ensure(typeof outDir === 'string' && outDir.length > 0, GM.ZIP_INVALID, 'Extraction directory is missing');

  const startedAt = now();
  const warnings = [];
  let created = false;
  let completed = false;
  let archive = null;

  try {
    const stats = await fs.stat(zipPath).catch(() => null);
    ensure(stats !== null && stats.isFile(), GM.ZIP_INVALID, 'Package archive could not be read');
    const outerBytes = stats.size;
    if (outerBytes > limits.zipOuterBytes) {
      throw limitError('zipOuterBytes', limits.zipOuterBytes, outerBytes);
    }
    // Step 1: magic.
    await assertZipMagic(zipPath);
    // Step 2: EOCD + central directory bounds + ZIP64/multi-disk.
    const eocd = await readEndOfCentralDirectory(zipPath, outerBytes);

    // Steps 3–4: read every central-directory record, apply path/type/limit
    // policy, and buffer ONLY the descriptor. Nothing touches `outDir` yet.
    const infos = [];
    let descriptorInfo = null;
    let descriptorRead = null;
    archive = await openArchive(zipPath);
    await forEachEntry(archive, async (entry) => {
      const info = inspectEntry(entry, infos.length);
      infos.push(info);
      if (infos.length > limits.zipEntries) {
        throw limitError('zipEntries', limits.zipEntries, infos.length);
      }
      if (info.path === DESCRIPTOR_FILE && descriptorInfo === null) {
        // A duplicate descriptor path is detected by the conflict pass below
        // (GM-4274); only the first record is read here.
        descriptorInfo = info;
        descriptorRead = await readEntryIntoMemory(archive, info, {
          maxBytes: limits.descriptorBytes,
          kind: 'descriptorBytes',
          startedAt,
          now,
          maxExtractMs,
        });
      }
    });
    archive = null;

    // Step 4/5: conflicts and reserved names — before any file is created.
    const paths = infos.map((info) => info.path);
    const conflicts = checkPathConflicts(paths);
    if (!conflicts.ok) throw policyError(conflicts, GM.ZIP_PATH_CONFLICT);
    const reserved = checkReservedNames(paths);
    if (!reserved.ok) throw policyError(reserved, GM.DESCRIPTOR_INVALID);

    // Step 6: descriptor presence and schema.
    if (!descriptorInfo || !descriptorRead) {
      throw policyError({ code: 'E_DESCRIPTOR_MISSING' }, GM.DESCRIPTOR_INVALID);
    }
    const declaredTotal = infos.reduce((total, info) => total + info.size, 0);
    if (declaredTotal > limits.zipUnpackedBytes) {
      throw limitError('zipUnpackedBytes', limits.zipUnpackedBytes, declaredTotal);
    }
    const descriptor = parseDescriptor(descriptorRead.bytes, warnings);

    // Step 7: the manifest must cover exactly every non-descriptor entry.
    const archiveFiles = infos.filter((info) => info.path !== DESCRIPTOR_FILE);
    assertFileSetMatches(descriptor.files, archiveFiles);

    // From here on files are created: the descriptor plus the listed entries.
    await fs.mkdir(outDir, { recursive: true, mode: 0o700 });
    created = true;
    await fs.writeFile(path.join(outDir, DESCRIPTOR_FILE), descriptorRead.bytes, { mode: 0o644 });

    // Step 8: measured extraction, in descriptor (sorted) order.
    const byPath = new Map(infos.map((info) => [info.path, info]));
    const measured = new Map();
    // §3 "解压后总字节" counts every extracted entry, descriptor included.
    const extractedBytes = { total: descriptorRead.bytes.length };
    const context = { limits, startedAt, now, maxExtractMs, extractedBytes, fileSize: outerBytes };
    archive = await openArchive(zipPath);
    const seen = new Set();
    await forEachEntry(archive, async (entry) => {
      const info = inspectEntry(entry, seen.size);
      const known = byPath.get(info.path);
      ensure(known !== undefined, GM.ZIP_HEADER_MISMATCH, 'Archive entry set changed between passes');
      ensure(!seen.has(info.path), GM.ZIP_HEADER_MISMATCH, 'Duplicate archive entry');
      seen.add(info.path);
      if (info.path === DESCRIPTOR_FILE) {
        await assertLocalHeaderMatches(archive, info, outerBytes);
        return;
      }
      const file = descriptor.files.find((item) => item.path === info.path);
      ensure(file !== undefined, GM.DESCRIPTOR_MISMATCH, 'Archive contains an unlisted file');
      const result = await extractOneEntry(archive, info, outDir, context);
      measured.set(info.path, result);
    });
    archive = null;

    ensure(seen.size === infos.length, GM.ZIP_HEADER_MISMATCH, 'Archive entry set changed between passes');

    // Verified manifest vs measured bytes (step 8, §4.5 item 3).
    for (const file of descriptor.files) {
      const result = measured.get(file.path);
      ensure(result !== undefined, GM.DESCRIPTOR_MISMATCH, 'A listed package file was not extracted');
      if (result.bytes !== file.size) {
        throw policyError({ code: 'E_DESCRIPTOR_MISMATCH', details: { path: file.path } });
      }
      if (result.sha256 !== file.sha256) {
        throw policyError({ code: 'E_DESCRIPTOR_MISMATCH', details: { path: file.path } });
      }
    }

    // Step 10: game.json (v1 manifest semantics) + id/version binding.
    const manifestPath = path.join(outDir, ZIP_GAME_MANIFEST_FILE);
    let manifestBytes;
    try {
      manifestBytes = await fs.readFile(manifestPath);
    } catch (_error) {
      throw policyError({ code: 'E_DESCRIPTOR_MISSING' }, GM.DESCRIPTOR_INVALID);
    }
    if (manifestBytes.length > LIMITS.manifestBytes) {
      throw hostError(GM.MANIFEST_TOO_LARGE, 'Package game.json is too large', { retryable: false });
    }
    let manifest;
    let manifestText;
    try {
      manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
    } catch (_error) {
      manifestText = null;
    }
    if (manifestText === null || manifestText.startsWith('\uFEFF')) {
      throw hostError(GM.MANIFEST_JSON, 'Package game.json must be UTF-8 JSON without BOM', { retryable: false });
    }
    try {
      manifest = JSON.parse(manifestText);
    } catch (_error) {
      throw hostError(GM.MANIFEST_JSON, 'Package game.json is not valid JSON', { retryable: false });
    }
    const manifestResult = validateManifest(manifest);
    if (!manifestResult.ok) {
      const first = manifestResult.errors[0] || {};
      const mapped = gmForInternal(first.code);
      throw hostError(mapped === GM.INTERNAL ? GM.MANIFEST_INVALID : mapped,
        typeof first.message === 'string' ? first.message : 'Invalid package manifest',
        { retryable: false, details: typeof first.field === 'string' ? { field: first.field } : undefined });
    }
    if (expected) {
      if (expected.id !== undefined && manifest.id !== expected.id) {
        throw hostError(GM.INSTALL_VERSION_MISMATCH, 'Package id does not match the registry entry', { retryable: false });
      }
      if (expected.version !== undefined && manifest.version !== expected.version) {
        throw hostError(GM.INSTALL_VERSION_MISMATCH, 'Package version does not match the registry entry', { retryable: false });
      }
    }

    // Entry file must exist (descriptor validation already requires its type).
    ensure(descriptor.files.some((file) => file.path === descriptor.entry), GM.DESCRIPTOR_MISMATCH,
      'Descriptor entry is missing from the file manifest');

    // Content scans (§4.6/§4.7) after extraction so the checks see real bytes.
    await scanExtractedContent({ limits }, outDir, descriptor);

    // Whole-archive ratio uses measured values (outer bytes already limited).
    const unpackedBytes = [...measured.values()].reduce((total, file) => total + file.bytes, 0);
    if (unpackedBytes / outerBytes > limits.zipTotalRatio) {
      throw limitError('zipTotalRatio', limits.zipTotalRatio, Math.round(unpackedBytes / outerBytes));
    }
    if (now() - startedAt > maxExtractMs) {
      throw limitError('zipExtractMs', maxExtractMs, now() - startedAt);
    }

    const digest = fileManifestDigest(descriptor.files, (text) => sha256Hex(text));
    completed = true;
    return {
      format: 'asset-zip-v2',
      descriptor,
      entry: descriptor.entry,
      files: descriptor.files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })),
      fileManifestDigest: digest,
      fileCount: descriptor.files.length,
      unpackedBytes,
      outerBytes,
      manifest,
      warnings,
    };
  } catch (error) {
    throw mapArchiveError(error);
  } finally {
    if (archive) {
      try {
        archive.close();
      } catch (_error) {
        // autoClose may already have closed it.
      }
    }
    if (!completed && created) {
      await fs.rm(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Lightweight recovery check (contract §6.5)
// ---------------------------------------------------------------------------

/** True when `target` is a direct/indirect child of `directory`. */
function isInsideDirectory(directory, target) {
  const relative = path.relative(directory, target);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Stream a file through SHA-256 without buffering it (bounded memory). */
async function sha256File(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath, { highWaterMark: CHUNK_BYTES });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Verify an installed `asset-zip-v2` version directory without re-extracting.
 *
 * Default (`verifyContents: false`) is the §6.5 *lightweight* startup-recovery
 * check: the descriptor must exist, be valid, and its `fileManifestDigest` must
 * equal the one recorded at install time. The entry file must exist.
 *
 * `verifyContents: true` additionally re-hashes every listed file and compares
 * size/sha256 with the descriptor. That is what an install/rollback uses to
 * decide whether a retained version directory is byte-equal to the package it
 * just verified: the manifest digest alone cannot detect a tampered resource
 * byte (the descriptor would still hash the same).
 *
 * Never deletes or rewrites anything.
 *
 * @param {{directory: string, record: {fileManifestDigest?: string|null, entry?: string|null},
 *          verifyContents?: boolean}} options
 * @returns {Promise<{ok:boolean, reason:string|null, fileManifestDigest?:string}>}
 */
export async function verifyPackageDirectory({ directory, record, verifyContents = false } = {}) {
  const descriptorPath = path.join(directory, DESCRIPTOR_FILE);
  let raw;
  try {
    raw = await fs.readFile(descriptorPath);
  } catch (_error) {
    return { ok: false, reason: 'descriptor-missing' };
  }
  let parsed;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    if (text.startsWith('\uFEFF')) return { ok: false, reason: 'descriptor-invalid' };
    parsed = JSON.parse(text);
  } catch (_error) {
    return { ok: false, reason: 'descriptor-invalid' };
  }
  const validated = validateDescriptor(parsed);
  if (!validated.ok) return { ok: false, reason: 'descriptor-invalid' };
  const digest = fileManifestDigest(validated.value.files, (text) => sha256Hex(text));
  if (typeof record?.fileManifestDigest !== 'string' || digest !== record.fileManifestDigest) {
    return { ok: false, reason: 'file-manifest-digest' };
  }
  if (typeof record?.entry === 'string' && validated.value.entry !== record.entry) {
    return { ok: false, reason: 'entry-mismatch' };
  }
  const entryPath = path.join(directory, validated.value.entry);
  if (!isInsideDirectory(directory, entryPath)) return { ok: false, reason: 'entry-missing' };
  let entryStats;
  try {
    entryStats = await fs.lstat(entryPath);
  } catch (_error) {
    return { ok: false, reason: 'entry-missing' };
  }
  if (!entryStats.isFile()) return { ok: false, reason: 'entry-missing' };

  if (verifyContents) {
    for (const file of validated.value.files) {
      const absolute = path.join(directory, file.path);
      if (!isInsideDirectory(directory, absolute)) return { ok: false, reason: 'file-content-mismatch' };
      let stats;
      try {
        stats = await fs.lstat(absolute);
      } catch (_error) {
        return { ok: false, reason: 'file-content-mismatch' };
      }
      if (!stats.isFile() || stats.size !== file.size) {
        return { ok: false, reason: 'file-content-mismatch' };
      }
      let actual;
      try {
        actual = await sha256File(absolute);
      } catch (_error) {
        return { ok: false, reason: 'file-content-mismatch' };
      }
      if (actual !== file.sha256) return { ok: false, reason: 'file-content-mismatch' };
    }
  }
  return { ok: true, reason: null, fileManifestDigest: digest };
}

/**
 * Drop write permission from every published file (§6.1 item 1). Best effort:
 * the caller records a warning when this fails, and never fails the install.
 *
 * Directories deliberately keep owner write permission: unlinking a package
 * (uninstall, version prune, crash cleanup) requires write access to the parent
 * directory, and a read-only directory makes the documented atomic "move to
 * trash" path fail with EACCES. The read-only guarantee for users is enforced by
 * the Host code writing only into staging; the permission bit is defence in
 * depth (and the on-disk bytes are already bound by the recorded digest).
 * @param {string} directory Version directory.
 */
export async function sealPackageDirectory(directory) {
  const failures = [];
  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      failures.push(error);
      return;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(target);
      } else if (entry.isFile()) {
        try {
          await fs.chmod(target, 0o444);
        } catch (error) {
          failures.push(error);
        }
      }
    }
  }
  await walk(directory);
  return { ok: failures.length === 0, failures: failures.length };
}

/**
 * Restore owner write permission so an installed tree can be moved/pruned
 * (§6.1 item 1 keeps the tree read-only while it is live).
 * @param {string} directory
 */
export async function unsealPackageDirectory(directory) {
  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    try {
      await fs.chmod(current, 0o755);
    } catch (_error) {
      // Best effort.
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else {
        try {
          await fs.chmod(target, 0o644);
        } catch (_error) {
          // Best effort.
        }
      }
    }
  }
  await walk(directory);
}

/** Exposed for tests: the chunk size every measured stream uses. */
export const ZIP_CHUNK_BYTES = CHUNK_BYTES;
/** Exposed for tests: central-directory signature upstream code should never see. */
export const ZIP_CENTRAL_SIGNATURE = CENTRAL_SIGNATURE;
