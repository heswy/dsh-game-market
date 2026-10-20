/**
 * Deterministic ZIP builder for `asset-zip-v2` policy tests.
 *
 * `yauzl` only reads archives, so the A03 matrix needs full control over the
 * container: raw (possibly non-UTF-8) entry names, local-header/central-
 * directory divergence, forged sizes/CRCs, ZIP64 records, duplicate entries,
 * data descriptors, directory entries, Unix mode bits and truncation.
 *
 * This builder is intentionally independent of the production code: it computes
 * its own local headers and central directory so a bug in `zip.js` cannot also
 * corrupt the fixtures used to prove it rejects malformed archives.
 */

import { deflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;

/** Fixed DOS timestamp: 1980-01-01 00:00:00 (contract §1.9 deterministic builds). */
export const DOS_TIME = 0x0000;
export const DOS_DATE = 0x0021;

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

/** Independent CRC-32 (same vector as contract §4.5 item 4). */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value === undefined || value === null) return Buffer.alloc(0);
  throw new TypeError(`unsupported ZIP entry data: ${typeof value}`);
}

function encodeName(name) {
  if (Buffer.isBuffer(name)) return name;
  if (name instanceof Uint8Array) return Buffer.from(name);
  return Buffer.from(String(name), 'utf8');
}

function extraField(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return Buffer.alloc(0);
  const buffers = entries.map((field) => {
    const data = toBuffer(field.data);
    const header = Buffer.alloc(4);
    header.writeUInt16LE(field.id, 0);
    header.writeUInt16LE(data.length, 2);
    return Buffer.concat([header, data]);
  });
  return Buffer.concat(buffers);
}

/**
 * Build a ZIP archive.
 *
 * Entry options (all optional):
 *   name             string|Buffer — raw stored name (Buffer allows invalid UTF-8/NUL)
 *   data             string|Buffer — uncompressed payload
 *   method           0 (Stored, default) | 8 (Deflate)
 *   flags            central+local general-purpose bit flag (default 0x0800 UTF-8)
 *   crc32            override the central+local CRC (default: real CRC)
 *   compressedSize   override the central+local compressed size
 *   uncompressedSize override the central+local uncompressed size
 *   mode             Unix mode bits stored in externalFileAttributes high 16
 *   versionNeeded    override version-needed-to-extract (ZIP64 fixture)
 *   extraFields      [{id, data}] central + local extra fields
 *   localExtraFields [{id, data}] local-only extra fields
 *   localName        override the local header name bytes
 *   localFlags       override the local header GP flag
 *   localMethod      override the local header compression method
 *   localCompressedSize / localUncompressedSize overrides
 *   localCrc32       override the local header CRC
 *   dataDescriptor   set GP bit 3 and append a data descriptor record
 *   localHeaderOverride (buffer)=>buffer — escape hatch for signature corruption
 *
 * Archive options:
 *   comment       EOCD comment string
 *   eocd          { entries?, entriesOnDisk?, diskNumber?, centralDisk?,
 *                   centralSize?, centralOffset? } overrides
 *   truncateTo    cut the resulting archive to this byte length
 *
 * @param {Array<object>} entries
 * @param {object} [options]
 * @returns {Buffer}
 */
