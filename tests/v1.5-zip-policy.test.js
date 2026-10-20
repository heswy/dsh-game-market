/**
 * V1.5 A03 · `asset-zip-v2` malicious-package matrix (contract §3/§4/§7.5).
 *
 * Every rejection case runs through the REAL Host install pipeline
 * (`POST /install-local`, `Content-Type: application/zip`) and asserts:
 *   1. the exact public `GM-*` code (not a generic media-type/JSON error),
 *   2. the HTTP status derived from that code (§8.1/§8.3),
 *   3. NO version directory under `packages/`,
 *   4. `staging/` is empty and `installations.json` has no record (§6.3),
 *   5. error `details` stay inside the §8.4 allowlist.
 *
 * Falsifiability (M0 lesson: `docs/verification/v1.5/resources.md` §5.4 — a
 * "blocked" result is worthless if nothing was actually attempted):
 *   - the same harness, same Content-Type and same package shape install
 *     successfully in the positive-control tests (a rejection cannot be an
 *     artefact of a broken fixture/pipeline);
 *   - mutated fixtures differ from the accepted control by exactly the one
 *     property under test (see each case comment);
 *   - the expected error code is specific to the attempted attack (e.g.
 *     traversal → GM-4273, not the catch-all GM-4270/GM-4150).
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import test from 'node:test';

import { ROUTES } from '../packages/shared/src/contracts.js';
import { GM, httpStatusFor } from '../packages/shared/src/errors.js';
import { fileManifestDigest } from '../packages/shared/src/package-v2.js';
import { createHostHarness } from '../packages/host/test/support/harness.js';
import {
  crc32Of,
  crc32Update,
  extractPackageArchive,
  verifyPackageDirectory,
} from '../packages/host/src/zip.js';
import { deflateRawSync } from 'node:zlib';

import { buildZip } from './helpers/zip-builder.mjs';

function deterministicDeflateBytes(bytes) {
  return deflateRawSync(bytes, { level: 9 });
}
import {
  buildDescriptor,
  buildGameManifest,
  buildPackage,
  defaultFiles,
  packageEntries,
  sha256Hex,
} from './helpers/zip-package.mjs';

/** Errors that are allowed to appear in `error.details` (contract §8.4). */
const DETAIL_KEYS = new Set(['field', 'index', 'limit', 'actual', 'kind', 'path']);

let operationCounter = 0;
function nextOperation(label) {
  operationCounter += 1;
  return `${label}-${operationCounter}`;
}

async function installZip(host, bytes, options = {}) {
  return host.requestJson(ROUTES.INSTALL_LOCAL, {
    rawBody: bytes,
    contentType: options.contentType === undefined ? 'application/zip' : options.contentType,
    query: options.operationId === undefined ? { operationId: nextOperation('a03') } : { operationId: options.operationId },
    headers: options.headers,
  });
}

async function foodArtifacts(host) {
  let games = {};
  if (await host.pathExists('installations.json')) {
    const file = await host.readDataJson('installations.json');
    games = file.games || {};
  }
  return {
    staging: await host.listDataFiles('staging'),
    packages: await host.listDataFiles('packages'),
    games,
  };
}

/** Assert a rejection: code, HTTP status, no install artifacts, safe details. */
async function expectRejected(host, label, bytes, expectedCode) {
  const { response, payload } = await installZip(host, bytes);
  assert.equal(response.ok, false, `${label}: request must fail`);
  assert.equal(payload.ok, false, `${label}: envelope must be an error`);
  assert.equal(
    payload.error.code,
    expectedCode,
    `${label}: expected ${expectedCode}, got ${payload.error.code} (${payload.error.message})`
  );
  assert.equal(
    response.status,
    httpStatusFor(expectedCode),
    `${label}: HTTP ${response.status} must follow shared httpStatusFor(${expectedCode})=${httpStatusFor(expectedCode)}`
  );
  const details = payload.error.details || {};
  for (const key of Object.keys(details)) {
    assert.ok(DETAIL_KEYS.has(key), `${label}: details.${key} is outside the §8.4 allowlist`);
  }
  const artifacts = await foodArtifacts(host);
  assert.deepEqual(artifacts.staging, [], `${label}: staging must be empty after rejection`);
  assert.deepEqual(artifacts.packages, [], `${label}: no version directory may be created`);
  assert.deepEqual(artifacts.games, {}, `${label}: no installation record may be written`);
  return payload;
}

function filesWith(overrides) {
  return defaultFiles(overrides);
}

function entriesFor(files, options = {}) {
  return packageEntries(files, options).entries;
}

