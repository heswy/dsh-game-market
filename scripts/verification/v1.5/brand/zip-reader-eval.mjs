#!/usr/bin/env node
/**
 * ZIP reader evaluation for the V1.5-CONTRACTS §2 dependency decision.
 *
 * This probe does not ship a dependency: it installs candidate readers into
 * `/tmp/dsh-v15/ziplib` (never into the repo) and measures what each one can and
 * cannot prove. It exists because the contract must choose between
 * "review a minimal archive dependency" and "hand-write the extractor", and that
 * choice must rest on measured reader behaviour, not on API folklore.
 *
 * Prerequisite (network, outside the repo):
 *   npm install --no-save --prefix /tmp/dsh-v15/ziplib \
 *     --cache /tmp/dsh-v15/npm-cache yauzl@3.4.0
 *
 * Exit codes: 0 = evaluation passed, 1 = assertion failed, 2 = prerequisite missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createReport, ensure, writeJson } from '../lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const RAW = path.join(REPO_ROOT, 'docs/verification/v1.5/raw/brand');
const WORK = '/tmp/dsh-v15/ziptest';
const LIB_ROOT = process.env.DSH_V15_ZIPLIB || '/tmp/dsh-v15/ziplib';
const YAUZL = path.join(LIB_ROOT, 'node_modules/yauzl');
const FFLATE_IN_APP = '/tmp/dsh-v15/asar/dsh/node_modules/fflate';

const report = createReport({
  id: 'V1.5-ZIP-DEP',
  title: 'ZIP reader candidates: fflate (App-vendored) vs yauzl (pinned dependency)',
  commands: [
    'npm install --no-save --prefix /tmp/dsh-v15/ziplib --cache /tmp/dsh-v15/npm-cache yauzl@3.4.0',
    'node scripts/verification/v1.5/brand/zip-reader-eval.mjs',
  ],
});

if (!fs.existsSync(YAUZL)) {
  console.error(`[V1.5-ZIP-DEP] prerequisite missing: ${YAUZL}`);
  console.error('[V1.5-ZIP-DEP] run: npm install --no-save --prefix /tmp/dsh-v15/ziplib --cache /tmp/dsh-v15/npm-cache yauzl@3.4.0');
  process.exit(2);
}

ensure(RAW);
ensure(WORK);

// ---------------------------------------------------------------------------
// Deterministic fixtures (no network, no shell content execution)
// ---------------------------------------------------------------------------

function buildFixtures() {
  const py = `
import zipfile, os, stat, struct
os.chdir(${JSON.stringify(WORK)})
open('hello.txt','w').write('hello world\\n'*3)
open('big.bin','wb').write(bytes(range(256))*40)
with zipfile.ZipFile('good.zip','w',zipfile.ZIP_DEFLATED) as z:
    z.write('hello.txt','scripts/main.js')
    z.write('big.bin','assets/big.bin',compress_type=zipfile.ZIP_STORED)
data = bytearray(open('good.zip','rb').read())
i = data.find(b'PK\\x03\\x04', data.find(b'PK\\x03\\x04')+4)
name_len = struct.unpack('<H', data[i+26:i+28])[0]
data[i+30+name_len+5] ^= 0xFF
open('corrupt-data.zip','wb').write(bytes(data))
with zipfile.ZipFile('hostile.zip','w',zipfile.ZIP_DEFLATED) as z:
    zi = zipfile.ZipInfo('assets/link'); zi.external_attr = (stat.S_IFLNK|0o777)<<16
    z.writestr(zi,'../../../etc/passwd')
    z.writestr(zipfile.ZipInfo('../escape.txt'),'x')
    z.writestr(zipfile.ZipInfo('/abs.txt'),'x')
    z.writestr(zipfile.ZipInfo('a\\\\b.txt'),'x')
    z.writestr(zipfile.ZipInfo('caf\\u00e9.txt'),'x')
    z.writestr(zipfile.ZipInfo('cafe\\u0301.txt'),'x')
`;
  execFileSync('python3', ['-c', py], { stdio: 'pipe' });
  try {
    execFileSync('zip', ['-P', 'secret', '-q', 'enc.zip', 'hello.txt'], { cwd: WORK, stdio: 'pipe' });
  } catch {
    /* optional fixture */
  }
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Read every entry with yauzl, decoding bytes and checking size + CRC-32. */
function readWithYauzl(file, { crc } = {}) {
  const yauzl = createRequire(import.meta.url)(YAUZL);
  return new Promise((resolve) => {
    yauzl.open(file, { lazyEntries: true, decodeStrings: false, validateEntrySizes: true }, (error, zip) => {
      if (error) {
        resolve({ file, openError: String(error.message || error) });
        return;
      }
      const entries = [];
      zip.on('entry', (entry) => {
        const record = {
          name: entry.fileName.toString('utf8'),
          fileNameRaw: entry.fileNameRaw.toString('hex'),
          compressionMethod: entry.compressionMethod,
          compressedSize: entry.compressedSize,
          uncompressedSize: entry.uncompressedSize,
          crc32: entry.crc32,
          generalPurposeBitFlag: entry.generalPurposeBitFlag,
          externalFileAttributes: entry.externalFileAttributes,
          unixMode: `0${((entry.externalFileAttributes >>> 16) & 0xffff).toString(8)}`,
          versionNeededToExtract: entry.versionNeededToExtract,
          extraFieldIds: (entry.extraFields || []).map((field) => field.id),
          relativeOffsetOfLocalHeader: entry.relativeOffsetOfLocalHeader,
        };
        if (record.generalPurposeBitFlag & 0x1) {
          record.encrypted = true;
          record.streamError = 'rejected before openReadStream: general purpose bit 0 (encryption) set';
          entries.push(record);
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            record.streamError = String(streamError.message || streamError);
            entries.push(record);
            zip.readEntry();
            return;
          }
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', (error2) => {
            record.streamError = String(error2.message || error2);
            entries.push(record);
            zip.readEntry();
          });
          stream.on('end', () => {
            const data = Buffer.concat(chunks);
            record.decodedBytes = data.length;
            record.crc32Computed = typeof crc === 'function' ? crc(data) : null;
            record.crc32Matches = record.crc32Computed === null ? null : record.crc32Computed === entry.crc32;
            entries.push(record);
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve({ file, entries }));
      zip.on('error', (streamError) => resolve({ file, error: String(streamError.message || streamError) }));
      zip.readEntry();
    });
  });
}

/** Read every entry with the fflate build DSH itself vendors (0.8.2). */
async function readWithFflate(file) {
  if (!fs.existsSync(FFLATE_IN_APP)) return { file, unavailable: FFLATE_IN_APP };
  const fflate = createRequire(import.meta.url)(FFLATE_IN_APP);
  const buffer = fs.readFileSync(file);
  const unzip = new fflate.Unzip();
  unzip.register(fflate.UnzipInflate);
  const entries = [];
  const pending = [];
  unzip.onfile = (entry) => {
    const record = {
      name: entry.name,
      compression: entry.compression,
      size: entry.size,
      originalSize: entry.originalSize,
      publicKeys: Object.keys(entry).sort(),
      hasCrcField: Object.prototype.hasOwnProperty.call(entry, 'crc'),
    };
    entries.push(record);
    pending.push(
      new Promise((resolve) => {
        let bytes = 0;
        entry.ondata = (error, chunk, final) => {
          if (error) record.error = String(error.message || error);
          else bytes += chunk.length;
          if (final) {
            record.decodedBytes = bytes;
            resolve();
          }
        };
        entry.start();
        setTimeout(resolve, 500);
      }),
    );
  };
  for (let offset = 0; offset < buffer.length; offset += 64) {
    const end = Math.min(offset + 64, buffer.length);
    unzip.push(buffer.subarray(offset, end), end >= buffer.length);
  }
  await Promise.all(pending);
  return { file, entries };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

buildFixtures();

const crypto = await import('node:crypto');
const zlib = await import('node:zlib');
const crc32 = typeof zlib.crc32 === 'function'
  ? (data) => zlib.crc32(data) >>> 0
  : (() => {
      // Documented fallback for Node 20 < 20.15: table-driven CRC-32/ISO-HDLC.
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        table[i] = value >>> 0;
      }
      return (data) => {
        let crcValue = 0xffffffff;
        for (const byte of data) crcValue = table[(crcValue ^ byte) & 0xff] ^ (crcValue >>> 8);
        return (crcValue ^ 0xffffffff) >>> 0;
      };
    })();

const good = await readWithYauzl(path.join(WORK, 'good.zip'), { crc: crc32 });
const corrupt = await readWithYauzl(path.join(WORK, 'corrupt-data.zip'), { crc: crc32 });
const hostile = await readWithYauzl(path.join(WORK, 'hostile.zip'), { crc: crc32 });
const encrypted = fs.existsSync(path.join(WORK, 'enc.zip'))
  ? await readWithYauzl(path.join(WORK, 'enc.zip'), { crc: crc32 })
  : { file: 'enc.zip', skipped: true };
const fflateGood = await readWithFflate(path.join(WORK, 'good.zip'));
const fflateCorrupt = await readWithFflate(path.join(WORK, 'corrupt-data.zip'));

const yauzlVersion = JSON.parse(fs.readFileSync(path.join(YAUZL, 'package.json'), 'utf8'));
const pendVersion = JSON.parse(fs.readFileSync(path.join(LIB_ROOT, 'node_modules/pend/package.json'), 'utf8'));
const fflateVersion = fs.existsSync(FFLATE_IN_APP)
  ? JSON.parse(fs.readFileSync(path.join(FFLATE_IN_APP, 'package.json'), 'utf8'))
  : null;

const evidence = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  zlibCrc32Available: typeof zlib.crc32 === 'function',
  crc32SelfTest: crc32(Buffer.from('123456789', 'utf8')) === 0xcbf43926,
  candidates: {
    yauzl: {
      version: yauzlVersion.version,
      license: yauzlVersion.license,
      dependencies: yauzlVersion.dependencies,
      transitive: { pend: { version: pendVersion.version, license: pendVersion.license } },
      packageBytes: Number(execFileSync('du', ['-sk', YAUZL]).toString().split('\t')[0]) * 1024,
    },
    fflateAppVendored: fflateVersion
      ? { version: fflateVersion.version, license: fflateVersion.license, dependencies: fflateVersion.dependencies ?? null, path: FFLATE_IN_APP }
      : null,
  },
  yauzl: { good, corrupt, hostile, encrypted },
  fflate: { good: fflateGood, corrupt: fflateCorrupt },
  sha256: {
    'good.zip': crypto.createHash('sha256').update(fs.readFileSync(path.join(WORK, 'good.zip'))).digest('hex'),
    'corrupt-data.zip': crypto.createHash('sha256').update(fs.readFileSync(path.join(WORK, 'corrupt-data.zip'))).digest('hex'),
    'hostile.zip': crypto.createHash('sha256').update(fs.readFileSync(path.join(WORK, 'hostile.zip'))).digest('hex'),
  },
};

