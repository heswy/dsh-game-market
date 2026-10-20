#!/usr/bin/env node
/**
 * Orbit Courier asset generator — deterministic PNG sprites and WAV one-shots.
 *
 * Everything is drawn/rendered in code so the repository never needs binary
 * source files: the same inputs always produce byte-identical PNG/WAV output
 * (fixed zlib level, fixed samples, no timestamps, no Math.random without a
 * seeded generator). `build.mjs` writes these buffers into `dist/assets` and
 * `dist/audio`, and both files end up in `dsh-package.json#files`.
 */

import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// PNG encoder (RGBA8, no dependency)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** Encode an RGBA buffer (width*height*4) as a PNG. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Tiny software rasterizer (supersampled 3x, then box-filtered down)
// ---------------------------------------------------------------------------

const SUPERSAMPLE = 3;

function createRaster(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

function blend(raster, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height || a <= 0) return;
  const index = (y * raster.width + x) * 4;
  const srcA = Math.min(1, a);
  const dstA = raster.data[index + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  raster.data[index] = Math.round((r * srcA + raster.data[index] * dstA * (1 - srcA)) / outA);
  raster.data[index + 1] = Math.round((g * srcA + raster.data[index + 1] * dstA * (1 - srcA)) / outA);
  raster.data[index + 2] = Math.round((b * srcA + raster.data[index + 2] * dstA * (1 - srcA)) / outA);
  raster.data[index + 3] = Math.round(outA * 255);
}

function fillCircle(raster, cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor(cx - radius - 1));
  const maxX = Math.min(raster.width - 1, Math.ceil(cx + radius + 1));
  const minY = Math.max(0, Math.floor(cy - radius - 1));
  const maxY = Math.min(raster.height - 1, Math.ceil(cy + radius + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, Math.min(1, radius - distance + 0.5));
      if (alpha > 0) blend(raster, x, y, color[0], color[1], color[2], color[3] === undefined ? 1 : color[3] * alpha);
    }
  }
}

function fillPolygon(raster, points, color) {
  if (points.length < 3) return;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.max(0, Math.floor(Math.min(...xs)) - 1);
  const maxX = Math.min(raster.width - 1, Math.ceil(Math.max(...xs)) + 1);
  const minY = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const maxY = Math.min(raster.height - 1, Math.ceil(Math.max(...ys)) + 1);
  for (let y = minY; y <= maxY; y += 1) {
    const sampleY = y + 0.5;
    const crossings = [];
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if ((a[1] <= sampleY && b[1] > sampleY) || (b[1] <= sampleY && a[1] > sampleY)) {
        const t = (sampleY - a[1]) / (b[1] - a[1]);
        crossings.push(a[0] + t * (b[0] - a[0]));
      }
    }
    crossings.sort((left, right) => left - right);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const from = Math.max(minX, Math.ceil(crossings[index] - 0.5));
      const to = Math.min(maxX, Math.floor(crossings[index + 1] - 0.5));
      for (let x = from; x <= to; x += 1) blend(raster, x, y, color[0], color[1], color[2], color[3] === undefined ? 1 : color[3]);
    }
  }
}

function downsample(raster, scale) {
  const width = Math.floor(raster.width / scale);
  const height = Math.floor(raster.height / scale);
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const index = ((y * scale + sy) * raster.width + (x * scale + sx)) * 4;
          const alpha = raster.data[index + 3] / 255;
          r += raster.data[index] * alpha;
          g += raster.data[index + 1] * alpha;
          b += raster.data[index + 2] * alpha;
          a += alpha;
        }
      }
      const outIndex = (y * width + x) * 4;
      if (a > 0) {
        out[outIndex] = Math.round(r / a);
        out[outIndex + 1] = Math.round(g / a);
        out[outIndex + 2] = Math.round(b / a);
      }
      out[outIndex + 3] = Math.round((a / (scale * scale)) * 255);
    }
  }
  return { width, height, data: out };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