async function assertDirectoryHashes(directory) {
  const output = new Map();
  async function walk(current, prefix) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = `${current}/${entry.name}`;
      if (entry.isDirectory()) await walk(absolute, relative);
      else output.set(relative, sha256Hex(await fs.readFile(absolute)));
    }
  }
  await walk(directory, '');
  return output;
}

/** The URL/filename rule of §1.2 for a ZIP package. */
function zipFileName(id = 'orbit-courier', version = '1.0.0') {
  return `${id}-${version}.dshgame.zip`;
}

function v2RegistryDocument(zip, { filesDigest, overrides = {} } = {}) {
  return {
    registryVersion: 2,
    generatedAt: '2026-10-18T00:00:00.000Z',
    games: [
      {
        id: 'orbit-courier',
        name: 'Orbit Courier',
        version: '1.0.0',
        description: 'A test resource package used by host tests.',
        author: { name: 'Test Studio' },
        categories: ['arcade'],
        capabilities: ['storage', 'score'],
        sdkVersion: '^1.0.0',
        runtimeVersion: '^1.0.0',
        package: {
          format: 'asset-zip-v2',
          url: `packages/${zipFileName()}`,
          sha256: sha256Hex(zip),
          size: zip.length,
          releasedAt: '2026-10-18T00:00:00.000Z',
          ...(filesDigest === undefined ? {} : { filesDigest }),
        },
        cover: 'https://cdn.example.com/cover.png',
        publishedAt: '2026-10-18T00:00:00.000Z',
        updatedAt: '2026-10-18T00:00:00.000Z',
        ...overrides,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// CRC-32 (§4.5 item 4)
// ---------------------------------------------------------------------------

test('CRC-32: self-test vector and incremental chaining (contract §4.5 item 4)', () => {
  assert.equal(crc32Of(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32Of(Buffer.alloc(0)), 0x00000000);
  // The 64 KiB streaming path accumulates CRC chunk by chunk; it must equal the
  // one-shot value for arbitrary chunk boundaries.
  const whole = Buffer.from('The quick brown fox jumps over the lazy dog');
  const expected = crc32Of(whole);
  for (const boundaries of [[7, 30], [1, 2, 3], [0, 5, 12, 44]]) {
    let chained = 0;
    let start = 0;
    for (const boundary of boundaries) {
      chained = crc32Update(chained, whole.subarray(start, boundary));
      start = boundary;
    }
    chained = crc32Update(chained, whole.subarray(start));
    assert.equal(chained, expected, `chained CRC differs for boundaries ${boundaries.join(',')}`);
  }
});

// ---------------------------------------------------------------------------
// A03 rejection matrix (real install pipeline)
// ---------------------------------------------------------------------------

test('A03: every hostile archive is rejected without creating a version directory', async (t) => {
  const host = await createHostHarness(t, {
    config: { registry: { url: '/nonexistent/games.json', allowLocalFile: true } },
  });

  // ---- positive control first: proves this harness/pipeline accepts the same
  //      shape when nothing is malicious (so later rejections are meaningful).
  {
    const control = buildPackage(filesWith({}));
    const { response, payload } = await installZip(host, control.zip, { operationId: 'a03-control' });
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.data.installation.format, 'asset-zip-v2');
    assert.equal(payload.data.installation.entry, 'index.html');
    assert.equal(payload.data.installation.fileCount, 5);
    const files = await fs.readdir(host.filePath('packages', 'orbit-courier', '1.0.0'));
    assert.ok(files.includes('dsh-package.json'));
    assert.deepEqual(await host.listDataFiles('staging'), []);
    // Reset to an empty store so the matrix can assert "no artifacts" globally.
    const removed = await host.requestJson(ROUTES.UNINSTALL, {
      body: { gameId: 'orbit-courier', operationId: 'a03-control-uninstall' },
    });
    assert.equal(removed.payload.ok, true);
    assert.deepEqual(await host.listDataFiles('packages'), []);
  }

  const cases = [];
  const add = (label, zip, code) => cases.push({ label, zip, code });

  // ---- path traversal / normalization (§4.2) ----
  add('traversal ../', buildZip([...entriesFor(filesWith({})), { name: '../evil.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('traversal nested a/../../evil.js', buildZip([...entriesFor(filesWith({})), { name: 'a/../../evil.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('absolute path /etc/passwd.js', buildZip([...entriesFor(filesWith({})), { name: '/etc/passwd.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('drive letter C:/evil.js', buildZip([...entriesFor(filesWith({})), { name: 'C:/evil.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('UNC //host/share.js', buildZip([...entriesFor(filesWith({})), { name: '//host/share.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('backslash a\\b.js', buildZip([...entriesFor(filesWith({})), { name: 'a\\b.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('empty segment a//b.js', buildZip([...entriesFor(filesWith({})), { name: 'a//b.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('dot segment ./x.js', buildZip([...entriesFor(filesWith({})), { name: './x.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('dot-dot segment a/../x.js', buildZip([...entriesFor(filesWith({})), { name: 'a/../x.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('trailing space segment a /x.js', buildZip([...entriesFor(filesWith({})), { name: 'a /x.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('trailing dot segment a./x.js', buildZip([...entriesFor(filesWith({})), { name: 'a./x.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('NUL byte in name', buildZip([...entriesFor(filesWith({})), { name: 'nul\u0000.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('control character in name', buildZip([...entriesFor(filesWith({})), { name: 'a\u0001.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('invalid UTF-8 name bytes', buildZip([...entriesFor(filesWith({})), { name: Buffer.from([0xff, 0xfe, 0x41]), data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('Windows reserved name con.js', buildZip([...entriesFor(filesWith({})), { name: 'con.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID);
  add('path too deep (13 segments)', buildZip([...entriesFor(filesWith({})), { name: `${Array.from({ length: 12 }, () => 'd').join('/')}/x.txt`, data: Buffer.from('x') }]), GM.ZIP_LIMIT);
  add('path too long (241 code points)', buildZip([...entriesFor(filesWith({})), { name: `${'a'.repeat(237)}.txt`, data: Buffer.from('x') }]), GM.ZIP_LIMIT);

  // ---- conflicts (§4.3) ----
  add('duplicate entry path', buildZip([...entriesFor(filesWith({})), { name: 'index.html', data: Buffer.from('dup') }]), GM.ZIP_PATH_CONFLICT);
  {
    const files = filesWith({ 'Extra.js': Buffer.from('x') });
    add('case-fold conflict Extra.js/extra.js', buildZip([...entriesFor(files), { name: 'extra.js', data: Buffer.from('y') }]), GM.ZIP_PATH_CONFLICT);
  }
  {
    const files = filesWith({ 'caf\u00e9.js': Buffer.from('x') });
    add('NFC conflict café.js/café.js', buildZip([...entriesFor(files), { name: 'cafe\u0301.js', data: Buffer.from('y') }]), GM.ZIP_PATH_CONFLICT);
  }
  add('directory/file conflict', buildZip([...entriesFor(filesWith({})), { name: 'levels/level-01.json/extra.json', data: Buffer.from('{}') }]), GM.ZIP_PATH_CONFLICT);
  add('second descriptor at sub/dsh-package.json', buildZip([...entriesFor(filesWith({})), { name: 'sub/dsh-package.json', data: Buffer.from('{}') }]), GM.DESCRIPTOR_INVALID);
  add('directory entry assets/', buildZip([...entriesFor(filesWith({})), { name: 'assets/', data: Buffer.alloc(0) }]), GM.ZIP_INVALID);

  // ---- unsupported archive features (§4.4) ----
  add('symlink mode (0o120777)', buildZip([...entriesFor(filesWith({})), { name: 'link.js', data: Buffer.from('target'), mode: 0o120777 }]), GM.ZIP_UNSUPPORTED);
  add('character device mode', buildZip([...entriesFor(filesWith({})), { name: 'dev.js', data: Buffer.from('x'), mode: 0o020644 }]), GM.ZIP_UNSUPPORTED);
  add('block device mode', buildZip([...entriesFor(filesWith({})), { name: 'blk.js', data: Buffer.from('x'), mode: 0o060644 }]), GM.ZIP_UNSUPPORTED);
  add('FIFO mode', buildZip([...entriesFor(filesWith({})), { name: 'fifo.js', data: Buffer.from('x'), mode: 0o010644 }]), GM.ZIP_UNSUPPORTED);
  add('traditional encryption (GP bit0)', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, flags: 0x0801, method: 8 } : entry))), GM.ZIP_UNSUPPORTED);
  add('strong encryption (GP bit6)', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, flags: 0x0840, method: 8 } : entry))), GM.ZIP_UNSUPPORTED);
  add('compression method 12 (bzip2)', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, method: 12, rawCompressed: Buffer.from('zz') } : entry))), GM.ZIP_UNSUPPORTED);
  add('ZIP64 via version-needed 45', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'dsh-package.json' ? { ...entry, versionNeeded: 45 } : entry))), GM.ZIP_UNSUPPORTED);
  add('ZIP64 via extra field 0x0001', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'dsh-package.json' ? { ...entry, extraFields: [{ id: 0x0001, data: Buffer.alloc(0) }] } : entry))), GM.ZIP_UNSUPPORTED);
  add('ZIP64 via EOCD sentinel', buildZip(entriesFor(filesWith({}), {}), { eocd: { entries: 0xffff, entriesOnDisk: 0xffff } }), GM.ZIP_UNSUPPORTED);
  add('multi-disk archive', buildZip(entriesFor(filesWith({}), {}), { eocd: { diskNumber: 1, centralDisk: 1 } }), GM.ZIP_UNSUPPORTED);
  add('nested archive by extension (.zip)', buildZip([...entriesFor(filesWith({ 'assets/pack.zip': Buffer.from('PK fake') }))].map((entry) => entry)), GM.ZIP_UNSUPPORTED);
  add('nested archive by magic (PK header in .js)', buildZip([...entriesFor(filesWith({ 'assets/blob.js': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]) }))]), GM.ZIP_UNSUPPORTED);

  // ---- integrity / measured values (§4.5) ----
  add('forged descriptor size', (() => {
    const files = filesWith({});
    const descriptor = buildDescriptor(files);
    descriptor.files = descriptor.files.map((file) => (file.path === 'index.html' ? { ...file, size: file.size + 5 } : file));
    return buildPackage(files, { descriptor }).zip;
  })(), GM.DESCRIPTOR_MISMATCH);
  add('forged descriptor sha256', (() => {
    const files = filesWith({});
    const descriptor = buildDescriptor(files);
    descriptor.files = descriptor.files.map((file) => (file.path === 'index.html' ? { ...file, sha256: 'a'.repeat(64) } : file));
    return buildPackage(files, { descriptor }).zip;
  })(), GM.DESCRIPTOR_MISMATCH);
  add('forged central-directory CRC', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, crc32: 0xdeadbeef } : entry))), GM.ZIP_CRC_MISMATCH);
  add('forged central-directory size (Stored)', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, uncompressedSize: 5 } : entry))), GM.ZIP_HEADER_MISMATCH);
  add('forged central-directory size (Deflate)', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, method: 8, compressedSize: 3 } : entry))), GM.ZIP_HEADER_MISMATCH);
  add('truncated Deflate stream (raw zlib Z_BUF_ERROR)', (() => {
    // The central directory is internally consistent (2 bytes of compressed data
    // are really present) but the Deflate stream is cut short, so only the
    // measured path can catch it: the raw zlib error must become GM-4275.
    const files = filesWith({});
    const entries = entriesFor(files, {}).map((entry) => {
      if (entry.name !== 'index.html') return entry;
      const complete = deterministicDeflateBytes(Buffer.from(entry.data));
      // Keep the declared ratio under the 100:1 entry limit so the extraction
      // path (not the limit pre-check) is what rejects this fixture.
      return { ...entry, method: 8, rawCompressed: complete.subarray(0, 5), compressedSize: 5 };
    });
    return buildZip(entries);
  })(), GM.ZIP_HEADER_MISMATCH);
  add('local header file-name mismatch', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, localName: Buffer.from('indeX.html') } : entry))), GM.ZIP_HEADER_MISMATCH);
  add('local header flag mismatch', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, localFlags: 0x0801 } : entry))), GM.ZIP_HEADER_MISMATCH);
  add('local header method mismatch', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, localMethod: 8 } : entry))), GM.ZIP_HEADER_MISMATCH);
  add('local header signature corrupted', buildZip(entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? {
    ...entry,
    localHeaderOverride: (header) => {
      header.writeUInt32LE(0x11223344, 0);
      return header;
    },
  } : entry))), GM.ZIP_HEADER_MISMATCH);
  add('truncated archive', (() => {
    const zip = buildPackage(filesWith({})).zip;
    return zip.subarray(0, Math.floor(zip.length / 2));
  })(), GM.ZIP_INVALID);
  add('not a ZIP at all', Buffer.from('<!doctype html><html></html>'), GM.UNSUPPORTED_MEDIA_TYPE);

  // ---- limits (§3) ----
  add('high per-entry compression ratio (4 MiB zeros)', (() => {
    const files = filesWith({ 'levels/huge.json': Buffer.alloc(4 * 1024 * 1024) });
    return buildZip(entriesFor(files).map((entry) => ({ ...entry, method: 8 })));
  })(), GM.ZIP_LIMIT);
  add('entry count 513 (descriptor + 512 files)', (() => {
    const files = new Map(defaultFiles());
    for (let index = 0; index < 507; index += 1) {
      files.set(`levels/f${String(index).padStart(4, '0')}.txt`, Buffer.from(`x${index}`));
    }
    return buildPackage(files).zip;
  })(), GM.ZIP_LIMIT);
  add('files[] 512 (implies 513 entries)', (() => {
    const files = new Map(defaultFiles());
    for (let index = 0; index < 507; index += 1) {
      files.set(`levels/f${String(index).padStart(4, '0')}.txt`, Buffer.from(`x${index}`));
    }
    // A descriptor listing 512 files but an archive that only has the original
    // five: either side (limit or mismatch) must reject, never install.
    const descriptor = buildDescriptor(new Map(defaultFiles()));
    for (let index = 0; index < 507; index += 1) {
      descriptor.files.push({ path: `levels/f${String(index).padStart(4, '0')}.txt`, size: 2, sha256: 'a'.repeat(64) });
    }
    descriptor.files.sort((left, right) => left.path.localeCompare(right.path));
    return buildPackage(files, { descriptor }).zip;
  })(), GM.ZIP_LIMIT);

  // ---- descriptor (§1.4) ----
  add('missing descriptor', buildZip(entriesFor(filesWith({})).slice(1)), GM.DESCRIPTOR_INVALID);
  add('descriptor invalid JSON', buildZip([{ name: 'dsh-package.json', data: Buffer.from('{ not json') }, ...entriesFor(filesWith({})).slice(1)]), GM.DESCRIPTOR_INVALID);
  add('descriptor formatVersion 1', buildZip((() => {
    const files = filesWith({});
    const descriptor = { ...buildDescriptor(files), formatVersion: 1 };
    return packageEntries(files, { descriptor }).entries;
  })()), GM.DESCRIPTOR_INVALID);
  add('descriptor files unsorted', buildZip((() => {
    const files = filesWith({});
    const descriptor = buildDescriptor(files);
    descriptor.files = [...descriptor.files].reverse();
    return packageEntries(files, { descriptor }).entries;
  })()), GM.DESCRIPTOR_INVALID);
  add('descriptor lists itself', buildZip((() => {
    const files = filesWith({});
    const descriptor = buildDescriptor(files);
    descriptor.files = [...descriptor.files, { path: 'dsh-package.json', size: 1, sha256: 'a'.repeat(64) }].sort((a, b) => a.path.localeCompare(b.path));
    return packageEntries(files, { descriptor }).entries;
  })()), GM.DESCRIPTOR_INVALID);
  add('descriptor too large (>256 KiB)', buildZip((() => {
    const files = filesWith({});
    const descriptor = { ...buildDescriptor(files), 'x-pad': 'p'.repeat(300 * 1024) };
    return packageEntries(files, { descriptor }).entries;
  })()), GM.ZIP_LIMIT);

  // ---- manifest set (§1.5) ----
  add('missing file listed in files[]', buildZip(entriesFor(filesWith({})).filter((entry) => entry.name !== 'levels/level-01.json')), GM.DESCRIPTOR_MISMATCH);
  add('extra file not listed in files[]', buildZip([...entriesFor(filesWith({})), { name: 'extra.txt', data: Buffer.from('x') }]), GM.DESCRIPTOR_MISMATCH);

  // ---- double manifest / inline content (§1.6, §7.5) ----
  add('second authoritative manifest (<script id>)', (() => {
    const manifest = JSON.stringify(buildGameManifest());
    const files = filesWith({
      'index.html': `<!doctype html><html><head><script type="application/json" id="dsh-game-manifest">${manifest}</script></head><body><script src="scripts/main.js"></script></body></html>`,
    });
    return buildPackage(files).zip;
  })(), GM.MANIFEST_CONFLICT);
  add('inline <script> block', (() => {
    const files = filesWith({ 'index.html': '<!doctype html><html><head><script>console.log(1)</script></head><body></body></html>' });
    return buildPackage(files).zip;
  })(), GM.ASSET_INLINE_FORBIDDEN);
  add('inline <style> block', (() => {
    const files = filesWith({ 'index.html': '<!doctype html><html><head><style>body{}</style><script src="scripts/main.js"></script></head><body></body></html>' });
    return buildPackage(files).zip;
  })(), GM.ASSET_INLINE_FORBIDDEN);
  add('inline event handler on*=', (() => {
    const files = filesWith({ 'index.html': '<!doctype html><html><body><button onclick="alert(1)">x</button><script src="scripts/main.js"></script></body></html>' });
    return buildPackage(files).zip;
  })(), GM.ASSET_INLINE_FORBIDDEN);
  add('javascript: URL', (() => {
    const files = filesWith({ 'index.html': '<!doctype html><html><body><a href="javascript:alert(1)">x</a><script src="scripts/main.js"></script></body></html>' });
    return buildPackage(files).zip;
  })(), GM.ASSET_INLINE_FORBIDDEN);
  add('external https fetch in script', (() => {
    const files = filesWith({ 'scripts/main.js': "fetch('https://example.com/x.json');\n" });
    return buildPackage(files).zip;
  })(), GM.ASSET_TYPE_UNSUPPORTED);
  add('protocol-relative fetch in script', (() => {
    const files = filesWith({ 'scripts/main.js': "fetch('//example.com/x.json');\n" });
    return buildPackage(files).zip;
  })(), GM.ASSET_TYPE_UNSUPPORTED);
  add('absolute-path fetch in script', (() => {
    const files = filesWith({ 'scripts/main.js': "fetch('/abs.json');\n" });
    return buildPackage(files).zip;
  })(), GM.ASSET_TYPE_UNSUPPORTED);
  add('data: fetch in script', (() => {
    const files = filesWith({ 'scripts/main.js': "fetch('data:application/json,{}');\n" });
    return buildPackage(files).zip;
  })(), GM.ASSET_TYPE_UNSUPPORTED);
  add('remote dynamic import', (() => {
    const files = filesWith({ 'scripts/main.js': "import('https://example.com/mod.js');\n" });
    return buildPackage(files).zip;
  })(), GM.ASSET_TYPE_UNSUPPORTED);
  add('external <iframe>', (() => {
    const files = filesWith({ 'index.html': '<!doctype html><html><body><iframe src="./x.html"></iframe><script src="scripts/main.js"></script></body></html>' });
    return buildPackage(files).zip;
  })(), GM.ASSET_TYPE_UNSUPPORTED);
  add('external <img> absolute URL', (() => {
    const files = filesWith({ 'index.html': '<!doctype html><html><body><img src="https://cdn.example.com/x.png"><script src="scripts/main.js"></script></body></html>' });
    return buildPackage(files).zip;
  })(), GM.ASSET_TYPE_UNSUPPORTED);

  // ---- execute the matrix ----
  assert.ok(cases.length >= 40, `matrix should cover every A03 category (got ${cases.length})`);
  for (const item of cases) {
    await expectRejected(host, item.label, item.zip, item.code);
  }

  // ---- after the whole matrix the pipeline still installs a valid package:
  //      proves every rejection above exited through the policy layer.
  {
    const control = buildPackage(filesWith({}));
    const { response, payload } = await installZip(host, control.zip, { operationId: 'a03-control-after' });
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
  }
});