export function buildZip(entries, options = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encodeName(entry.name);
    const data = toBuffer(entry.data);
    const method = entry.method === undefined ? 0 : entry.method >>> 0;
    const realCrc = crc32(data);
    const compressed = entry.rawCompressed !== undefined
      ? toBuffer(entry.rawCompressed)
      : method === 8
        ? deflateRawSync(data, { level: 9 })
        : data;

    let flags = entry.flags === undefined ? 0x0800 : entry.flags >>> 0;
    if (entry.dataDescriptor) flags |= 0x0008;

    const crcValue = entry.crc32 === undefined ? realCrc : entry.crc32 >>> 0;
    const compressedSize = entry.compressedSize === undefined ? compressed.length : entry.compressedSize >>> 0;
    const uncompressedSize =
      entry.uncompressedSize === undefined ? data.length : entry.uncompressedSize >>> 0;

    const localName = entry.localName === undefined ? name : encodeName(entry.localName);
    const centralExtra = extraField(entry.extraFields);
    const localExtra = extraField(
      entry.localExtraFields !== undefined ? entry.localExtraFields : entry.extraFields
    );
    const versionNeeded = entry.versionNeeded === undefined ? 20 : entry.versionNeeded >>> 0;

    const localFlags = entry.localFlags === undefined ? flags : entry.localFlags >>> 0;
    const localMethod = entry.localMethod === undefined ? method : entry.localMethod >>> 0;
    // With GP bit 3 the local header sizes/CRC are a data descriptor placeholder.
    const localCrc32 = entry.localCrc32 === undefined
      ? (entry.dataDescriptor ? 0 : crcValue)
      : entry.localCrc32 >>> 0;
    const localCompressedSize = entry.localCompressedSize === undefined
      ? (entry.dataDescriptor ? 0 : compressedSize)
      : entry.localCompressedSize >>> 0;
    const localUncompressedSize = entry.localUncompressedSize === undefined
      ? (entry.dataDescriptor ? 0 : uncompressedSize)
      : entry.localUncompressedSize >>> 0;

    const localHeader = Buffer.alloc(30 + localName.length + localExtra.length);
    localHeader.writeUInt32LE(LOCAL_SIGNATURE, 0);
    localHeader.writeUInt16LE(versionNeeded, 4);
    localHeader.writeUInt16LE(localFlags, 6);
    localHeader.writeUInt16LE(localMethod, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(localCrc32, 14);
    localHeader.writeUInt32LE(localCompressedSize, 18);
    localHeader.writeUInt32LE(localUncompressedSize, 22);
    localHeader.writeUInt16LE(localName.length, 26);
    localHeader.writeUInt16LE(localExtra.length, 28);
    localName.copy(localHeader, 30);
    localExtra.copy(localHeader, 30 + localName.length);
    const finalLocalHeader = entry.localHeaderOverride
      ? toBuffer(entry.localHeaderOverride(Buffer.from(localHeader)))
      : localHeader;

    const centralHeader = Buffer.alloc(46 + name.length + centralExtra.length);
    centralHeader.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // versionMadeBy: Unix, 2.0
    centralHeader.writeUInt16LE(versionNeeded, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(crcValue, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(centralExtra.length, 30);
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    const mode = entry.mode === undefined ? 0o100644 : entry.mode >>> 0;
    centralHeader.writeUInt32LE((mode << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    centralExtra.copy(centralHeader, 46 + name.length);

    localParts.push(finalLocalHeader, compressed);
    if (entry.dataDescriptor) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(DATA_DESCRIPTOR_SIGNATURE, 0);
      descriptor.writeUInt32LE(crcValue, 4);
      descriptor.writeUInt32LE(compressedSize, 8);
      descriptor.writeUInt32LE(uncompressedSize, 12);
      localParts.push(descriptor);
    }
    centralParts.push(centralHeader);
    offset += finalLocalHeader.length + compressed.length + (entry.dataDescriptor ? 16 : 0);
  }

  const centralDirectory = Buffer.concat(centralParts);
  const comment = options.comment === undefined ? '' : String(options.comment);
  const commentBytes = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22 + commentBytes.length);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  const overrides = options.eocd || {};
  eocd.writeUInt16LE(overrides.diskNumber ?? 0, 4);
  eocd.writeUInt16LE(overrides.centralDisk ?? 0, 6);
  eocd.writeUInt16LE(overrides.entriesOnDisk ?? entries.length, 8);
  eocd.writeUInt16LE(overrides.entries ?? entries.length, 10);
  eocd.writeUInt32LE(overrides.centralSize ?? centralDirectory.length, 12);
  eocd.writeUInt32LE(overrides.centralOffset ?? offset, 16);
  eocd.writeUInt16LE(commentBytes.length, 20);
  commentBytes.copy(eocd, 22);

  let archive = Buffer.concat([...localParts, centralDirectory, eocd]);
  if (Number.isInteger(options.truncateTo) && options.truncateTo >= 0 && options.truncateTo < archive.length) {
    archive = archive.subarray(0, options.truncateTo);
  }
  return archive;
}

/** Deterministic deflate (fixed level + no timestamps) used by every fixture. */
export function deterministicDeflate(bytes) {
  return deflateRawSync(bytes, { level: 9 });
}