/** Courier ship: warm gold hull, cyan cockpit, dark fins; points up by default. */
export function renderShip() {
  const size = 96;
  const raster = createRaster(size * SUPERSAMPLE, size * SUPERSAMPLE);
  const s = SUPERSAMPLE;
  const p = (x, y) => [x * s, y * s];

  // Outer hull with a darker rim for readability over the planet glow.
  fillPolygon(raster, [p(48, 4), p(58, 22), p(76, 56), p(62, 84), p(48, 70), p(34, 84), p(20, 56), p(38, 22)], [58, 34, 10, 1]);
  fillPolygon(raster, [p(48, 8), p(56, 24), p(71, 55), p(60, 78), p(48, 66), p(36, 78), p(25, 55), p(40, 24)], [246, 182, 74, 1]);
  // Hull highlight along the centre line.
  fillPolygon(raster, [p(48, 12), p(52, 26), p(52, 62), p(48, 70), p(44, 62), p(44, 26)], [255, 224, 160, 0.9]);
  // Fins.
  fillPolygon(raster, [p(21, 56), p(34, 84), p(31, 88), p(16, 66)], [120, 72, 26, 1]);
  fillPolygon(raster, [p(75, 56), p(62, 84), p(65, 88), p(80, 66)], [120, 72, 26, 1]);
  // Cockpit.
  fillCircle(raster, 48 * s, 34 * s, 8.5 * s, [36, 68, 120, 1]);
  fillCircle(raster, 48 * s, 34 * s, 6.5 * s, [95, 227, 255, 1]);
  fillCircle(raster, 46 * s, 32 * s, 2.4 * s, [235, 253, 255, 1]);
  // Engine bell.
  fillPolygon(raster, [p(43, 70), p(53, 70), p(51, 80), p(45, 80)], [70, 58, 60, 1]);
  fillCircle(raster, 48 * s, 78 * s, 3.2 * s, [255, 138, 61, 1]);
  return encodePng(size, size, downsample(raster, SUPERSAMPLE).data);
}

/** Cargo pod: golden hex crate with a dark strap and a highlight. */
export function renderPod() {
  const size = 64;
  const raster = createRaster(size * SUPERSAMPLE, size * SUPERSAMPLE);
  const s = SUPERSAMPLE;
  const p = (x, y) => [x * s, y * s];
  const hex = [p(32, 5), p(54, 18), p(54, 46), p(32, 59), p(10, 46), p(10, 18)];
  fillPolygon(raster, hex, [120, 66, 14, 1]);
  fillPolygon(raster, [p(32, 9), p(50, 20), p(50, 44), p(32, 55), p(14, 44), p(14, 20)], [255, 205, 107, 1]);
  fillPolygon(raster, [p(32, 14), p(44, 21), p(44, 30), p(32, 24), p(20, 30), p(20, 21)], [255, 233, 178, 0.85]);
  fillPolygon(raster, [p(28, 9), p(36, 9), p(36, 55), p(28, 55)], [138, 74, 16, 1]);
  fillPolygon(raster, [p(12, 30), p(52, 30), p(52, 36), p(12, 36)], [138, 74, 16, 1]);
  fillCircle(raster, 32 * s, 33 * s, 4.2 * s, [95, 227, 255, 1]);
  return encodePng(size, size, downsample(raster, SUPERSAMPLE).data);
}

/** Asteroid: irregular rock with craters, seeded so the sprite is fixed. */
export function renderAsteroid() {
  const size = 96;
  const raster = createRaster(size * SUPERSAMPLE, size * SUPERSAMPLE);
  const s = SUPERSAMPLE;
  const random = mulberry32(0x0a57e01d);
  const points = [];
  const vertices = 11;
  for (let index = 0; index < vertices; index += 1) {
    const angle = (index / vertices) * Math.PI * 2;
    const radius = (30 + random() * 12) * s;
    points.push([48 * s + Math.cos(angle) * radius, 48 * s + Math.sin(angle) * radius]);
  }
  fillPolygon(raster, points, [58, 62, 74, 1]);
  // Lit side.
  fillPolygon(raster, points.map(([x, y]) => [x - 3 * s, y - 3 * s]), [96, 100, 116, 0.65]);
  for (let index = 0; index < 5; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * 20 * s;
    const cx = 48 * s + Math.cos(angle) * distance;
    const cy = 48 * s + Math.sin(angle) * distance;
    fillCircle(raster, cx, cy, (2.5 + random() * 4) * s, [36, 39, 48, 0.9]);
  }
  return encodePng(size, size, downsample(raster, SUPERSAMPLE).data);
}

// ---------------------------------------------------------------------------
// WAV one-shots (44.1 kHz, 16-bit mono PCM)
// ---------------------------------------------------------------------------

export const SAMPLE_RATE = 44100;

function writeWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    data.writeInt16LE(Math.round(clamped * 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function seconds(duration, render) {
  const length = Math.round(SAMPLE_RATE * duration);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) samples[index] = render(index / SAMPLE_RATE, index, length);
  return samples;
}

function envelope(t, duration, attack = 0.008, release = 0.6) {
  const attackGain = Math.min(1, t / Math.max(attack, 1e-4));
  const releaseGain = Math.max(0, 1 - Math.max(0, t - duration * (1 - release)) / (duration * release));
  return attackGain * releaseGain;
}

/** Short bright ping used when a cargo pod is collected. */
export function renderCollectWav() {
  const duration = 0.12;
  const samples = seconds(duration, (t) => {
    const freq = 1180 + 420 * (t / duration);
    const gain = envelope(t, duration, 0.004, 0.85) * Math.exp(-t * 14);
    return Math.sin(2 * Math.PI * freq * t) * gain * 0.5;
  });
  return writeWav(samples);
}

/** Three-note chime for a normal delivery. */
export function renderDeliverWav() {
  const notes = [659.25, 880, 1318.5];
  const step = 0.075;
  const duration = 0.34;
  const samples = seconds(duration, (t) => {
    let value = 0;
    notes.forEach((frequency, index) => {
      const start = index * step;
      if (t < start) return;
      const local = t - start;
      value += Math.sin(2 * Math.PI * frequency * local) * Math.exp(-local * 9) * 0.32;
    });
    return value * envelope(t, duration, 0.004, 0.5);
  });
  return writeWav(samples);
}

/** Brighter, higher chime for a fast delivery (combo reward). */
export function renderFastWav() {
  const notes = [880, 1174.66, 1567.98, 2093];
  const step = 0.055;
  const duration = 0.36;
  const samples = seconds(duration, (t) => {
    let value = 0;
    notes.forEach((frequency, index) => {
      const start = index * step;
      if (t < start) return;
      const local = t - start;
      value += Math.sin(2 * Math.PI * frequency * local) * Math.exp(-local * 10) * 0.26;
    });
    return value * envelope(t, duration, 0.003, 0.5);
  });
  return writeWav(samples);
}

/** Low thud plus a short noise burst for a collision. */
export function renderHitWav() {
  const random = mulberry32(0x51a7c0de);
  const duration = 0.3;
  const samples = seconds(duration, (t) => {
    const gain = envelope(t, duration, 0.002, 0.7) * Math.exp(-t * 7);
    const body = Math.sin(2 * Math.PI * 82 * t) * 0.55;
    const noise = (random() * 2 - 1) * Math.exp(-t * 26) * 0.4;
    return (body + noise) * gain;
  });
  return writeWav(samples);
}

/** Rising sweep when a new act begins. */
export function renderActWav() {
  const duration = 0.5;
  const samples = seconds(duration, (t) => {
    const progress = t / duration;
    const frequency = 300 + 640 * progress * progress;
    const gain = envelope(t, duration, 0.02, 0.55) * 0.3;
    const shimmer = Math.sin(2 * Math.PI * frequency * 2.01 * t) * 0.25;
    return (Math.sin(2 * Math.PI * frequency * t) + shimmer) * gain;
  });
  return writeWav(samples);
}

/** Closing chord for the end-of-shift screen. */
export function renderEndWav() {
  const notes = [523.25, 659.25, 783.99];
  const duration = 0.9;
  const samples = seconds(duration, (t) => {
    let value = 0;
    notes.forEach((frequency, index) => {
      value += Math.sin(2 * Math.PI * frequency * t + index * 0.2) * 0.22;
    });
    return value * envelope(t, duration, 0.02, 0.6) * Math.exp(-t * 2.2);
  });
  return writeWav(samples);
}

/** All generated assets, keyed by their `dist/`-relative path. */
export function generateAssets() {
  return new Map([
    ['assets/courier-ship.png', renderShip()],
    ['assets/cargo-pod.png', renderPod()],
    ['assets/asteroid.png', renderAsteroid()],
    ['audio/collect.wav', renderCollectWav()],
    ['audio/deliver.wav', renderDeliverWav()],
    ['audio/deliver-fast.wav', renderFastWav()],
    ['audio/hit.wav', renderHitWav()],
    ['audio/act.wav', renderActWav()],
    ['audio/end.wav', renderEndWav()],
  ]);
}