// ---------------------------------------------------------------------------
// Positive paths (the other half of the falsifiability requirement)
// ---------------------------------------------------------------------------

test('A03 positive: legal structures install, are byte-deterministic and record full V1.5 metadata', async (t) => {
  const host = await createHostHarness(t, {
    config: { registry: { url: '/nonexistent/games.json', allowLocalFile: true } },
  });
  const pkg = buildPackage(filesWith({}));

  // Two independent builds of the same content must be byte-identical (§1.9).
  const rebuilt = buildPackage(filesWith({}));
  assert.deepEqual(Buffer.from(rebuilt.zip), Buffer.from(pkg.zip), 'two builds of the same content must match byte for byte');

  const first = await installZip(host, pkg.zip, { operationId: 'positive-1' });
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  const installation = first.payload.data.installation;
  assert.equal(installation.format, 'asset-zip-v2');
  assert.equal(installation.entry, 'index.html');
  assert.equal(installation.fileCount, pkg.descriptor.files.length);
  assert.equal(installation.sha256, sha256Hex(pkg.zip));
  assert.equal(installation.fileManifestDigest, fileManifestDigest(pkg.descriptor.files, sha256Hex));
  const expectedUnpacked = [...pkg.files.values()].reduce((total, bytes) => total + bytes.length, 0);
  assert.equal(installation.unpackedBytes, expectedUnpacked);
  assert.equal(installation.previousFormat, null);
  assert.equal(installation.source, 'local');
  assert.deepEqual(await host.listDataFiles('staging'), []);

  // Installed bytes are exactly the archive bytes for every listed file.
  for (const [path, bytes] of pkg.files) {
    const installed = await fs.readFile(host.filePath('packages', 'orbit-courier', '1.0.0', path));
    assert.deepEqual(installed, bytes, `installed bytes differ for ${path}`);
  }
  // Published files are read-only (§6.1 item 1, best effort).
  const mode = (await fs.stat(host.filePath('packages', 'orbit-courier', '1.0.0', 'index.html'))).mode & 0o777;
  assert.equal(mode, 0o444);

  // Re-installing the same outer ZIP is idempotent (same measured sha256).
  const again = await installZip(host, pkg.zip, { operationId: 'positive-2' });
  assert.equal(again.response.status, 200);
  assert.equal(again.payload.data.changed, false);
  assert.equal(again.payload.data.installation.fileManifestDigest, installation.fileManifestDigest);

  // Two fresh hosts installing the same archive produce identical trees.
  const host2 = await createHostHarness(t, {
    config: { registry: { url: '/nonexistent/games.json', allowLocalFile: true } },
  });
  const second = await installZip(host2, pkg.zip, { operationId: 'positive-3' });
  assert.equal(second.response.status, 200);
  const treeA = await assertDirectoryHashes(host.filePath('packages', 'orbit-courier', '1.0.0'));
  const treeB = await assertDirectoryHashes(host2.filePath('packages', 'orbit-courier', '1.0.0'));
  assert.deepEqual([...treeA.entries()].sort(), [...treeB.entries()].sort());
});

