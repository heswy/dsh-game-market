/**
 * Deterministic ZIP writer for `asset-zip-v2` packages (contract §1.3/§3/§4).
 *
 * The Host's `packages/host/src/zip.js` is a strict READER/extractor; the CLI is
 * where packages are produced, so the writer lives here. Determinism rules:
 *   - entries sorted by their UTF-8 path bytes;
 *   - fixed DOS timestamp 1980-01-01 00:00:00 (no build time in the archive);
 *   - STORED (method 0, no compression), so there is no compressor-version or
 *     level drift between machines;
 *   - fixed permission bits 0444 (read-only file) in the external attributes;
 *   - UTF-8 name flag set, no extra fields, no data descriptors, no comment.
 *
 * CRC-32 is implemented locally so the output does not depend on the Node
 * version having `zlib.crc32`.
 */

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const VERSION_NEEDED = 20;
/** made-by: Unix (3) + spec 2.0, so external attributes carry POSIX mode bits. */
const VERSION_MADE_BY = (3 << 8) | 20;
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01
const FILE_MODE = 0o100444; // regular file, 0444

let crcTable = null;
function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

/** CRC-32/ISO-HDLC of a Buffer (same value the ZIP central directory carries). */
export function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = table[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function comparePathBytes(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

/**
 * Build one deterministic ZIP archive.
 *
 * @param {Array<{path: string, data: Buffer, mode?: number}>} entries
 * @returns {{buffer: Buffer, entries: Array<{path: string, size: number, sha256?: string, mode: number}>}}
 */
export function buildZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('buildZip needs at least one entry');
  const seen = new Set();
  const prepared = entries.map((entry) => {
    if (!entry || typeof entry.path !== 'string' || entry.path.length === 0) {
      throw new TypeError('buildZip entry.path must be a non-empty string');
    }
    if (seen.has(entry.path)) throw new TypeError(`duplicate ZIP entry path: ${entry.path}`);
    seen.add(entry.path);
    if (!Buffer.isBuffer(entry.data)) throw new TypeError(`buildZip entry.data must be a Buffer: ${entry.path}`);
    const mode = entry.mode === undefined ? FILE_MODE : entry.mode;
    return { path: entry.path, name: Buffer.from(entry.path, 'utf8'), data: entry.data, mode };
  });
  prepared.sort((left, right) => comparePathBytes(left.path, right.path));

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const report = [];
  for (const entry of prepared) {
    const crc = crc32(entry.data);
    const local = Buffer.concat([
      uint32(LOCAL_SIGNATURE),
      uint16(VERSION_NEEDED),
      uint16(FLAG_UTF8),
      uint16(METHOD_STORED),
      uint16(DOS_TIME),
      uint16(DOS_DATE),
      uint32(crc),
      uint32(entry.data.length),
      uint32(entry.data.length),
      uint16(entry.name.length),
      uint16(0),
      entry.name,
      entry.data,
    ]);
    localParts.push(local);
    centralParts.push(
      Buffer.concat([
        uint32(CENTRAL_SIGNATURE),
        uint16(VERSION_MADE_BY),
        uint16(VERSION_NEEDED),
        uint16(FLAG_UTF8),
        uint16(METHOD_STORED),
        uint16(DOS_TIME),
        uint16(DOS_DATE),
        uint32(crc),
        uint32(entry.data.length),
        uint32(entry.data.length),
        uint16(entry.name.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32((entry.mode << 16) >>> 0),
        uint32(offset),
        entry.name,
      ])
    );
    report.push({ path: entry.path, size: entry.data.length, mode: entry.mode & 0o777 });
    offset += local.length;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.concat([
    uint32(EOCD_SIGNATURE),
    uint16(0),
    uint16(0),
    uint16(prepared.length),
    uint16(prepared.length),
    uint32(central.length),
    uint32(offset),
    uint16(0),
  ]);
  return { buffer: Buffer.concat([...localParts, central, eocd]), entries: report };
}

/** True when `value` is a mode reported by `buildZip` (0444 semantics). */
export function isReadOnlyMode(mode) {
  return mode === 0o444;
}