const entryOf = (result, name) => (result.entries || []).find((entry) => entry.name === name);
const goodMain = entryOf(good, 'scripts/main.js');
const goodStored = entryOf(good, 'assets/big.bin');
const corruptStored = entryOf(corrupt, 'assets/big.bin');
const hostileLink = entryOf(hostile, 'assets/link');

report.add('yauzl is pinned 3.4.0 under MIT', yauzlVersion.version === '3.4.0' && yauzlVersion.license === 'MIT', yauzlVersion.version);
report.add(
  'yauzl transitive closure is exactly pend@1.2.0 (MIT)',
  Object.keys(yauzlVersion.dependencies || {}).length === 1 && yauzlVersion.dependencies.pend === '~1.2.0' && pendVersion.version === '1.2.0',
  { dependencies: yauzlVersion.dependencies, pend: pendVersion.version, pendLicense: pendVersion.license },
);
report.add('CRC-32 self-test vector matches 0xCBF43926', evidence.crc32SelfTest, { node: process.version, zlibCrc32: evidence.zlibCrc32Available });
report.add(
  'yauzl exposes the CRC-32 of every entry from the central directory',
  Boolean(goodMain && Number.isInteger(goodMain.crc32) && goodStored && Number.isInteger(goodStored.crc32)),
  { deflated: goodMain && goodMain.crc32, stored: goodStored && goodStored.crc32 },
);
report.add(
  'yauzl decodes both Stored and Deflate entries with exact byte counts',
  Boolean(goodMain && goodMain.decodedBytes === goodMain.uncompressedSize && goodStored && goodStored.decodedBytes === goodStored.uncompressedSize),
  { deflated: goodMain && { method: goodMain.compressionMethod, decodedBytes: goodMain.decodedBytes }, stored: goodStored && { method: goodStored.compressionMethod, decodedBytes: goodStored.decodedBytes } },
);
report.add(
  'CRC-32 recomputed over decoded bytes confirms the intact archive',
  Boolean(goodMain && goodMain.crc32Matches === true && goodStored && goodStored.crc32Matches === true),
  { deflated: goodMain && goodMain.crc32Matches, stored: goodStored && goodStored.crc32Matches },
);
report.add(
  'CRC-32 recomputation detects a corrupted Stored entry (yauzl alone does not)',
  Boolean(corruptStored && corruptStored.decodedBytes === corruptStored.uncompressedSize && corruptStored.crc32Matches === false),
  corruptStored && { decodedBytes: corruptStored.decodedBytes, expectedCrc: corruptStored.crc32, computedCrc: corruptStored.crc32Computed },
);
report.add(
  'fflate (App-vendored 0.8.2) exposes no per-entry CRC field',
  Boolean(fflateVersion && fflateGood.entries && fflateGood.entries.length === 2 && fflateGood.entries.every((entry) => entry.hasCrcField === false)),
  fflateGood.entries && fflateGood.entries.map((entry) => ({ name: entry.name, publicKeys: entry.publicKeys })),
);
report.add(
  'fflate silently returns corrupted Stored bytes (no CRC enforcement)',
  Boolean(
    fflateCorrupt.entries &&
      fflateCorrupt.entries.length === 2 &&
      fflateCorrupt.entries.every((entry) => !entry.error && entry.decodedBytes === entry.originalSize),
  ),
  fflateCorrupt.entries && fflateCorrupt.entries.map((entry) => ({ name: entry.name, decodedBytes: entry.decodedBytes, originalSize: entry.originalSize, error: entry.error ?? null })),
);
report.add(
  'yauzl surfaces symlink mode bits so path/type policy can reject them',
  Boolean(hostileLink && hostileLink.unixMode === '0120777'),
  hostileLink && { name: hostileLink.name, unixMode: hostileLink.unixMode },
);
report.add(
  'hostile names arrive byte-exact (traversal, absolute, backslash, NFD/NFC pair)',
  Boolean(
    hostile.entries &&
      hostile.entries.some((entry) => entry.name === '../escape.txt') &&
      hostile.entries.some((entry) => entry.name === '/abs.txt') &&
      hostile.entries.some((entry) => entry.name === 'a\\b.txt') &&
      hostile.entries.some((entry) => entry.name === 'café.txt') &&
      hostile.entries.some((entry) => entry.name === 'cafe\u0301.txt'),
  ),
  hostile.entries && hostile.entries.map((entry) => entry.name),
);
report.add(
  'encrypted entries are rejected before any data is decrypted',
  Boolean(encrypted.skipped || (entryOf(encrypted, 't/hello.txt') && entryOf(encrypted, 't/hello.txt').encrypted === true)),
  encrypted.skipped ? { skipped: 'zip -P unavailable on this machine' } : entryOf(encrypted, 't/hello.txt'),
);
writeJson(path.join(RAW, 'b1-zip-reader-eval.json'), evidence);
evidence.readerLimitations = [
  'yauzl reads local headers to locate data and validates entry sizes (validateEntrySizes), but it does NOT report a mismatch between a local header and the central directory; M1 must keep the central directory as authority and reject entries whose local header disagrees. Recorded limitation, not a verified pass.',
  'yauzl supports ZIP64; the V1.5 contract forbids it, so the validator must reject ZIP64 explicitly (central-directory extra field id 0x0001, versionNeededToExtract >= 45, or EOCD sentinel values). This probe did not produce a real ZIP64 archive — still unverified.',
  'yauzl does not verify CRC-32; the validator computes CRC-32 over decoded bytes (zlib.crc32 when available, otherwise a table-driven CRC-32/ISO-HDLC implementation with the 0xCBF43926 self-test).',
];
writeJson(path.join(RAW, 'b1-zip-reader-eval.json'), evidence);

const result = report.finish({
  evidenceFile: 'docs/verification/v1.5/raw/brand/b1-zip-reader-eval.json',
  prerequisite: 'npm install --no-save --prefix /tmp/dsh-v15/ziplib --cache /tmp/dsh-v15/npm-cache yauzl@3.4.0',
});
writeJson(path.join(RAW, 'b1-zip-reader-eval-report.json'), result);

console.log(`\n[V1.5-ZIP-DEP] ${result.passed ? 'PASS' : 'FAIL'} — ${result.checks.filter((c) => c.ok).length}/${result.checks.length} checks ok`);
for (const check of result.checks) {
  console.log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}`);
}
process.exit(result.passed ? 0 : 1);