test('A03 positive: data descriptors, stored and deflated entries, 512 total entries', async (t) => {
  const host = await createHostHarness(t, {
    config: { registry: { url: '/nonexistent/games.json', allowLocalFile: true } },
  });

  // Data descriptor (GP bit 3) is explicitly allowed (§4.4).
  const described = buildPackage(filesWith({}), {
    entriesOverride: entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, dataDescriptor: true } : entry)),
  });
  const descriptorInstall = await installZip(host, described.zip, { operationId: 'dd-1' });
  assert.equal(descriptorInstall.response.status, 200, JSON.stringify(descriptorInstall.payload));
  // Remove it again so the 512-entry package starts from a clean version slot.
  await host.requestJson(ROUTES.UNINSTALL, { body: { gameId: 'orbit-courier', operationId: 'dd-uninstall' } });

  // Mixed Stored/Deflate entries install (both methods are supported).
  const mixed = buildPackage(filesWith({}), {
    entriesOverride: entriesFor(filesWith({}), {}).map((entry) => (entry.name === 'index.html' ? { ...entry, method: 8 } : entry)),
  });
  const mixedInstall = await installZip(host, mixed.zip, { operationId: 'mixed-1' });
  assert.equal(mixedInstall.response.status, 200, JSON.stringify(mixedInstall.payload));
  await host.requestJson(ROUTES.UNINSTALL, { body: { gameId: 'orbit-courier', operationId: 'mixed-uninstall' } });

  // Maximum legal package: 1 descriptor + 511 files = 512 central-directory
  // entries (§3 rule 0). One more entry is rejected (covered in the matrix).
  const files = new Map(filesWith({}));
  for (let index = 0; index < 506; index += 1) {
    files.set(`levels/f${String(index).padStart(4, '0')}.txt`, Buffer.from(`x${index}`));
  }
  const maximal = buildPackage(files);
  assert.equal(maximal.descriptor.files.length, 511);
  const maximalInstall = await installZip(host, maximal.zip, { operationId: 'max-entries' });
  assert.equal(maximalInstall.response.status, 200, JSON.stringify(maximalInstall.payload));
  assert.equal(maximalInstall.payload.data.installation.fileCount, 511);
  assert.deepEqual(await host.listDataFiles('staging'), []);
});

