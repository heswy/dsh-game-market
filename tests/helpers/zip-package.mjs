/**
 * `asset-zip-v2` package fixtures for M1 tests.
 *
 * Builds complete, valid packages from an arbitrary file map (descriptor and
 * `game.json` included) and offers the mutation hooks the A03 matrix needs.
 * Every fixture is generated in memory: no committed binaries, so descriptor
 * sizes/sha256 always match the actual bytes.
 */

import { createHash } from 'node:crypto';

import { buildZip } from './zip-builder.mjs';

export const DESCRIPTOR_FILE = 'dsh-package.json';
export const MANIFEST_FILE = 'game.json';

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Compare strings by Unicode code point (== UTF-8 byte order for descriptor sorting). */
export function codePointCompare(a, b) {
  const left = Array.from(a);
  const right = Array.from(b);
  const max = Math.min(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const diff = left[index].codePointAt(0) - right[index].codePointAt(0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

/** A valid V1 `game.json` manifest (v1 semantics still apply inside a ZIP). */
export function buildGameManifest(overrides = {}) {
  return {
    manifestVersion: 1,
    id: 'orbit-courier',
    name: 'Orbit Courier',
    version: '1.0.0',
    author: { name: 'Test Studio' },
    description: 'A test resource package used by host tests.',
    categories: ['arcade'],
    capabilities: ['storage', 'score'],
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    score: { direction: 'higher-better', min: 0, max: 1000000, integer: true },
    save: { schemaVersion: 1 },
    ...overrides,
  };
}

export function buildEntryHtml({ script = 'scripts/main.js', extraHead = '', body = '<div id="app"></div>' } = {}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Orbit Courier</title>
    <link rel="stylesheet" href="styles/game.css" />
    ${extraHead}
  </head>
  <body>
    ${body}
    <script src="${script}"></script>
  </body>
</html>
`;
}

/** Default valid file map: descriptor is added by {@link buildPackage}. */
export function defaultFiles(overrides = {}) {
  const files = new Map([
    [MANIFEST_FILE, Buffer.from(JSON.stringify(buildGameManifest(), null, 2))],
    ['index.html', Buffer.from(buildEntryHtml())],
    ['scripts/main.js', Buffer.from("document.getElementById('app').textContent = 'ready';\n")],
    ['styles/game.css', Buffer.from('html, body { margin: 0; background: #0d1117; }\n')],
    ['levels/level-01.json', Buffer.from(JSON.stringify({ level: 'level-01', waves: 5 }, null, 2))],
  ]);
  for (const [path, value] of Object.entries(overrides)) {
    files.set(path, Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
  }
  return files;
}

/** Canonical descriptor for a file map (descriptor itself excluded). */
export function buildDescriptor(files, overrides = {}) {
  const entries = [...files.entries()]
    .map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256Hex(bytes) }))
    .sort((left, right) => codePointCompare(left.path, right.path));
  return {
    formatVersion: 2,
    entry: overrides.entry ?? 'index.html',
    gameManifest: MANIFEST_FILE,
    files: overrides.files ?? entries,
    ...(overrides.extra || {}),
  };
}

/**
 * Build the archive entry list (descriptor first) for a file map.
 *
 * Malicious tests append/replace entries to prove the policy layer rejects
 * exactly the mutated property.
 *
 * @param {Map<string, Buffer>|object} files Files excluding the descriptor.
 * @param {{descriptor?: object, descriptorText?: string}} [options]
 * @returns {{descriptor: object, descriptorText: string, entries: Array<object>}}
 */
export function packageEntries(files, options = {}) {
  const map = files instanceof Map ? files : defaultFiles(files);
  const descriptor = options.descriptor || buildDescriptor(map);
  const descriptorText = options.descriptorText || `${JSON.stringify(descriptor, null, 2)}\n`;
  return {
    descriptor,
    descriptorText,
    entries: [
      { name: DESCRIPTOR_FILE, data: Buffer.from(descriptorText, 'utf8') },
      ...[...map.entries()].map(([path, bytes]) => ({ name: path, data: bytes })),
    ],
  };
}

/**
 * Build a valid package ZIP from a file map.
 *
 * @param {Map<string, Buffer>|object} files Files excluding the descriptor.
 * @param {{descriptor?: object, method?: 0|8, descriptorText?: string,
 *          extraEntries?: Array<object>, entriesOverride?: Array<object>}} [options]
 * @returns {{zip: Buffer, files: Map<string, Buffer>, descriptor: object,
 *            descriptorText: string, manifest: object}}
 */
export function buildPackage(files, options = {}) {
  const map = files instanceof Map ? files : defaultFiles(files);
  const descriptor = options.descriptor || buildDescriptor(map);
  const descriptorText = options.descriptorText || `${JSON.stringify(descriptor, null, 2)}\n`;
  const descriptorBytes = Buffer.from(descriptorText, 'utf8');
  const method = options.method === 8 ? 8 : 0;
  const entries = [
    { name: DESCRIPTOR_FILE, data: descriptorBytes, method },
    ...[...map.entries()].map(([path, bytes]) => ({ name: path, data: bytes, method })),
    ...(options.extraEntries || []),
  ];
  if (Array.isArray(options.entriesOverride)) entries.splice(0, entries.length, ...options.entriesOverride);
  let manifest = null;
  try {
    manifest = JSON.parse(map.get(MANIFEST_FILE).toString('utf8'));
  } catch (_error) {
    manifest = null;
  }
  return {
    zip: buildZip(entries, options.zipOptions || {}),
    files: map,
    descriptor,
    descriptorText,
    manifest,
  };
}
