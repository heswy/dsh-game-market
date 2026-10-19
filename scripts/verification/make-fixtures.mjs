#!/usr/bin/env node
/**
 * M3 verification fixtures: file/https test registries + malicious packages.
 *
 * Usage: node scripts/verification/make-fixtures.mjs
 * Output: docs/verification/v1/fixtures/{registry-*.json,packages/*.html,malicious/*.html}
 * The HTTPS registry points at raw.githubusercontent.com paths, so fixtures must
 * be committed & pushed before that registry can be fetched by the Host.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FIX = path.join(ROOT, 'docs/verification/v1/fixtures');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const now = new Date().toISOString();
const COVER = 'https://raw.githubusercontent.com/heswy/dsh-game-market/main/docs/verification/v0/market.png';

function manifestOf(html) {
  const match = html.match(/<script type="application\/json"\s+id="dsh-game-manifest">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('inline manifest not found');
  return JSON.parse(match[1]);
}
function replaceManifest(html, transform) {
  const re = /<script type="application\/json"\s+id="dsh-game-manifest">([\s\S]*?)<\/script>/;
  return html.replace(re, (whole, json) => {
    const next = JSON.stringify(transform(JSON.parse(json)));
    return whole.replace(json, next);
  });
}
function entry({ id, version, url, sha256, size, manifest, quickPlay = false }) {
  return {
    id,
    name: manifest.name,
    version,
    description: manifest.description,
    author: { name: (manifest.author && manifest.author.name) || 'DSH Game Market' },
    categories: manifest.categories,
    tags: manifest.tags || [],
    capabilities: manifest.capabilities,
    sdkVersion: manifest.sdkVersion,
    runtimeVersion: manifest.runtimeVersion,
    ...(manifest.preferredTheme ? { preferredTheme: manifest.preferredTheme } : {}),
    package: { url, sha256, size, releasedAt: now },
    cover: COVER,
    license: manifest.license || 'MIT',
    quickPlay,
    publishedAt: now,
    updatedAt: now,
  };
}
const index = (games) => ({ registryVersion: 1, generatedAt: now, games });

fs.mkdirSync(path.join(FIX, 'packages'), { recursive: true });
fs.mkdirSync(path.join(FIX, 'malicious'), { recursive: true });

const packages = {};
for (const id of ['jump', '2048', 'breakout']) {
  const buf = fs.readFileSync(path.join(ROOT, 'games', id, 'dist/index.html'));
  const file = `${id}-1.0.0.html`;
  fs.writeFileSync(path.join(FIX, 'packages', file), buf);
  packages[id] = { file, sha: sha(buf), size: buf.length, manifest: manifestOf(buf.toString('utf8')) };
}

// Update fixture: bump jump to 1.0.1 inside the inline manifest only.
const jump101 = replaceManifest(fs.readFileSync(path.join(ROOT, 'games/jump/dist/index.html'), 'utf8'), (m) => ({ ...m, version: '1.0.1' }));
fs.writeFileSync(path.join(FIX, 'packages/jump-1.0.1.html'), jump101);
const jump101Sha = sha(Buffer.from(jump101));

// DEV-01 output (optional): the CLI-generated my-game package, if present.
const cliGamePath = '/tmp/m3-dev/my-game/dist/my-game-1.0.0.html';
let myGameEntry = null;
if (fs.existsSync(cliGamePath)) {
  const buf = fs.readFileSync(cliGamePath);
  fs.writeFileSync(path.join(FIX, 'packages/my-game-1.0.0.html'), buf);
  myGameEntry = entry({ id: 'my-game', version: '1.0.0', url: 'packages/my-game-1.0.0.html', sha256: sha(buf), size: buf.length, manifest: manifestOf(buf.toString('utf8')) });
}

const fileEntries = [
  entry({ id: 'jump', version: '1.0.0', url: `packages/${packages.jump.file}`, sha256: packages.jump.sha, size: packages.jump.size, manifest: packages.jump.manifest, quickPlay: true }),
  entry({ id: '2048', version: '1.0.0', url: `packages/${packages['2048'].file}`, sha256: packages['2048'].sha, size: packages['2048'].size, manifest: packages['2048'].manifest }),
  entry({ id: 'breakout', version: '1.0.0', url: `packages/${packages.breakout.file}`, sha256: packages.breakout.sha, size: packages.breakout.size, manifest: packages.breakout.manifest }),
  ...(myGameEntry ? [myGameEntry] : []),
];
const rawBase = 'https://raw.githubusercontent.com/heswy/dsh-game-market/main/docs/verification/v1/fixtures/packages/';
const httpsEntries = [
  entry({ id: 'jump', version: '1.0.0', url: `${rawBase}jump-1.0.0.html`, sha256: packages.jump.sha, size: packages.jump.size, manifest: packages.jump.manifest, quickPlay: true }),
  entry({ id: '2048', version: '1.0.0', url: `${rawBase}2048-1.0.0.html`, sha256: packages['2048'].sha, size: packages['2048'].size, manifest: packages['2048'].manifest }),
  entry({ id: 'breakout', version: '1.0.0', url: `${rawBase}breakout-1.0.0.html`, sha256: packages.breakout.sha, size: packages.breakout.size, manifest: packages.breakout.manifest }),
];
fs.writeFileSync(path.join(FIX, 'registry-file.json'), JSON.stringify(index(fileEntries), null, 2));
fs.writeFileSync(path.join(FIX, 'registry-file-update.json'), JSON.stringify(index([
  entry({ id: 'jump', version: '1.0.1', url: 'packages/jump-1.0.1.html', sha256: jump101Sha, size: Buffer.byteLength(jump101, 'utf8'), manifest: { ...packages.jump.manifest, version: '1.0.1' }, quickPlay: true }),
  ...fileEntries.filter((item) => item.id !== 'jump'),
]), null, 2));
fs.writeFileSync(path.join(FIX, 'registry-https.json'), JSON.stringify(index(httpsEntries), null, 2));
fs.writeFileSync(path.join(FIX, 'registry-badsha.json'), JSON.stringify(index([
  { ...fileEntries[0], package: { ...fileEntries[0].package, sha256: '0'.repeat(64) } },
]), null, 2));
// Non-HTML content with a valid <id>-<version>.html filename (registry url rule).
const badHtml = Buffer.from('<html><body>not a game package</body></html>');
fs.mkdirSync(path.join(FIX, 'badhtml'), { recursive: true });
fs.writeFileSync(path.join(FIX, 'badhtml/jump-1.0.0.html'), badHtml);
fs.writeFileSync(path.join(FIX, 'registry-badhtml.json'), JSON.stringify(index([
  { ...fileEntries[0], package: { ...fileEntries[0].package, url: 'badhtml/jump-1.0.0.html', sha256: sha(badHtml), size: badHtml.length } },
]), null, 2));

// Malicious local-install packages (install-local route).
const jumpManifest = packages.jump.manifest;
const withManifest = (obj) => `<!doctype html><html><body><script type="application/json" id="dsh-game-manifest">${JSON.stringify(obj)}</script></body></html>`;
const variant = (over) => ({ ...jumpManifest, ...over });
fs.writeFileSync(path.join(FIX, 'malicious/missing-manifest.html'), '<!doctype html><html><body>hello</body></html>');
fs.writeFileSync(path.join(FIX, 'malicious/two-manifests.html'), `${withManifest(variant({ id: 'two-manifests' }))}<script type="application/json" id="dsh-game-manifest">${JSON.stringify(variant({ id: 'two-manifests' }))}</script>`);
fs.writeFileSync(path.join(FIX, 'malicious/external-resource.html'), withManifest(variant({ id: 'external-resource' })).replace('</body>', '<script src="https://evil.example.com/x.js"></script></body>'));
fs.writeFileSync(path.join(FIX, 'malicious/bad-capability.html'), withManifest(variant({ id: 'bad-capability', capabilities: ['network'] })));
fs.writeFileSync(path.join(FIX, 'malicious/legacy-fields.html'), withManifest({ id: 'legacy-fields', name: 'Legacy', version: '1.0.0', main: 'index.html' }));
fs.writeFileSync(path.join(FIX, 'malicious/path-traversal-id.html'), withManifest(variant({ id: '../evil' })));
console.log(`fixtures written to ${path.relative(ROOT, FIX)}`);