test('A03 positive: relative package reads are allowed, CSP is the enforcement boundary (§4.7 Q-6)', async (t) => {
  const host = await createHostHarness(t, {
    config: { registry: { url: '/nonexistent/games.json', allowLocalFile: true } },
  });
  const files = filesWith({
    'scripts/main.js': [
      "fetch('./levels/level-01.json').then((response) => response.json());",
      "fetch('scripts/level-loader.mjs');",
      "import('./level-loader.mjs');",
      "fetch('../levels/level-01.json');",
      'const request = new XMLHttpRequest();',
      "request.open('GET', 'levels/level-01.json');",
      '',
    ].join('\n'),
  });
  const pkg = buildPackage(files);
  const { response, payload } = await installZip(host, pkg.zip, { operationId: 'relative-ok' });
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.data.installation.format, 'asset-zip-v2');
});

test('A03 positive: html-v1 keeps working; format change on the same version is rejected (§5.4)', async (t) => {
  const host = await createHostHarness(t, {
    config: { registry: { url: '/nonexistent/games.json', allowLocalFile: true } },
  });
  const htmlBody = Buffer.from(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script type="application/json" id="dsh-game-manifest">${JSON.stringify({
      manifestVersion: 1,
      id: 'orbit-courier',
      name: 'Orbit Courier',
      version: '1.0.0',
      author: { name: 'Test Studio' },
      description: 'A single-file control game.',
      categories: ['arcade'],
      capabilities: ['storage', 'score'],
      sdkVersion: '^1.0.0',
      runtimeVersion: '^1.0.0',
      score: { direction: 'higher-better', min: 0, max: 1000, integer: true },
      save: { schemaVersion: 1 },
    })}</script>
    <title>Orbit Courier</title>
  </head>
  <body><div id="app"></div></body>
</html>
`);
  const htmlInstall = await host.requestJson(ROUTES.INSTALL_LOCAL, {
    rawBody: htmlBody,
    contentType: 'text/html',
    query: { operationId: 'html-1' },
  });
  assert.equal(htmlInstall.response.status, 200, JSON.stringify(htmlInstall.payload));
  assert.equal(htmlInstall.payload.data.installation.format, 'html-v1');
  assert.equal(htmlInstall.payload.data.installation.entry, 'entry.html');
  assert.equal(htmlInstall.payload.data.installation.fileManifestDigest, null);
  assert.equal(await host.pathExists('packages/orbit-courier/1.0.0/entry.html'), true);

  // Same id + same version with a different format must be refused (§5.4 item 2).
  const zipPackage = buildPackage(filesWith({}));
  const changedFormat = await installZip(host, zipPackage.zip, { operationId: 'format-change' });
  assert.equal(changedFormat.payload.ok, false);
  assert.equal(changedFormat.payload.error.code, GM.FORMAT_POLICY);
  assert.equal(changedFormat.response.status, httpStatusFor(GM.FORMAT_POLICY));
  // The html-v1 install is untouched: no half-written zip version directory.
  assert.equal(await host.pathExists('packages/orbit-courier/1.0.0/entry.html'), true);
  assert.equal(await host.pathExists('packages/orbit-courier/1.0.0/dsh-package.json'), false);
  const record = (await host.readDataJson('installations.json')).games['orbit-courier'];
  assert.equal(record.format, 'html-v1');
  assert.equal(record.version, '1.0.0');
});

// ---------------------------------------------------------------------------
// ZIP64 / local-header / policy unit checks against zip.js directly
// ---------------------------------------------------------------------------

test('zip.js: extraction cleans its output directory on failure', async (t) => {
  const directory = await fs.mkdtemp(`${process.env.TMPDIR || '/tmp'}/dsh-zip-unit-`);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const files = filesWith({ 'index.html': '<!doctype html><html><head><script>x()</script></head><body></body></html>' });
  const zipPath = `${directory}/bad.zip`;
  await fs.writeFile(zipPath, buildPackage(files).zip);
  const outDir = `${directory}/tree`;
  await assert.rejects(
    extractPackageArchive({ zipPath, outDir }),
    (error) => error.code === GM.ASSET_INLINE_FORBIDDEN
  );
  // Either absent or an empty directory: never a partially extracted tree.
  const leftovers = await fs.readdir(outDir).catch(() => []);
  assert.deepEqual(leftovers, []);
});

test('zip.js: truncated Deflate streams always fail with a controlled GM code (no raw zlib error)', async (t) => {
  const directory = await fs.mkdtemp(`${process.env.TMPDIR || '/tmp'}/dsh-zip-zlib-`);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const entries = entriesFor(filesWith({}), {}).map((entry) => {
    if (entry.name !== 'index.html') return entry;
    const complete = deterministicDeflateBytes(Buffer.from(entry.data));
    return { ...entry, method: 8, rawCompressed: complete.subarray(0, 5), compressedSize: 5 };
  });
  const zipPath = `${directory}/truncated-deflate.zip`;
  await fs.writeFile(zipPath, buildZip(entries));
  // The zlib error emission order is timing dependent (yauzl forwards it with
  // setImmediate); a single run can miss the race, so iterate.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await assert.rejects(
      extractPackageArchive({ zipPath, outDir: `${directory}/tree-${attempt}` }),
      (error) => {
        assert.equal(error.name, 'HostError', `raw error leaked: ${error.code} ${error.message}`);
        assert.equal(error.code, GM.ZIP_HEADER_MISMATCH);
        return true;
      }
    );
    const leftovers = await fs.readdir(`${directory}/tree-${attempt}`).catch(() => []);
    assert.deepEqual(leftovers, []);
  }
});

test('zip.js: descriptor digest drives the lightweight recovery check (§6.5)', async (t) => {
  const directory = await fs.mkdtemp(`${process.env.TMPDIR || '/tmp'}/dsh-zip-recovery-`);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pkg = buildPackage(filesWith({}));
  const zipPath = `${directory}/pkg.zip`;
  await fs.writeFile(zipPath, pkg.zip);
  const result = await extractPackageArchive({ zipPath, outDir: `${directory}/tree` });
  const record = { fileManifestDigest: result.fileManifestDigest, entry: result.entry };

  const healthy = await verifyPackageDirectory({ directory: `${directory}/tree`, record });
  assert.equal(healthy.ok, true);
  assert.equal(healthy.fileManifestDigest, result.fileManifestDigest);

  const tampered = await verifyPackageDirectory({
    directory: `${directory}/tree`,
    record: { ...record, fileManifestDigest: 'f'.repeat(64) },
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, 'file-manifest-digest');

  const missing = await verifyPackageDirectory({ directory: `${directory}/nowhere`, record });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'descriptor-missing');
});
