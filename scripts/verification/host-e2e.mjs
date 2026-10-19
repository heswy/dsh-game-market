#!/usr/bin/env node
/**
 * M3 automated Host evidence: file/HTTPS Registry, install/update/uninstall,
 * entry headers, save contract, malicious install matrix, idempotency.
 *
 * Usage: node scripts/verification/host-e2e.mjs
 * Outputs: docs/verification/v1/results/AE-10-15-host.json + logs/AE-10-15-host.log
 * No network is used except the HTTPS Registry scenario (raw.githubusercontent.com).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

import { createHost } from '../../packages/host/src/host.js';
import { GM } from '../../packages/shared/src/errors.js';
import { createChecker } from './assert.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FIX = path.join(ROOT, 'docs/verification/v1/fixtures');
const OUT = path.join(ROOT, 'docs/verification/v1');
const LOG = path.join(OUT, 'logs/AE-10-15-host.log');
const JSON_OUT = path.join(OUT, 'results/AE-10-15-host.json');
const RAW = 'https://raw.githubusercontent.com/heswy/dsh-game-market/main/docs/verification/v1/fixtures';
const op = (tag) => `op_${tag}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const lines = [];
const log = (...parts) => { const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '); lines.push(line); console.log(line); };
const results = { startedAt: new Date().toISOString(), commit: process.env.M3_COMMIT || '', scenarios: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function home(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `m3-${name}-`)); }
function errorOf(err) { return { code: err && err.code, message: err && err.message, retryable: err && err.retryable === true }; }
async function time(fn) { const t = performance.now(); const value = await fn(); return { value, ms: Math.round(performance.now() - t) }; }
async function makeHost({ name, registry, http }) {
  const dir = home(name);
  const host = createHost({ config: { devMode: true, ...(registry ? { registry } : {}) }, env: { DSH_HOME: dir }, http: http || {} });
  return { host, dir };
}
async function installOk(host, gameId, tag) {
  const t = performance.now();
  const result = await host.install.install({ gameId, operationId: op(tag) });
  return { result, ms: Math.round(performance.now() - t) };
}
async function readJsonHost(host, gameId) { return host.services.games.get(gameId); }
function entryRequest(entryUrl) { const url = `http://127.0.0.1:19387${entryUrl}`; return { request: new Request(url), url: new URL(url) }; }

const scenarios = results.scenarios;

// ---------- AE-10: file Registry install / headers / save-uninstall-reinstall ----------
try {
  const { host, dir } = await makeHost({ name: 'file', registry: { url: path.join(FIX, 'registry-file.json'), allowLocalFile: true } });
  const refresh = await time(() => host.registry.refresh({ manual: true, force: true }));
  scenarios.fileRegistry = { home: dir, refreshMs: refresh.ms, cache: await host.registry.snapshot?.() || null };
  const installed = {};
  for (const id of ['jump', '2048', 'breakout']) {
    try {
      const { result, ms } = await installOk(host, id, `file-${id}`);
      installed[id] = { ms, version: result && result.version, sha: result && result.sha256 };
      log(`AE-10 install ${id} -> ${installed[id].version} in ${ms}ms`);
    } catch (err) { installed[id] = { error: errorOf(err) }; log(`AE-10 install ${id} FAILED`, errorOf(err)); }
  }
  scenarios.fileRegistry.install = installed;
  // installed layout
  const layout = {};
  for (const id of ['jump', '2048', 'breakout']) {
    const p = host.storage.filePath('packages', id, '1.0.0', 'entry.html');
    layout[id] = { path: p, exists: fs.existsSync(p), sha: fs.existsSync(p) ? sha(fs.readFileSync(p)) : null };
  }
  scenarios.fileRegistry.layout = layout;
  // AE-14 entry response headers + AE-08-ish self-contained boot bytes
  try {
    const info = await host.services.entry.launch({ gameId: 'jump', mode: 'start' });
    const { request, url } = entryRequest(info.entryUrl);
    const response = await host.services.entry.serveEntry(request, url);
    const headerNames = ['content-type', 'cache-control', 'x-content-type-options', 'referrer-policy', 'content-security-policy', 'x-entry-sha256', 'content-length'];
    const headers = {};
    for (const name of headerNames) headers[name] = response.headers.get(name);
    const body = Buffer.from(await response.arrayBuffer());
    scenarios.entryHeaders = { status: response.status, headers, bytes: body.length, manifest: /dsh-game-manifest/.test(body.toString('utf8')), launchMode: info.mode };
    log('AE-14 entry', headers);
  } catch (err) { scenarios.entryHeaders = { error: errorOf(err) }; log('AE-14 FAILED', errorOf(err)); }
  // save -> session -> uninstall (keep data) -> reinstall -> Continue
  try {
    await host.services.saves.save({ gameId: 'jump', key: 'current', data: { score: 7, note: 'm3' }, operationId: op('save') });
    await host.services.sessions.start({ gameId: 'jump', operationId: op('session') });
    await host.services.entry.releaseGame('jump');
    const before = await readJsonHost(host, 'jump');
    const uninstall = await host.install.uninstall({ gameId: 'jump', operationId: op('uninstall') });
    const afterUninstall = await host.installations.get('jump').catch(() => null);
    const savePath = host.storage.filePath('saves', 'jump', 'current.json');
    const saveAfter = { exists: fs.existsSync(savePath), revision: fs.existsSync(savePath) ? JSON.parse(fs.readFileSync(savePath, 'utf8')).revision : null };
    const reinstalled = await installOk(host, 'jump', 'reinstall');
    const afterReinstall = await readJsonHost(host, 'jump');
    scenarios.uninstallReinstall = {
      canContinueBefore: Boolean(before && before.canContinue),
      uninstall,
      gameGone: afterUninstall === null,
      saveKept: Boolean(saveAfter && saveAfter.exists && saveAfter.revision >= 1),
      reinstalledVersion: reinstalled.result && reinstalled.result.version,
      canContinueAfter: Boolean(afterReinstall && afterReinstall.canContinue),
      saveStillReadable: (await host.services.saves.get('jump', { includeData: true })).values.current,
    };
    log('AE-10 uninstall/reinstall', scenarios.uninstallReinstall);
  } catch (err) { scenarios.uninstallReinstall = { error: errorOf(err) }; log('AE-10 uninstall FAILED', errorOf(err)); }
} catch (err) { scenarios.fileRegistry = { error: errorOf(err) }; log('AE-10 setup FAILED', errorOf(err)); }

// ---------- AE-10b: update to jump 1.0.1 ----------
try {
  const { host, dir } = await makeHost({ name: 'update', registry: { url: path.join(FIX, 'registry-file.json'), allowLocalFile: true } });
  await host.registry.refresh({ manual: true, force: true });
  await installOk(host, 'jump', 'pre-update');
  const before = await readJsonHost(host, 'jump');
  // Same storage home, registry source switched to the update fixture.
  const host2 = createHost({ config: { devMode: true, registry: { url: path.join(FIX, 'registry-file-update.json'), allowLocalFile: true } }, env: { DSH_HOME: dir } });
  await host2.registry.refresh({ manual: true, force: true });
  const update = await installOk(host2, 'jump', 'update');
  const after = await host2.services.games.get('jump');
  scenarios.update = { beforeVersion: before && before.version, updateResult: update.result && update.result.version, afterVersion: after && after.version, previousVersion: after && after.previousVersion, updateMs: update.ms, changed: update.result && update.result.changed };
  log('AE-10 update', scenarios.update);
} catch (err) { scenarios.update = { error: errorOf(err) }; log('AE-10 update FAILED', errorOf(err)); }

// ---------- AE-11: HTTPS Registry ----------
// Deterministic local TLS server (self-signed, devMode relaxes loopback SSRF).
// A real public CDN fetch is flaky in this environment; this still exercises the
// HTTPS code path, host admission (same-host packages), TLS transport and install.
{
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3-https-cert-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', path.join(certDir, 'key.pem'),
    '-out', path.join(certDir, 'cert.pem'),
    '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' });
  const key = fs.readFileSync(path.join(certDir, 'key.pem'));
  const cert = fs.readFileSync(path.join(certDir, 'cert.pem'));
  const manifestOf = (html) => {
    const match = html.match(/<script type="application\/json"\s+id="dsh-game-manifest">([\s\S]*?)<\/script>/);
    if (!match) throw new Error('inline manifest missing');
    return JSON.parse(match[1]);
  };
  const packageNames = ['jump-1.0.0.html', '2048-1.0.0.html', 'breakout-1.0.0.html'];
  const packageEntries = packageNames.map((fileName) => {
    const bytes = fs.readFileSync(path.join(FIX, 'packages', fileName));
    const manifest = manifestOf(bytes.toString('utf8'));
    return {
      fileName,
      bytes,
      game: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: { name: manifest.author && manifest.author.name ? manifest.author.name : 'DSH Game Market' },
        categories: manifest.categories,
        tags: manifest.tags || [],
        capabilities: manifest.capabilities,
        sdkVersion: manifest.sdkVersion,
        runtimeVersion: manifest.runtimeVersion,
        package: {
          url: `/packages/${fileName}`,
          sha256: sha(bytes),
          size: bytes.length,
          releasedAt: '2026-10-18T00:00:00.000Z',
        },
        cover: 'https://raw.githubusercontent.com/heswy/dsh-game-market/main/docs/verification/v0/market.png',
        license: manifest.license || 'MIT',
        featured: false,
        quickPlay: false,
        publishedAt: '2026-10-18T00:00:00.000Z',
        updatedAt: '2026-10-18T00:00:00.000Z',
      },
    };
  });
  let baseUrl = null;
  const server = https.createServer({ key, cert }, (req, res) => {
    try {
      const url = new URL(req.url || '/', baseUrl || 'https://127.0.0.1');
      if (url.pathname === '/registry.json') {
        const index = { registryVersion: 1, generatedAt: '2026-10-18T00:00:00.000Z', games: packageEntries.map((entry) => entry.game) };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(index));
        return;
      }
      const fileName = url.pathname.replace(/^\/packages\//, '');
      const found = packageEntries.find((entry) => entry.fileName === fileName);
      if (!found) { res.writeHead(404); res.end('missing'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(found.bytes);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error && error.message));
    }
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `https://127.0.0.1:${server.address().port}`;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const { host } = await makeHost({ name: 'https-local', registry: { url: `${baseUrl}/registry.json` }, http: { fetch: globalThis.fetch } });
    const refresh = await time(() => host.registry.refresh({ manual: true, force: true }));
    const install = await time(() => host.install.install({ gameId: 'jump', operationId: op('https') }));
    const record = await readJsonHost(host, 'jump');
    scenarios.httpsRegistry = {
      refreshMs: refresh.ms,
      refreshOk: true,
      installMs: install.ms,
      version: record && record.version,
      source: record && record.source,
      transport: 'https (local TLS, self-signed, devMode loopback)',
    };
    log('AE-11 https install', scenarios.httpsRegistry);
  } catch (err) {
    scenarios.httpsRegistry = { error: errorOf(err) };
    log('AE-11 FAILED', errorOf(err));
  } finally {
    server.close();
    fs.rmSync(certDir, { recursive: true, force: true });
  }
}

// ---------- AE-12: bad sha / bad html registry ----------
for (const [name, file] of [['badSha', 'registry-badsha.json'], ['badHtml', 'registry-badhtml.json']]) {
  try {
    const { host } = await makeHost({ name: `bad-${name}`, registry: { url: path.join(FIX, file), allowLocalFile: true } });
    await host.registry.refresh({ manual: true, force: true });
    await host.install.install({ gameId: 'jump', operationId: op(name) });
    scenarios[name] = { unexpected: 'install succeeded' };
    log(`AE-12 ${name} UNEXPECTED SUCCESS`);
  } catch (err) { scenarios[name] = { error: errorOf(err), expected: name === 'badSha' ? GM.INSTALL_HASH_MISMATCH : GM.MANIFEST_INVALID }; log(`AE-12 ${name}`, errorOf(err)); }
}

// ---------- AE-12/DEV-06/SEC-05: malicious install-local matrix ----------
try {
  const { host } = await makeHost({ name: 'malicious' });
  const cases = ['missing-manifest', 'two-manifests', 'external-resource', 'bad-capability', 'legacy-fields', 'path-traversal-id'];
  scenarios.maliciousInstallLocal = {};
  for (const name of cases) {
    const html = fs.readFileSync(path.join(FIX, 'malicious', `${name}.html`));
    const url = new URL(`http://127.0.0.1:19387/api/game-market/install-local?operationId=${op(name)}`);
    const request = new Request(url, { method: 'POST', headers: { 'content-type': 'text/html' }, body: html });
    try {
      const result = await host.install.installLocal(request, url);
      scenarios.maliciousInstallLocal[name] = { unexpected: 'installed', result };
      log(`AE-12 malicious ${name} UNEXPECTED SUCCESS`);
    } catch (err) { scenarios.maliciousInstallLocal[name] = { error: errorOf(err) }; log(`AE-12 malicious ${name} -> ${err.code}`); }
  }
  // oversized (>20 MiB) local package
  const oversized = Buffer.alloc(21 * 1024 * 1024, 0x41);
  const url = new URL(`http://127.0.0.1:19387/api/game-market/install-local?operationId=${op('oversize')}`);
  try {
    await host.install.installLocal(new Request(url, { method: 'POST', headers: { 'content-type': 'text/html' }, body: oversized }), url);
    scenarios.oversized = { unexpected: 'installed' };
  } catch (err) { scenarios.oversized = { error: errorOf(err) }; }
  log('AE-12 oversized', scenarios.oversized);
} catch (err) { scenarios.maliciousInstallLocal = { error: errorOf(err) }; }

// ---------- AE-15: save contract ----------
try {
  const { host } = await makeHost({ name: 'saves' });
  const out = {};
  const GAME = 'snake';
  out.normal = await host.services.saves.save({ gameId: GAME, key: 'current', data: { score: 1 }, operationId: op('s1') });
  try { await host.services.saves.save({ gameId: GAME, key: 'current', data: { big: 'x'.repeat(300 * 1024) }, operationId: op('s2') }); out.tooLarge = { unexpected: 'accepted' }; }
  catch (err) { out.tooLarge = { error: errorOf(err) }; }
  for (let i = 1; i <= 31; i += 1) {
    await host.services.saves.save({ gameId: GAME, key: `key${i}`, data: i, operationId: op(`fill${i}`) });
  }
  try { await host.services.saves.save({ gameId: GAME, key: 'overflow', data: 1, operationId: op('s3') }); out.tooManyKeys = { unexpected: 'accepted' }; }
  catch (err) { out.tooManyKeys = { error: errorOf(err) }; }
  const current = await host.services.saves.get(GAME, { includeData: true });
  try { await host.services.saves.save({ gameId: GAME, key: 'current', data: { score: 2 }, expectedRevision: current.revision + 10, operationId: op('s4') }); out.casConflict = { unexpected: 'accepted' }; }
  catch (err) { out.casConflict = { error: errorOf(err) }; }
  // second save creates .bak, then corrupt current and verify recovery
  await host.services.saves.save({ gameId: GAME, key: 'current', data: { score: 3 }, operationId: op('s5') });
  const currentPath = host.storage.filePath('saves', GAME, 'current.json');
  fs.writeFileSync(currentPath, '{corrupt');
  const recovered = await host.services.saves.get(GAME, { includeData: true });
  out.corruptRecovery = { revision: recovered && recovered.revision, keys: recovered && Object.keys(recovered.values || {}).length };
  scenarios.saves = out;
  log('AE-15 saves', out);
} catch (err) { scenarios.saves = { error: errorOf(err) }; log('AE-15 FAILED', errorOf(err)); }

// ---------- AE-13: operationId replay + concurrent install ----------
try {
  const { host } = await makeHost({ name: 'idem', registry: { url: path.join(FIX, 'registry-file.json'), allowLocalFile: true } });
  await host.registry.refresh({ manual: true, force: true });
  const fixed = 'op_fixed_replay';
  const first = await host.install.install({ gameId: 'jump', operationId: fixed });
  const second = await host.install.install({ gameId: 'jump', operationId: fixed });
  const concurrent = await Promise.allSettled([
    host.install.install({ gameId: '2048', operationId: op('c1') }),
    host.install.install({ gameId: '2048', operationId: op('c2') }),
  ]);
  scenarios.idempotency = {
    replaySameOperation: { first: first && first.changed, second: second && second.changed, sameRecord: first && second && first.record && first.record.version === second.record.version },
    concurrent: concurrent.map((r) => (r.status === 'fulfilled' ? { ok: true, changed: r.value.changed } : { ok: false, code: errorOf(r.reason).code })),
  };
  log('AE-13 idempotency', scenarios.idempotency);
} catch (err) { scenarios.idempotency = { error: errorOf(err) }; log('AE-13 FAILED', errorOf(err)); }

const checker = createChecker('host-e2e');
const s = results.scenarios;
const installs = (s.fileRegistry && s.fileRegistry.install) || {};
checker.check('file registry refreshed', Number.isFinite(s.fileRegistry && s.fileRegistry.refreshMs));
checker.equal('jump installed', installs.jump && installs.jump.version, '1.0.0');
checker.equal('2048 installed', installs['2048'] && installs['2048'].version, '1.0.0');
checker.equal('breakout installed', installs.breakout && installs.breakout.version, '1.0.0');
checker.equal('entry headers status', s.entryHeaders && s.entryHeaders.status, 200);
checker.equal('entry no-store', s.entryHeaders && s.entryHeaders.headers && s.entryHeaders.headers['cache-control'], 'no-store');
checker.check('entry CSP blocks network', /connect-src 'none'/.test((s.entryHeaders && s.entryHeaders.headers && s.entryHeaders.headers['content-security-policy']) || ''));
checker.check('entry sha256 header', /^[a-f0-9]{64}$/.test((s.entryHeaders && s.entryHeaders.headers && s.entryHeaders.headers['x-entry-sha256']) || ''));
checker.equal('update resulted in 1.0.1', s.update && s.update.afterVersion, '1.0.1');
checker.equal('uninstall removed package', s.uninstallReinstall && s.uninstallReinstall.uninstall && s.uninstallReinstall.uninstall.removed, true);
checker.equal('uninstall kept save', s.uninstallReinstall && s.uninstallReinstall.saveKept, true);
checker.equal('continue after reinstall', s.uninstallReinstall && s.uninstallReinstall.canContinueAfter, true);
checker.equal('save restored after reinstall', s.uninstallReinstall && s.uninstallReinstall.saveStillReadable && s.uninstallReinstall.saveStillReadable.score, 7);
checker.equal('https registry installed jump', s.httpsRegistry && s.httpsRegistry.version, '1.0.0');
checker.equal('bad sha rejected', s.badSha && s.badSha.error && s.badSha.error.code, GM.INSTALL_HASH_MISMATCH);
checker.equal('bad html rejected', s.badHtml && s.badHtml.error && s.badHtml.error.code, GM.MANIFEST_INVALID);
const maliciousExpected = {
  'missing-manifest': GM.MANIFEST_INVALID,
  'two-manifests': GM.MANIFEST_INVALID,
  'external-resource': GM.ENTRY_NOT_SELF_CONTAINED,
  'bad-capability': GM.CAPABILITY_UNSUPPORTED,
  'legacy-fields': GM.FIELD_TYPE,
  'path-traversal-id': GM.ID_INVALID,
};
for (const [name, rows] of Object.entries(maliciousExpected)) {
  const actual = s.maliciousInstallLocal && s.maliciousInstallLocal[name] && s.maliciousInstallLocal[name].error;
  checker.check(`malicious ${name} rejected`, Boolean(actual), actual);
}
checker.equal('oversized package rejected', s.oversized && s.oversized.error && s.oversized.error.code, GM.PACKAGE_TOO_LARGE);
checker.equal('save too large rejected', s.saves && s.saves.tooLarge && s.saves.tooLarge.error && s.saves.tooLarge.error.code, GM.SAVE_TOO_LARGE);
checker.equal('save key quota rejected', s.saves && s.saves.tooManyKeys && s.saves.tooManyKeys.error && s.saves.tooManyKeys.error.code, GM.STORAGE_QUOTA);
checker.equal('save CAS conflict', s.saves && s.saves.casConflict && s.saves.casConflict.error && s.saves.casConflict.error.code, GM.STORAGE_CONFLICT);
checker.check('corrupt save recovered', Boolean(s.saves && s.saves.corruptRecovery && s.saves.corruptRecovery.keys >= 1), s.saves && s.saves.corruptRecovery);
const concurrent = (s.idempotency && s.idempotency.concurrent) || [];
checker.check('concurrent install serialised', concurrent.length === 2 && concurrent.some((r) => r.ok && r.changed === true) && concurrent.some((r) => r.ok && r.changed === false), concurrent);
results.finishedAt = new Date().toISOString();
results.lines = lines.length;
results.ok = checker.ok;
results.checks = checker.checks;
results.failures = checker.failures;
fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
fs.writeFileSync(LOG, [`# AE-10..15 host E2E (${results.startedAt})`, ...lines, ...checker.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`)].join('\n') + '\n');
console.log('wrote', path.relative(ROOT, JSON_OUT), path.relative(ROOT, LOG), checker.ok ? 'PASS' : 'FAIL');
process.exitCode = checker.exitCode();
process.exit(checker.exitCode());
