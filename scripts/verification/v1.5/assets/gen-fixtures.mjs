#!/usr/bin/env node
/**
 * M0 S-A1 fixture package generator.
 *
 * Produces the binary assets (PNG sprite, WAV sound) of the multi-file probe
 * package deterministically with Node built-ins only, then writes
 * `fixture-package/dsh-package.json` — the per-file size/sha256 manifest the
 * probe resource service uses as its only path allowlist (mirrors the
 * `asset-zip-v2` plan in docs/plans/2026-10-19-v1.5-public-launch.md §4.1).
 *
 * Text files are authored by hand; running this script is idempotent and only
 * rewrites bytes. `--check` verifies the existing manifest and files match a
 * fresh build without writing anything (used by the probe preflight).
 *
 * Usage:
 *   node scripts/verification/v1.5/assets/gen-fixtures.mjs
 *   node scripts/verification/v1.5/assets/gen-fixtures.mjs --check
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ROOT = path.join(HERE, 'fixture-package');
/** Files authored in the repository; order is fixed so the manifest is stable. */
export const TEXT_FILES = Object.freeze([
  'index.html',
  'game.json',
  'scripts/bootstrap.js',
  'scripts/main.js',
  'scripts/level-loader.mjs',
  'scripts/powerup.mjs',
  'styles/game.css',
  'levels/level-01.json',
]);
export const BINARY_FILES = Object.freeze(['assets/ship.png', 'assets/pickup.wav']);
export const MANIFEST_FILE = 'dsh-package.json';

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

// ---------------------------------------------------------------------------
// Deterministic PNG (no dependencies): 64x64 RGBA "ship" sprite.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** Draw the ship sprite: transparent sky, cyan hull wedge, orange cockpit. */
function buildShipPng({ width = 64, height = 64 } = {}) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      let rgba = [0, 0, 0, 0];
      // Hull: a triangle pointing up, with a bright outline.
      const edge = Math.abs(x - width / 2);
      const hullTop = 8;
      const hullBottom = 52;
      if (y >= hullTop && y <= hullBottom) {
        const halfWidth = ((y - hullTop) / (hullBottom - hullTop)) * (width / 2 - 4) + 2;
        if (edge <= halfWidth) {
          const outline = edge > halfWidth - 2 || y > hullBottom - 3;
          rgba = outline ? [190, 245, 255, 255] : [46, 160, 210, 255];
        }
      }
      // Cockpit.
      const cockpit = Math.abs(x - width / 2) < 6 && y > 20 && y < 32;
      if (cockpit) rgba = [255, 170, 60, 255];
      // Engine glow.
      if (y > 52 && y < 60 && edge < 7) rgba = [255, 120, 40, 190];
      raw[offset] = rgba[0];
      raw[offset + 1] = rgba[1];
      raw[offset + 2] = rgba[2];
      raw[offset + 3] = rgba[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Deterministic 16-bit PCM WAV: 0.20s 440 Hz pickup blip at 8 kHz mono.
// ---------------------------------------------------------------------------

function buildPickupWav({ sampleRate = 8000, durationS = 0.2, freq = 440 } = {}) {
  const samples = Math.round(sampleRate * durationS);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    // Short fade-in/out avoids clicks; integer sample keeps bytes stable.
    const envelope = Math.min(1, i / (sampleRate * 0.02), (samples - i) / (sampleRate * 0.05));
    const value = Math.round(Math.sin(2 * Math.PI * freq * t) * envelope * 0.35 * 32767);
    data.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export const BINARY_BUILDERS = Object.freeze({
  'assets/ship.png': buildShipPng,
  'assets/pickup.wav': buildPickupWav,
});

// ---------------------------------------------------------------------------
// Package manifest (`dsh-package.json`)
// ---------------------------------------------------------------------------

export function buildManifest() {
  const files = [];
  for (const rel of [...TEXT_FILES, ...BINARY_FILES].sort()) {
    const bytes = fs.readFileSync(path.join(FIXTURE_ROOT, rel));
    files.push({ path: rel, size: bytes.length, sha256: sha256(bytes) });
  }
  return {
    formatVersion: 2,
    entry: 'index.html',
    gameManifest: 'game.json',
    files,
  };
}

/**
 * Ensure the binary assets and manifest exist. Text files must already be in
 * the repository; a missing one is a hard error (never generated silently).
 */
export function ensureFixturePackage() {
  for (const rel of TEXT_FILES) {
    const file = path.join(FIXTURE_ROOT, rel);
    if (!fs.existsSync(file)) throw new Error(`fixture source file is missing: ${rel}`);
  }
  const written = [];
  for (const [rel, build] of Object.entries(BINARY_BUILDERS)) {
    const file = path.join(FIXTURE_ROOT, rel);
    const bytes = build();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) {
      fs.writeFileSync(file, bytes);
      written.push(rel);
    }
  }
  const manifest = buildManifest();
  const manifestPath = path.join(FIXTURE_ROOT, MANIFEST_FILE);
  const serialised = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== serialised) {
    fs.writeFileSync(manifestPath, serialised, 'utf8');
    written.push(MANIFEST_FILE);
  }
  return { manifest, written };
}

/** Read + verify the fixture manifest, without writing anything. */
export function checkFixturePackage() {
  const manifestPath = path.join(FIXTURE_ROOT, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return { ok: false, reason: 'manifest-missing' };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const problems = [];
  for (const rel of TEXT_FILES) {
    if (!manifest.files.some((file) => file.path === rel)) problems.push(`not-in-manifest:${rel}`);
  }
  const expected = new Map();
  for (const rel of TEXT_FILES) expected.set(rel, fs.readFileSync(path.join(FIXTURE_ROOT, rel)));
  for (const [rel, build] of Object.entries(BINARY_BUILDERS)) expected.set(rel, build());
  if (manifest.files.length !== expected.size) problems.push(`manifest-file-count:${manifest.files.length}!=${expected.size}`);
  for (const entry of manifest.files) {
    const bytes = expected.get(entry.path);
    if (!bytes) {
      problems.push(`unexpected:${entry.path}`);
      continue;
    }
    if (bytes.length !== entry.size) problems.push(`size:${entry.path}`);
    if (sha256(bytes) !== entry.sha256) problems.push(`sha256:${entry.path}`);
  }
  return { ok: problems.length === 0, problems, manifest, bytes: expected };
}

function main() {
  const check = process.argv.includes('--check');
  if (check) {
    const result = checkFixturePackage();
    process.stdout.write(`${JSON.stringify({ ok: result.ok, problems: result.problems ?? [] }, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  const { manifest, written } = ensureFixturePackage();
  process.stdout.write(`${JSON.stringify({ ok: true, written, files: manifest.files }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
