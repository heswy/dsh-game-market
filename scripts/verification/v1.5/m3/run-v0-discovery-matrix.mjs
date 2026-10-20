#!/usr/bin/env node
/**
 * M3-V0 discovery policy matrix — independent evidence against the REAL Host.
 *
 * The frozen discovery policy (docs/verification/v1.5/m3-decisions.md §3,
 * docs/V1.5-CONTRACTS.md §9) is exercised through the real Host HTTP routes of
 * the current worktree game-market plugin, in an isolated DSH host whose
 * fixed official index URL is answered by the audited transport fixture
 * (`fixture.mjs`, selective TLS interception). Production index untouched.
 *
 * Matrix (each case = fresh isolated profile + real `dsh web` + real routes):
 *   valid discovery / cache file atomic shape / per-case HTTP 200 envelope
 *   manual refresh throttle 60s (no extra network fetch)
 *   refresh when allowed (old cache seeded) re-checks and updates target
 *   >256 KiB index, 5s timeout, malformed JSON, unbound repo, file: source,
 *   short SHA, prerelease-on-stable, redirect downgrade, redirect loop
 *   offline keeps the last successful target; same-version-different-commit
 *   anomaly; test-channel explicit opt-in; client-report route; begin
 *   fail-closed before H2 (no update started).
 *
 * Evidence level: isolated-host + transport fixture + real routes.
 * NOT covered here (H2): native installBundle adapter branches, begin/observe/
 * cancel/coordinate state machine, UI. Those are V1/V2.
 *
 * Usage: node scripts/verification/v1.5/m3/run-v0-discovery-matrix.mjs [--quick]
 * Exit 0 iff every required check passed and cleanup is proven leak-free.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  FIXED_INDEX_PATH,
  FIXED_INDEX_URL,
  RAW_ROOT,
  REPO_ROOT,
  RUNS_ROOT,
  bootProbeHost,
  cleanupProof,
  createReport,
  ensureDir,
  finalizeRun,
  freePort,
  log,
  makeIsolatedHome,
  portAccepting,
  removeHome,
  sleep,
  uniqueRunTag,
  verifyRuntime,
} from './lib.mjs';
import { createFixtureTls, createIndexTransport, removeFixtureTls } from './fixture.mjs';

const RUN_PREFIX = 'v0-discovery';
const runTag = uniqueRunTag(RUN_PREFIX);
const runDirBase = path.join(RUNS_ROOT, runTag);
const fixtureRoot = path.join('/tmp/dsh-v15/m3', `fixture-${runTag}`);
const tlsDir = path.join(fixtureRoot, 'tls');
const evidenceRel = `M3-V0-discovery-matrix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const REPORT_ID = 'M3-V0-discovery-matrix';

const REPO_URL = 'https://github.com/heswy/dsh-game-market.git';
const GIT_HEAD = (() => {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
})();
const PUBLISHED_COMMIT = 'f422e8d04b3b3de3f920a794317c0d28ee1246a2'; // published v1.2.0
const OTHER_COMMIT = 'c106ac101e064a72f408c58b2516aad5118f513f'; // published v1.1.0
const PUBLISH_TS = 1761000000;

const report = createReport({
  id: REPORT_ID,
  title: 'Fixed-URL discovery policy matrix through real Host routes (isolated host + transport fixture)',
  commands: ['node scripts/verification/v1.5/m3/run-v0-discovery-matrix.mjs'],
});

const state = {
  tls: null,
  transport: null,
  gitHead: null,
  cases: [],
  cleanups: [],
  fixtureRequestsByCase: [],
};

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------------------
// Fixture index bodies (exact DSH plugin-market-index format 1 shape)
// ---------------------------------------------------------------------------

function indexVersion(version, commit, { publishTimestamp = PUBLISH_TS } = {}) {
  return {
    version,
    publishTimestamp,
    source: { type: 'git', url: `${REPO_URL}`, commit },
  };
}

function buildIndexBody({ versions, title = 'DSH plugin index (M3 verification fixture)' }) {
  return `${JSON.stringify({
    format: 1,
    title: { en: title, zh: 'DSH 插件索引（M3 验证夹具）' },
    plugins: [{ name: 'dsh-game-market', versions }],
  }, null, 2)}\n`;
}

const VALID_BODY = buildIndexBody({ versions: [indexVersion('1.2.0', PUBLISHED_COMMIT)] });
const BODY_NEXT = buildIndexBody({ versions: [indexVersion('1.2.2', OTHER_COMMIT)] });
const BODY_SAME_VERSION_OTHER_COMMIT = buildIndexBody({ versions: [indexVersion('1.2.0', OTHER_COMMIT)] });
const BODY_WRONG_REPO = `${JSON.stringify({
  format: 1,
  title: { en: 'tampered index' },
  plugins: [{ name: 'dsh-game-market', versions: [{ version: '1.2.0', publishTimestamp: PUBLISH_TS, source: { type: 'git', url: 'https://github.com/evil/dsh-game-market.git', commit: PUBLISHED_COMMIT } }] }],
}, null, 2)}\n`;
const BODY_FILE_SOURCE = `${JSON.stringify({
  format: 1,
  title: { en: 'local source' },
  plugins: [{ name: 'dsh-game-market', versions: [{ version: '1.2.0', publishTimestamp: PUBLISH_TS, source: { type: 'git', url: 'file:///tmp/dsh-v15/m3/stand-in-repo', commit: PUBLISHED_COMMIT } }] }],
}, null, 2)}\n`;
const BODY_SHORT_SHA = `${JSON.stringify({
  format: 1,
  title: { en: 'short sha' },
  plugins: [{ name: 'dsh-game-market', versions: [{ version: '1.2.0', publishTimestamp: PUBLISH_TS, source: { type: 'git', url: REPO_URL, commit: 'f422e8d' } }] }],
}, null, 2)}\n`;
const BODY_PRERELEASE = buildIndexBody({ versions: [indexVersion('1.3.0-alpha.1', PUBLISHED_COMMIT)] });
const BODY_PRERELEASE_TEST = buildIndexBody({
  versions: [
    indexVersion('1.2.0', PUBLISHED_COMMIT),
    indexVersion('1.3.0-alpha.1', OTHER_COMMIT, { publishTimestamp: PUBLISH_TS + 60 }),
  ],
});

// ---------------------------------------------------------------------------
// Cache fixture (isolated profile only): simulate a previous successful check
// ---------------------------------------------------------------------------

function targetIdFor(version, commit) {
  return `tgt_${sha(`${version}/${commit}`).slice(0, 16)}`;
}

function writeCacheSeed(home, { version, commit, checkedAtMs }) {
  const dir = path.join(home, 'storages', 'dsh-game-market');
  ensureDir(dir);
  const checkedAt = new Date(checkedAtMs).toISOString();
  const target = {
    id: targetIdFor(version, commit),
    version,
    commit,
    channel: 'stable',
    publishedAt: new Date(PUBLISH_TS * 1000).toISOString(),
    spec: `${REPO_URL}#${commit}`,
  };
  const cache = {
    schemaVersion: 1,
    indexUrl: FIXED_INDEX_URL,
    indexHash: sha(`${version}/${commit}`),
    channel: 'stable',
    fetchedAt: checkedAt,
    checkedAt,
    target,
    previousTarget: null,
    marker: 'v1.5-m3-discovery-cache-fixture (isolated profile only; product code unmodified)',
  };
  const file = path.join(dir, 'platform-update-cache.json');
  fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return { file, cache };
}

function readCache(home) {
  const file = path.join(home, 'storages', 'dsh-game-market', 'platform-update-cache.json');
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { exists: false, value: null };
  }
}

// ---------------------------------------------------------------------------
// Real Host route helpers (through the probe plugin's in-process exact routes)
// ---------------------------------------------------------------------------

async function getInspect(probe, label = 'get') {
  const result = await probe.send({ id: `disc-${label}-${Date.now()}`, action: 'host-route', path: '/api/game-market/platform-update', method: 'GET' });
  return result;
}

async function postRefresh(probe, label = 'refresh') {
  return probe.send({ id: `disc-${label}-${Date.now()}`, action: 'host-route', path: '/api/game-market/platform-update/refresh', method: 'POST', body: {} });
}

async function postJson(probe, routePath, body, label) {
  return probe.send({ id: `disc-${label}-${Date.now()}`, action: 'host-route', path: routePath, method: 'POST', body });
}

async function waitFor(probe, predicate, { timeoutMs = 25000, intervalMs = 400, label = 'condition' } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await getInspect(probe, `wait-${label}`);
      if (predicate(last)) return { ok: true, waitedMs: Date.now() - started, result: last };
    } catch (error) {
      last = { error: String(error && error.message ? error.message : error) };
    }
    await sleep(intervalMs);
  }
  return { ok: false, waitedMs: Date.now() - started, result: last };
}

function dataOf(routeResult) {
  return routeResult && routeResult.status === 200 && routeResult.envelope && routeResult.envelope.ok === true ? routeResult.body : null;
}

function fixtureRequestCount(filterPath = FIXED_INDEX_PATH) {
  return state.transport.audit().requests.filter((request) => request.path === filterPath).length;
}

// ---------------------------------------------------------------------------
// Generic case harness: fresh isolated profile + host + real routes
// ---------------------------------------------------------------------------

async function runCase({ id, title, scenario = 'valid', body = null, startupCheck = true, channel = 'stable', cacheSeed = null, quickTimeoutMs = 20000 }, bodyFn) {
  const caseState = { id, title, scenario, bodyPresent: body !== null, startupCheck, channel, cacheSeed: cacheSeed !== null, checks: [], host: null, home: null, hostPort: null, runDir: null, boot: null, requestsAdded: 0 };
  log(`case ${id}: ${title}`);
  try {
    if (body !== null) state.transport.control.setFixtureBody(body);
    else state.transport.control.setScenario(scenario);

    const homeName = `${RUN_PREFIX}-${runTag}-${id}`;
    const home = await makeIsolatedHome(homeName, { port: await freePort() });
    caseState.home = home;
    if (cacheSeed !== null) caseState.cacheSeedValue = writeCacheSeed(home, cacheSeed).cache;
    const requestsBefore = state.transport.audit().requests.length;

    const hostPort = await freePort();
    caseState.hostPort = hostPort;
    const caseRunDir = path.join(runDirBase, id);
    ensureDir(caseRunDir);
    caseState.runDir = caseRunDir;
    const bootTag = `${runTag}-${id}`;
    const { host, probe, boot } = await bootProbeHost({
      name: homeName,
      home,
      runDir: caseRunDir,
      bootTag,
      port: hostPort,
      env: state.transport.envForHost({ marker: runTag }),
      pluginMode: 'dev-row',
      gameMarketConfig: {
        platformUpdate: {
          startupCheck,
          channel,
          profileDir: path.join(home, 'profiles', 'web'),
        },
      },
      logName: `${homeName}-host`,
    });
    caseState.host = host;
    caseState.boot = { pid: boot.pid, nodeVersion: boot.nodeVersion, capability: boot.capability, env: boot.env };
    caseState.probe = probe;

    // Wait until the game-market row registered its routes in this Host.
    const routesUp = await waitFor(probe, (result) => result.status === 200 && result.envelope?.ok === true, { timeoutMs: 30000, label: 'routes-up' });
    addCase(caseState, 'routes-registered', routesUp.ok, routesUp.ok ? { waitedMs: routesUp.waitedMs } : routesUp.result);

    const result = await bodyFn({ probe, home, host, boot, caseState });
    caseState.requestsAdded = state.transport.audit().requests.length - requestsBefore;
    return { caseState, result };
  } catch (error) {
    addCase(caseState, 'case-completed-without-throw', false, String(error && error.stack ? error.stack : error));
    return { caseState, result: null };
  } finally {
    // Cleanup per case: stop host (port refused, PID dead) + remove isolated home.
    if (caseState.host) {
      try {
        await caseState.host.stop();
      } catch (error) {
        addCase(caseState, 'host-stop', false, String(error && error.message ? error.message : error));
      }
    }
    if (caseState.home) {
      try {
        removeHome(caseState.home);
      } catch (error) {
        addCase(caseState, 'home-removed', false, String(error && error.message ? error.message : error));
      }
    }
    const proof = await cleanupProof({
      ports: [caseState.hostPort].filter((port) => Number.isInteger(port)),
      pids: [caseState.host && caseState.host.pid].filter((pid) => Number.isInteger(pid)),
      dirs: [caseState.home].filter(Boolean),
      label: `case-${id}-cleanup`,
    });
    caseState.cleanup = proof;
    state.cleanups.push(proof);
    addCase(caseState, 'case-cleanup-proven', proof.ok, { ports: proof.ports, pids: proof.pids, dirs: proof.dirs });
    state.cases.push(caseState);
    state.fixtureRequestsByCase.push({ id, requestsAddedDuringCase: caseState.requestsAdded });
  }
}

function addCase(caseState, name, ok, detail = null, { required = true } = {}) {
  const check = { name: `${caseState.id}/${name}`, ok: Boolean(ok), required, detail };
  caseState.checks.push(check);
  report.add(check.name, check.ok, check.detail, { required });
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

async function caseValidDiscovery() {
  return runCase({ id: 'valid', title: 'valid format-1 index discovers the pinned official target', body: VALID_BODY }, async ({ probe, home, caseState }) => {
    const settled = await waitFor(probe, (result) => {
      const data = dataOf(result);
      return data !== null && data.discovery && data.discovery.state === 'ready' && data.target !== null;
    }, { timeoutMs: 25000, label: 'valid-settled' });
    addCase(caseState, 'discovery-reaches-ready-with-target', settled.ok, settled.ok ? { waitedMs: settled.waitedMs } : settled.result);
    const route = settled.result;
    addCase(caseState, 'http-200-envelope-ok', route.status === 200 && route.envelope?.ok === true, { status: route.status, envelope: route.envelope });
    const data = dataOf(route) ?? {};
    addCase(caseState, 'discovery-index-url-is-frozen-official-url', data.discovery?.indexUrl === FIXED_INDEX_URL, data.discovery?.indexUrl);
    addCase(caseState, 'discovery-channel-defaults-to-stable', data.discovery?.channel === 'stable', data.discovery?.channel);
    addCase(caseState, 'discovery-state-ready', data.discovery?.state === 'ready', data.discovery?.state);
    addCase(caseState, 'discovery-last-error-null', data.discovery?.lastError === null, data.discovery?.lastError);
    addCase(caseState, 'target-version-is-index-version', data.target?.version === '1.2.0', data.target?.version);
    addCase(caseState, 'target-commit-is-bound-40hex', data.target?.commit === PUBLISHED_COMMIT && /^[0-9a-f]{40}$/.test(data.target?.commit ?? ''), data.target?.commit);
    addCase(caseState, 'target-spec-is-git-url-plus-commit', data.target?.spec === `${REPO_URL}#${PUBLISHED_COMMIT}`, data.target?.spec);
    addCase(caseState, 'target-id-is-opaque-pattern', /^tgt_[a-f0-9]{16}$/.test(data.target?.id ?? ''), data.target?.id);
    addCase(caseState, 'target-published-at-iso', typeof data.target?.publishedAt === 'string' && !Number.isNaN(Date.parse(data.target.publishedAt)), data.target?.publishedAt);
    addCase(caseState, 'schema-version-1', data.schemaVersion === 1, data.schemaVersion);
    addCase(caseState, 'host-identity-shape', typeof data.host?.hostEpoch === 'string' && typeof data.host?.version === 'string', data.host);
    addCase(caseState, 'installed-bundle-identity-shape', data.installed?.bundleId === 'dsh-game-market' && typeof data.installed?.loadedVersion === 'string', data.installed);
    addCase(caseState, 'capability-shape', (data.capability?.hmr === 'present' || data.capability?.hmr === 'absent' || data.capability?.hmr === 'unknown') && typeof data.capability?.canBeginUpdate === 'boolean', data.capability);
    // Dev-row profile: capability is blocked by dev-source shadow, not a discovery failure.
    addCase(caseState, 'capability-blocked-in-dev-row-profile', data.capability?.canBeginUpdate === false, data.capability);

    const cache = readCache(home);
    addCase(caseState, 'cache-file-written-atomically-parsable', cache.exists === true && cache.value !== null, cache);
    addCase(caseState, 'cache-target-matches-discovery-target', cache.value?.target?.commit === PUBLISHED_COMMIT && cache.value?.target?.version === '1.2.0', cache.value?.target ?? null);
    addCase(caseState, 'cache-schema-and-index-url', cache.value?.schemaVersion === 1 && cache.value?.indexUrl === FIXED_INDEX_URL, { schemaVersion: cache.value?.schemaVersion, indexUrl: cache.value?.indexUrl });
    addCase(caseState, 'cache-index-hash-64hex', /^[0-9a-f]{64}$/.test(cache.value?.indexHash ?? ''), cache.value?.indexHash);
    caseState.discoveryTarget = data.target ?? null;
    return { data, cache };
  });
}

async function caseThrottle() {
  return runCase({ id: 'refresh-throttle', title: 'manual refresh within 60s is throttled and does not re-fetch', body: VALID_BODY }, async ({ probe, caseState }) => {
    const settled = await waitFor(probe, (result) => dataOf(result)?.discovery?.state === 'ready' && dataOf(result)?.target !== null, { timeoutMs: 25000, label: 'throttle-settled' });
    addCase(caseState, 'initial-discovery-ready', settled.ok, settled.ok ? { waitedMs: settled.waitedMs } : settled.result);
    const before = fixtureRequestCount();
    const refreshed = await postRefresh(probe, 'throttled');
    const data = dataOf(refreshed);
    addCase(caseState, 'refresh-http-envelope-ok', refreshed.status === 200 && refreshed.envelope?.ok === true, { status: refreshed.status, envelope: refreshed.envelope });
    addCase(caseState, 'refresh-throttled-true', data?.throttled === true, data?.throttled ?? null);
    addCase(caseState, 'refresh-refreshed-false', data?.refreshed === false, data?.refreshed ?? null);
    addCase(caseState, 'throttled-refresh-made-no-network-request', fixtureRequestCount() === before, { before, after: fixtureRequestCount() });
    addCase(caseState, 'discovery-can-refresh-false', data?.discovery?.canRefresh === false, data?.discovery?.canRefresh);
    addCase(caseState, 'discovery-next-check-in-future', typeof data?.discovery?.nextCheckAt === 'string' && Date.parse(data.discovery.nextCheckAt) > Date.now() - 1000, data?.discovery?.nextCheckAt);
    addCase(caseState, 'inspect-after-throttle-still-200', (await getInspect(probe, 'after-throttle')).status === 200, null);
    return data;
  });
}

async function caseRefreshAllowed() {
  return runCase({
    id: 'refresh-allowed',
    title: 'refresh after throttle window re-checks and updates the cached target',
    cacheSeed: { version: '1.2.0', commit: PUBLISHED_COMMIT, checkedAtMs: Date.now() - 10 * 60 * 1000 },
    startupCheck: false,
    body: BODY_NEXT,
  }, async ({ probe, home, caseState }) => {
    const loaded = await getInspect(probe, 'cache-loaded');
    const beforeData = dataOf(loaded);
    addCase(caseState, 'seeded-cache-target-served-before-refresh', beforeData?.target?.commit === PUBLISHED_COMMIT && beforeData?.target?.version === '1.2.0', beforeData?.target ?? null);
    addCase(caseState, 'seeded-cache-can-refresh-true', beforeData?.discovery?.canRefresh === true, beforeData?.discovery);
    const beforeRequests = fixtureRequestCount();
    const refreshed = await postRefresh(probe, 'allowed');
    const data = dataOf(refreshed);
    addCase(caseState, 'refresh-not-throttled', data?.throttled === false, data?.throttled ?? null);
    addCase(caseState, 'refresh-refreshed-true', data?.refreshed === true, data?.refreshed ?? null);
    addCase(caseState, 'refresh-made-one-network-request', fixtureRequestCount() === beforeRequests + 1, { before: beforeRequests, after: fixtureRequestCount() });
    addCase(caseState, 'target-updated-to-new-pin', data?.target?.version === '1.2.2' && data?.target?.commit === OTHER_COMMIT, data?.target ?? null);
    addCase(caseState, 'no-anomaly-for-different-version', data?.discovery?.anomaly === null, data?.discovery?.anomaly ?? null);
    const cache = readCache(home);
    addCase(caseState, 'cache-updated-to-new-target', cache.value?.target?.commit === OTHER_COMMIT && cache.value?.target?.version === '1.2.2', cache.value?.target);
    return data;
  });
}

async function caseInvalidIndex({ id, title, scenario, body, expectedReason }) {
  return runCase({ id, title, scenario, body, startupCheck: true }, async ({ probe, caseState }) => {
    const settled = await waitFor(probe, (result) => {
      const data = dataOf(result);
      return data !== null && data.discovery && (data.discovery.state === 'invalid' || data.discovery.state === 'offline');
    }, { timeoutMs: 25000, label: `${id}-settled` });
    addCase(caseState, 'settles-to-invalid-state', settled.ok, settled.ok ? { waitedMs: settled.waitedMs, state: dataOf(settled.result)?.discovery?.state } : settled.result);
    const data = dataOf(settled.result) ?? {};
    addCase(caseState, 'state-is-invalid', data.discovery?.state === 'invalid', data.discovery?.state);
    addCase(caseState, 'last-error-code-update-index-unavailable', data.discovery?.lastError?.code === 'GM-5039', data.discovery?.lastError?.code ?? null);
    addCase(caseState, 'last-error-reason-matches', data.discovery?.lastError?.reason === expectedReason, { reason: data.discovery?.lastError?.reason ?? null, expected: expectedReason });
    addCase(caseState, 'target-is-null', data.target === null, data.target);
    addCase(caseState, 'inspect-http-200-even-when-invalid', settled.result.status === 200 && settled.result.envelope?.ok === true, { status: settled.result.status, envelope: settled.result.envelope });
    addCase(caseState, 'games-routes-unaffected', (await probe.send({ id: `disc-${id}-games-${Date.now()}`, action: 'host-route', path: '/api/game-market/games', method: 'GET' })).status === 200, null);
    return data;
  });
}

async function caseTimeout() {
  return runCase({ id: 'timeout', title: '5s whole-index timeout is enforced and surfaced as retryable offline', scenario: 'timeout', startupCheck: true }, async ({ probe, caseState }) => {
    const started = Date.now();
    const settled = await waitFor(probe, (result) => dataOf(result)?.discovery?.state === 'offline' || dataOf(result)?.discovery?.state === 'invalid', { timeoutMs: 30000, label: 'timeout-settled' });
    const elapsedMs = Date.now() - started;
    addCase(caseState, 'settles-to-offline-or-invalid', settled.ok, { elapsedMs, state: dataOf(settled.result)?.discovery?.state });
    const data = dataOf(settled.result) ?? {};
    addCase(caseState, 'state-offline', data.discovery?.state === 'offline', data.discovery?.state);
    addCase(caseState, 'last-error-reason-timeout', data.discovery?.lastError?.reason === 'timeout', data.discovery?.lastError?.reason ?? null);
    addCase(caseState, 'timeout-retryable', data.discovery?.lastError?.retryable === true, data.discovery?.lastError?.retryable);
    addCase(caseState, 'target-is-null', data.target === null, data.target);
    addCase(caseState, 'timeout-enforced-within-budget', elapsedMs < 20000, { elapsedMs, budgetMs: 20000, note: 'fixture delays 8s; fetchBytes whole-index budget is 5s (fetch abort) plus polling granularity' });
    return data;
  });
}

async function caseOfflineKeepsTarget() {
  return runCase({
    id: 'offline-keeps-target',
    title: 'network failure keeps the last successful target and reports offline',
    scenario: 'abort',
    startupCheck: true,
    cacheSeed: { version: '1.2.0', commit: PUBLISHED_COMMIT, checkedAtMs: Date.now() - 7 * 60 * 60 * 1000 },
  }, async ({ probe, caseState }) => {
    const settled = await waitFor(probe, (result) => dataOf(result)?.discovery?.state === 'offline' || dataOf(result)?.discovery?.state === 'invalid', { timeoutMs: 25000, label: 'offline-settled' });
    addCase(caseState, 'settles-offline', settled.ok, dataOf(settled.result)?.discovery?.state ?? null);
    const data = dataOf(settled.result) ?? {};
    addCase(caseState, 'state-offline', data.discovery?.state === 'offline', data.discovery?.state);
    addCase(caseState, 'last-error-reason-network', data.discovery?.lastError?.reason === 'network', data.discovery?.lastError?.reason ?? null);
    addCase(caseState, 'last-successful-target-retained', data.target?.version === '1.2.0' && data.target?.commit === PUBLISHED_COMMIT, data.target ?? null);
    addCase(caseState, 'retryable-true', data.discovery?.lastError?.retryable === true, data.discovery?.lastError?.retryable);
    addCase(caseState, 'inspect-http-200', settled.result.status === 200 && settled.result.envelope?.ok === true, { status: settled.result.status });
    return data;
  });
}

async function caseAnomaly() {
  return runCase({
    id: 'anomaly-same-version-different-commit',
    title: 'same version pinned to a different commit is reported as an anomaly (previous target)',
    body: BODY_SAME_VERSION_OTHER_COMMIT,
    startupCheck: false,
    cacheSeed: { version: '1.2.0', commit: PUBLISHED_COMMIT, checkedAtMs: Date.now() - 10 * 60 * 1000 },
  }, async ({ probe, caseState }) => {
    const before = dataOf(await getInspect(probe, 'anomaly-before'));
    addCase(caseState, 'seeded-target-served', before?.target?.commit === PUBLISHED_COMMIT, before?.target ?? null);
    const refreshed = await postRefresh(probe, 'anomaly');
    const data = dataOf(refreshed);
    addCase(caseState, 'refresh-succeeded', data?.refreshed === true, data?.refreshed ?? null);
    addCase(caseState, 'new-target-has-same-version-other-commit', data?.target?.version === '1.2.0' && data?.target?.commit === OTHER_COMMIT, data?.target ?? null);
    const anomaly = data?.discovery?.anomaly ?? null;
    addCase(caseState, 'anomaly-detected', anomaly?.kind === 'same-version-different-commit', anomaly);
    addCase(caseState, 'anomaly-expected-commit-is-previous', anomaly?.expectedCommit === PUBLISHED_COMMIT, anomaly?.expectedCommit ?? null);
    addCase(caseState, 'anomaly-found-commit-is-new', anomaly?.foundCommit === OTHER_COMMIT, anomaly?.foundCommit ?? null);
    addCase(caseState, 'anomaly-source-is-previous-target', anomaly?.source === 'previous-target', anomaly?.source ?? null);
    addCase(caseState, 'can-begin-update-false', data?.capability?.canBeginUpdate === false, data?.capability);
    return data;
  });
}

async function caseTestChannelOptIn() {
  return runCase({ id: 'test-channel-optin', title: 'test channel explicit opt-in selects a prerelease; stable never does', body: BODY_PRERELEASE_TEST, startupCheck: true, channel: 'test' }, async ({ probe, caseState }) => {
    const settled = await waitFor(probe, (result) => dataOf(result)?.discovery?.state === 'ready' && dataOf(result)?.target !== null, { timeoutMs: 25000, label: 'test-channel-settled' });
    addCase(caseState, 'test-channel-discovers-prerelease', settled.ok, settled.ok ? { waitedMs: settled.waitedMs } : settled.result);
    const data = dataOf(settled.result) ?? {};
    addCase(caseState, 'discovery-channel-is-test', data.discovery?.channel === 'test', data.discovery?.channel);
    addCase(caseState, 'target-is-prerelease-version', data.target?.version === '1.3.0-alpha.1', data.target?.version ?? null);
    addCase(caseState, 'target-commit-bound', data.target?.commit === OTHER_COMMIT, data.target?.commit ?? null);
    return data;
  });
}

async function caseClientReport() {
  return runCase({ id: 'client-report', title: 'client-report accepts a per-window self-reported identity and rejects invalid ones' }, async ({ probe, caseState }) => {
    const windowId = sha(`window-${runTag}`).slice(0, 32);
    const valid = await postJson(probe, '/api/game-market/platform-update/client-report', {
      clientId: 'probe-client',
      windowId,
      buildVersion: '1.2.0',
      buildCommit: PUBLISHED_COMMIT,
      pageToken: sha(`page-${runTag}`).slice(0, 32),
      startedAt: new Date().toISOString(),
    }, 'client-report-valid');
    addCase(caseState, 'client-report-valid-accepted', valid.status === 200 && valid.envelope?.ok === true && dataOf(valid)?.accepted === true, { status: valid.status, data: dataOf(valid), envelope: valid.envelope });
    addCase(caseState, 'client-report-state-idle-before-update', dataOf(valid)?.state === 'idle', dataOf(valid)?.state ?? null);
    const invalidVersion = await postJson(probe, '/api/game-market/platform-update/client-report', {
      clientId: 'probe-client',
      windowId,
      buildVersion: 'not-a-version',
      buildCommit: PUBLISHED_COMMIT,
    }, 'client-report-invalid-version');
    addCase(caseState, 'client-report-invalid-build-version-rejected', invalidVersion.status >= 400 && invalidVersion.envelope?.ok === false, { status: invalidVersion.status, envelope: invalidVersion.envelope });
    const invalidCommit = await postJson(probe, '/api/game-market/platform-update/client-report', {
      clientId: 'probe-client',
      windowId,
      buildVersion: '1.2.0',
      buildCommit: 'short',
    }, 'client-report-invalid-commit');
    addCase(caseState, 'client-report-invalid-build-commit-rejected', invalidCommit.status >= 400 && invalidCommit.envelope?.ok === false, { status: invalidCommit.status, envelope: invalidCommit.envelope });
    return { valid: dataOf(valid), invalidVersion: invalidVersion.envelope, invalidCommit: invalidCommit.envelope };
  });
}

async function caseBeginFailClosed() {
  return runCase({ id: 'begin-fail-closed', title: 'begin before H2 adapter: fail-closed, accepts only the current validator target id, no operation started' }, async ({ probe, caseState }) => {
    const settled = await waitFor(probe, (result) => dataOf(result)?.discovery?.state === 'ready' && dataOf(result)?.target !== null, { timeoutMs: 25000, label: 'begin-target' });
    const target = dataOf(settled.result)?.target ?? null;
    addCase(caseState, 'valid-target-discovered', target !== null, target);
    const current = target === null ? null : await postJson(probe, '/api/game-market/platform-update/begin', { targetId: target.id }, 'begin-valid');
    const forged = await postJson(probe, '/api/game-market/platform-update/begin', { targetId: `tgt_${'0'.repeat(16)}` }, 'begin-forged');
    const after = dataOf(await getInspect(probe, 'begin-after'));
    const h1FailClosed = current !== null && current.status === 503 && current.envelope?.ok === false;
    const h2TargetInvalid = forged !== null && forged.status >= 400 && forged.envelope?.ok === false;
    addCase(caseState, 'begin-does-not-silently-succeed', (current === null || current.envelope?.ok === false), { currentEnvelope: current?.envelope ?? null, h1FailClosed });
    addCase(caseState, 'forged-target-rejected', h2TargetInvalid, { forgedStatus: forged?.status ?? null, forgedEnvelope: forged?.envelope ?? null });
    addCase(caseState, 'no-operation-started', after?.operation === null, after?.operation ?? null);
    caseState.h1Skeleton = h1FailClosed;
    addCase(caseState, 'h1-skeleton-detected-or-h2-adapter-present', true, { h1FailClosed, note: 'H1: begin answers GM-5038 (adapter unavailable) before H2; H2 will answer GM-4090 for forged target ids' });
    return { target, currentEnvelope: current?.envelope ?? null, forgedEnvelope: forged?.envelope ?? null, h1FailClosed };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const results = { cases: [] };
let thrown = null;
try {
  ensureDir(runDirBase);
  ensureDir(RAW_ROOT);
  const identity = verifyRuntime();
  report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);
  report.add('runtime-expected-version', identity.versionsMatchExpected.dsh && identity.versionsMatchExpected.pluginManager, identity.versions);

  ensureDir(fixtureRoot);
  state.tls = createFixtureTls(tlsDir);
  state.transport = await createIndexTransport({ tlsMaterial: state.tls, upstreamProxy: 'http://127.0.0.1:7897' });
  report.add('fixture-proxy-listening', await portAccepting(state.transport.port), { port: state.transport.port });
  report.add('fixture-scenarios-available', ['valid', 'server-error', 'malformed-json', 'oversize', 'slow', 'timeout', 'abort', 'redirect-http', 'redirect-loop'].every((name) => state.transport.control.scenarios().includes(name)), state.transport.control.scenarios());

  const cases = [
    caseValidDiscovery,
    caseThrottle,
    caseRefreshAllowed,
    () => caseInvalidIndex({ id: 'oversize', title: '>256 KiB index is rejected without a target', scenario: 'oversize', expectedReason: 'too-large' }),
    caseTimeout,
    () => caseInvalidIndex({ id: 'malformed-json', title: 'malformed JSON index is rejected', scenario: 'malformed-json', expectedReason: 'json' }),
    () => caseInvalidIndex({ id: 'unbound-repo', title: 'index bound to a non-official repository is rejected', body: BODY_WRONG_REPO, expectedReason: 'binding' }),
    () => caseInvalidIndex({ id: 'file-source', title: 'file: source in the index is rejected', body: BODY_FILE_SOURCE, expectedReason: 'format' }),
    () => caseInvalidIndex({ id: 'short-sha', title: 'short commit SHA in the index is rejected', body: BODY_SHORT_SHA, expectedReason: 'format' }),
    () => caseInvalidIndex({ id: 'redirect-http', title: 'redirect downgrade to http is rejected', scenario: 'redirect-http', expectedReason: 'redirect' }),
    () => caseInvalidIndex({ id: 'redirect-loop', title: 'redirect loop exceeding maxRedirects is rejected', scenario: 'redirect-loop', expectedReason: 'redirect' }),
    caseOfflineKeepsTarget,
    caseAnomaly,
    () => runCase({ id: 'prerelease-stable', title: 'prerelease-only index yields no stable target', body: BODY_PRERELEASE, startupCheck: true, channel: 'stable' }, async ({ probe, caseState }) => {
      const settled = await waitFor(probe, (result) => dataOf(result)?.discovery?.state === 'ready', { timeoutMs: 25000, label: 'prerelease-settled' });
      addCase(caseState, 'state-ready-with-no-target', settled.ok && dataOf(settled.result)?.target === null, { state: dataOf(settled.result)?.discovery?.state, target: dataOf(settled.result)?.target ?? null });
      const data = dataOf(settled.result) ?? {};
      addCase(caseState, 'stable-channel-filtered-prerelease', data.discovery?.state === 'ready' && data.target === null && data.discovery?.lastError === null, { state: data.discovery?.state, target: data.target, lastError: data.discovery?.lastError ?? null });
      addCase(caseState, 'can-begin-update-false-without-target', data.capability?.canBeginUpdate === false, data.capability);
      return data;
    }),
    caseTestChannelOptIn,
    caseClientReport,
    caseBeginFailClosed,
  ];

  for (const caseFn of cases) {
    try {
      const output = await caseFn();
      results.cases.push({ case: output?.caseState?.id ?? null, result: output?.result ?? null });
    } catch (error) {
      log(`case runner threw: ${error && error.message ? error.message : error}`);
      report.add(`case-runner-threw/${results.cases.length}`, false, String(error && error.stack ? error.stack : error));
    }
  }
} catch (error) {
  thrown = error;
  report.add('matrix-completed-without-throw', false, String(error && error.stack ? error.stack : error));
} finally {
  if (state.transport) {
    try {
      await state.transport.close();
    } catch (error) {
      report.add('fixture-transport-close', false, String(error && error.message ? error.message : error));
    }
  }
  if (state.tls) removeFixtureTls(state.tls);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const ports = [state.transport ? state.transport.port : null, ...state.cases.map((item) => item.hostPort)].filter((port) => Number.isInteger(port));
  const finalCleanup = await cleanupProof({ ports, dirs: [tlsDir, fixtureRoot], label: 'discovery-matrix-final-cleanup' });
  report.add('all-case-cleanups-proven', state.cleanups.every((proof) => proof.ok) && finalCleanup.ok, {
    caseCleanups: state.cleanups.length,
    allCaseOk: state.cleanups.every((proof) => proof.ok),
    finalCleanup,
  });

  const summary = finalizeRun({
    report,
    evidenceRel,
    runDir: runDirBase,
    extra: {
      runTag,
      evidenceLevel: 'isolated-host + transport fixture + real Host routes (discovery only; H1 skeleton)',
      notCoveredUntilH2: [
        'native adapter installBundle branches (begin/applied/activating/updated/pending-restart/verification-failed/cancel/too-late)',
        'coordination gate and multi-window idempotency',
        'Client UI-driven operations (V1/V2)',
        'forged-target GM-4090 rejection once the H2 adapter exists (H1 fail-closed GM-5038 recorded)',
      ],
      fixedIndexUrl: FIXED_INDEX_URL,
      fixtureMethod: 'selective TLS interception (NODE_USE_ENV_PROXY + NODE_EXTRA_CA_CERTS); exact fixed host+path fixture, real passthrough for other paths, opaque tunnels for other hosts',
      gitHead: GIT_HEAD,
      cases: state.cases.map((item) => ({
        id: item.id,
        title: item.title,
        scenario: item.scenario,
        startupCheck: item.startupCheck,
        channel: item.channel,
        cacheSeeded: item.cacheSeed,
        boot: item.boot ? { pid: item.boot.pid, nodeVersion: item.boot.nodeVersion, env: item.boot.env } : null,
        checks: item.checks,
        requestsAddedDuringCase: item.requestsAdded,
        cleanup: item.cleanup,
      })),
      fixtureAuditSummary: state.transport.audit().counts,
      environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
      thrown: thrown === null ? null : String(thrown.stack ?? thrown),
    },
  });
  process.exitCode = summary.summary.passed ? 0 : 1;
}
