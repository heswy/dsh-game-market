/**
 * V1.5 M3-H1: platform update discovery, route skeleton, frozen identity.
 *
 * Covers the frozen discovery policy (docs/V1.5-CONTRACTS.md §9,
 * docs/verification/v1.5/m3-decisions.md §2–§4): always-200 inspection, target
 * binding, size/timeout/redirect limits, single in-flight, manual throttle,
 * last-success cache retention, startup silent check, same-version-different-
 * commit anomaly, additive `/health` identity fields and the fail-closed H1
 * route surface.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { PLATFORM_UPDATE_INDEX_URL } from '../../../shared/src/platform-update.js';
import { readBundleVersion } from '../../src/config.js';
import { createHost } from '../../src/host.js';
import { createHostIdentity, discoverProfile } from '../../src/host-identity.js';
import { deriveUpdateCapability } from '../../src/platform-update.js';
import { createHarness, createHostHarness, FIXTURE_ROOT } from '../support/harness.js';
import { createFakePluginManager } from '../support/platform-update-harness.js';
import {
  COMMIT_A,
  COMMIT_B,
  REPO_URL,
  hangingFetch,
  jsonResponse,
  makeCacheDocument,
  makeCacheTarget,
  makeIndexDocument,
  makeVersion,
  readDiscoveryCache,
  scriptedFetch,
  staticFetch,
  updateProfileSpec,
  writeDiscoveryCache,
  writeProfile,
} from '../support/platform-update.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

async function refresh(host) {
  return host.requestJson(ROUTES.PLATFORM_UPDATE_REFRESH, { method: 'POST' });
}

function createClock(start = Date.parse('2026-10-20T12:00:00.000Z')) {
  let stamp = start;
  return {
    now: () => new Date(stamp),
    advance: (ms) => {
      stamp += ms;
    },
  };
}

export function register() {
  test('GET /platform-update is always a 200 envelope with the frozen shape', async (t) => {
    const host = await createHarness(t);
    const { response, payload } = await host.requestJson(ROUTES.PLATFORM_UPDATE);
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = payload.data;
    assert.equal(data.schemaVersion, 1);
    assert.equal(typeof data.host.version, 'string');
    assert.equal(data.host.version, readBundleVersion());
    assert.match(data.host.hostEpoch, /^he_[a-f0-9]{16}$/);
    assert.ok(!Number.isNaN(Date.parse(data.host.loadedAt)));
    assert.equal(data.installed.bundleId, 'dsh-game-market');
    assert.equal(data.target, null);
    assert.equal(data.operation, null);
    assert.equal(data.discovery.channel, 'stable');
    assert.equal(data.discovery.indexUrl, PLATFORM_UPDATE_INDEX_URL);
    assert.equal(data.discovery.state, 'never');
    assert.equal(data.discovery.fetchedAt, null);
    assert.equal(data.discovery.checkedAt, null);
    assert.ok(!Number.isNaN(Date.parse(data.discovery.nextCheckAt)));
    assert.equal(data.discovery.lastError, null);
    assert.equal(data.discovery.anomaly, null);
    assert.equal(data.discovery.canRefresh, true);
    assert.equal(data.capability.hmr, 'unknown');
    assert.equal(data.capability.updatePath, 'unsupported');
    assert.equal(data.capability.canBeginUpdate, false);
    assert.equal(data.capability.reasonKey, 'update.reason.adapterUnavailable');
    // All seven update routes are registered exactly (H1 skeleton included).
    for (const route of [
      ROUTES.PLATFORM_UPDATE,
      ROUTES.PLATFORM_UPDATE_REFRESH,
      ROUTES.PLATFORM_UPDATE_BEGIN,
      ROUTES.PLATFORM_UPDATE_OBSERVE,
      ROUTES.PLATFORM_UPDATE_CANCEL,
      ROUTES.PLATFORM_UPDATE_COORDINATE,
      ROUTES.PLATFORM_UPDATE_CLIENT_REPORT,
    ]) {
      assert.equal(host.routes.has(route), true, `missing route ${route}`);
    }
    assert.deepEqual(host.routes.get(ROUTES.PLATFORM_UPDATE).methods, ['GET', 'HEAD']);
    assert.deepEqual(host.routes.get(ROUTES.PLATFORM_UPDATE_OBSERVE).methods, ['GET']);
  });

  test('manual refresh validates the fixed official index and caches the target atomically', async (t) => {
    const stub = staticFetch(makeIndexDocument({ versions: [makeVersion({ version: '1.3.0', commit: COMMIT_A })] }));
    const host = await createHostHarness(t, { http: { platformUpdateFetch: stub.fetch } });
    const { response, payload } = await refresh(host);
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    const data = payload.data;
    assert.equal(data.refreshed, true);
    assert.equal(data.throttled, false);
    assert.equal(data.discovery.state, 'ready');
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, PLATFORM_UPDATE_INDEX_URL);
    assert.equal(data.target.version, '1.3.0');
    assert.equal(data.target.commit, COMMIT_A);
    assert.equal(data.target.channel, 'stable');
    assert.equal(data.target.spec, `${REPO_URL}#${COMMIT_A}`);
    assert.match(data.target.id, /^tgt_[a-f0-9]{16}$/);
    assert.ok(!Number.isNaN(Date.parse(data.target.publishedAt)));
    assert.ok(!Number.isNaN(Date.parse(data.discovery.fetchedAt)));
    assert.ok(!Number.isNaN(Date.parse(data.discovery.checkedAt)));
    const cached = await readDiscoveryCache(host.dataRoot);
    assert.equal(cached.schemaVersion, 1);
    assert.equal(cached.indexUrl, PLATFORM_UPDATE_INDEX_URL);
    assert.match(cached.indexHash, /^[a-f0-9]{64}$/);
    assert.equal(cached.target.version, '1.3.0');
    assert.equal(cached.target.commit, COMMIT_A);
    // The next inspection reads the same target without another request.
    const inspected = await host.data(ROUTES.PLATFORM_UPDATE);
    assert.equal(inspected.discovery.state, 'ready');
    assert.equal(stub.calls.length, 1);
  });

  test('manual refresh is throttled for 60s and does not re-check', async (t) => {
    const clock = createClock();
    const stub = staticFetch(makeIndexDocument());
    const host = await createHostHarness(t, { now: clock.now, http: { platformUpdateFetch: stub.fetch } });
    const first = await refresh(host);
    assert.equal(first.payload.data.refreshed, true);
    const second = await refresh(host);
    assert.equal(second.payload.data.refreshed, false);
    assert.equal(second.payload.data.throttled, true);
    assert.equal(second.payload.data.discovery.canRefresh, false);
    assert.equal(stub.calls.length, 1);
    assert.ok(Date.parse(second.payload.data.discovery.nextCheckAt) >= clock.now().getTime() + 60_000 - 1000);
    clock.advance(61_000);
    const third = await refresh(host);
    assert.equal(third.payload.data.refreshed, true);
    assert.equal(stub.calls.length, 2);
  });

  test('concurrent refreshes share a single in-flight check', async (t) => {
    const gate = (() => {
      let resolve;
      const promise = new Promise((res) => {
        resolve = res;
      });
      return { promise, resolve };
    })();
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      await gate.promise;
      return jsonResponse(makeIndexDocument());
    };
    const host = await createHostHarness(t, { http: { platformUpdateFetch: fetchImpl } });
    await host.host.platformUpdate.ready();
    const first = host.host.platformUpdate.refresh();
    const second = host.host.platformUpdate.refresh();
    for (let attempt = 0; attempt < 100 && calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(calls.length, 1, 'only one request may be in flight');
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.refreshed, true);
    assert.equal(b.refreshed, true);
    assert.equal(calls.length, 1);
  });

  test('network failure keeps the last successful target and never blocks games', async (t) => {
    const clock = createClock();
    const stub = scriptedFetch([
      () => jsonResponse(makeIndexDocument()),
      () => {
        const error = new Error('network down');
        error.code = 'ENETUNREACH';
        throw error;
      },
    ]);
    const host = await createHostHarness(t, { now: clock.now, http: { platformUpdateFetch: stub.fetch } });
    const ok = await refresh(host);
    assert.equal(ok.payload.data.discovery.state, 'ready');
    clock.advance(61_000);
    const failed = await refresh(host);
    assert.equal(failed.payload.data.refreshed, false);
    assert.equal(failed.payload.data.throttled, false);
    const data = failed.payload.data;
    assert.equal(data.discovery.state, 'offline');
    assert.equal(data.discovery.lastError.code, GM.UPDATE_INDEX_UNAVAILABLE);
    assert.equal(data.discovery.lastError.retryable, true);
    assert.equal(data.discovery.lastError.reason, 'network');
    assert.equal(data.target.version, '1.3.0');
    const cached = await readDiscoveryCache(host.dataRoot);
    assert.equal(cached.target.version, '1.3.0');
    // A discovery failure must never block the game/market API.
    const games = await host.data(ROUTES.GAMES);
    assert.equal(Array.isArray(games.items), true);
  });

  test('malformed or unbound indexes are rejected as invalid while keeping the last target', async (t) => {
    const clock = createClock();
    const wrongRepo = makeIndexDocument({
      versions: [
        makeVersion({
          source: { type: 'git', url: 'https://github.com/evil/dsh-game-market.git', commit: COMMIT_A },
        }),
      ],
    });
    const stub = scriptedFetch([
      () => jsonResponse(makeIndexDocument()),
      () => jsonResponse(wrongRepo),
      () => new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    ]);
    const host = await createHostHarness(t, { now: clock.now, http: { platformUpdateFetch: stub.fetch } });
    await refresh(host);
    clock.advance(61_000);
    const unbound = await refresh(host);
    assert.equal(unbound.payload.data.discovery.state, 'invalid');
    assert.equal(unbound.payload.data.discovery.lastError.retryable, false);
    assert.equal(unbound.payload.data.target.version, '1.3.0');
    clock.advance(61_000);
    const malformed = await refresh(host);
    assert.equal(malformed.payload.data.discovery.state, 'invalid');
    assert.equal(malformed.payload.data.discovery.lastError.reason, 'json');
    assert.equal(malformed.payload.data.target.version, '1.3.0');
  });

  test('redirect downgrade and oversized indexes are rejected without a target', async (t) => {
    const downgrade = scriptedFetch([
      () => new Response(null, { status: 302, headers: { location: 'http://example.com/plugins.json' } }),
    ]);
    const host = await createHostHarness(t, { http: { platformUpdateFetch: downgrade.fetch } });
    const redirected = await refresh(host);
    assert.equal(redirected.payload.data.discovery.state, 'invalid');
    assert.equal(redirected.payload.data.discovery.lastError.reason, 'redirect');
    assert.equal(redirected.payload.data.target, null);

    const oversized = scriptedFetch([
      () => jsonResponse(makeIndexDocument(), { headers: { 'content-length': String(256 * 1024 + 1) } }),
    ]);
    const host2 = await createHostHarness(t, { http: { platformUpdateFetch: oversized.fetch } });
    const tooLarge = await refresh(host2);
    assert.equal(tooLarge.payload.data.discovery.state, 'invalid');
    assert.equal(tooLarge.payload.data.discovery.lastError.reason, 'too-large');
  });

  test('a 5s index timeout is enforced and surfaced as a retryable offline state', async (t) => {
    const hang = hangingFetch();
    const host = await createHostHarness(t, {
      http: {
        platformUpdateFetch: hang.fetch,
        platformUpdateTiming: { indexConnectMs: 25, indexTotalMs: 25, indexIdleMs: 25 },
      },
    });
    const { payload } = await refresh(host);
    assert.equal(payload.data.refreshed, false);
    assert.equal(payload.data.discovery.state, 'offline');
    assert.equal(payload.data.discovery.lastError.reason, 'timeout');
    assert.equal(payload.data.discovery.lastError.retryable, true);
    assert.equal(hang.calls.length, 1);
  });

  test('startup silent check runs only when the last attempt is older than 6h', async (t) => {
    const stale = makeCacheDocument({ checkedAt: new Date(Date.now() - SIX_HOURS_MS - 60_000).toISOString() });
    const staleStub = staticFetch(makeIndexDocument({ versions: [makeVersion({ version: '1.4.0' })] }));
    const staleHost = await createHostHarness(t, {
      config: { platformUpdate: { startupCheck: true } },
      http: { platformUpdateFetch: staleStub.fetch },
      prepareDataRoot: async (dataRoot) => {
        await writeDiscoveryCache(dataRoot, stale);
      },
    });
    await staleHost.host.platformUpdate.ready();
    assert.equal(staleStub.calls.length, 1, 'stale cache must trigger one silent check');
    const fresh = await staleHost.data(ROUTES.PLATFORM_UPDATE);
    assert.equal(fresh.discovery.state, 'ready');
    assert.equal(fresh.target.version, '1.4.0');

    const freshStub = staticFetch(makeIndexDocument());
    const freshHost = await createHostHarness(t, {
      config: { platformUpdate: { startupCheck: true } },
      http: { platformUpdateFetch: freshStub.fetch },
      prepareDataRoot: async (dataRoot) => {
        await writeDiscoveryCache(dataRoot, makeCacheDocument({ checkedAt: new Date().toISOString() }));
      },
    });
    await freshHost.host.platformUpdate.ready();
    assert.equal(freshStub.calls.length, 0, 'fresh cache must not trigger a startup check');
  });

  test('same version with a different commit is reported as an anomaly', async (t) => {
    const stub = scriptedFetch([() => jsonResponse(makeIndexDocument({ versions: [makeVersion({ version: '1.3.0', commit: COMMIT_A })] }))]);
    const host = await createHostHarness(t, {
      http: { platformUpdateFetch: stub.fetch },
      prepareDataRoot: async (dataRoot) => {
        await writeDiscoveryCache(
          dataRoot,
          makeCacheDocument({ target: makeCacheTarget({ version: '1.3.0', commit: COMMIT_B }) })
        );
      },
    });
    const { payload } = await refresh(host);
    const data = payload.data;
    assert.equal(data.target.version, '1.3.0');
    assert.equal(data.target.commit, COMMIT_A);
    assert.equal(data.discovery.anomaly.kind, 'same-version-different-commit');
    assert.equal(data.discovery.anomaly.version, '1.3.0');
    assert.equal(data.discovery.anomaly.expectedCommit, COMMIT_B);
    assert.equal(data.discovery.anomaly.foundCommit, COMMIT_A);
    assert.equal(data.discovery.anomaly.source, 'previous-target');
  });

  test('H1 route surface fails closed and client-report stores per-window identity', async (t) => {
    const host = await createHarness(t);
    const targetId = 'tgt_0123456789abcdef';

    // No validated discovery record yet: the id cannot match, so the adapter
    // rejects it before any capability probe (GM-4090).
    const begin = await host.requestJson(ROUTES.PLATFORM_UPDATE_BEGIN, { body: { targetId } });
    assert.equal(begin.response.status, 409);
    assert.equal(begin.payload.ok, false);
    assert.equal(begin.payload.error.code, GM.UPDATE_TARGET_INVALID);

    const missingTargetId = await host.requestJson(ROUTES.PLATFORM_UPDATE_BEGIN, { body: {} });
    assert.equal(missingTargetId.response.status, 400);
    assert.equal(missingTargetId.payload.error.code, GM.INVALID_PARAM);

    const observeMissing = await host.requestJson(ROUTES.PLATFORM_UPDATE_OBSERVE);
    assert.equal(observeMissing.response.status, 400);
    assert.equal(observeMissing.payload.error.code, GM.INVALID_PARAM);

    const observeUnknown = await host.requestJson(ROUTES.PLATFORM_UPDATE_OBSERVE, {
      query: { operationId: 'upd_0123456789abcdef' },
    });
    assert.equal(observeUnknown.response.status, 400);
    assert.equal(observeUnknown.payload.error.code, GM.INVALID_PARAM);

    // Cancel/coordinate with no live operation answer "not-running"/"idle"
    // instead of inventing an operation.
    const cancel = await host.requestJson(ROUTES.PLATFORM_UPDATE_CANCEL, {
      body: { operationId: 'upd_0123456789abcdef' },
    });
    assert.equal(cancel.response.status, 200);
    assert.equal(cancel.payload.data.status, 'not-running');
    const coordinate = await host.requestJson(ROUTES.PLATFORM_UPDATE_COORDINATE, {
      body: { windowId: 'w1', idle: true, instances: [] },
    });
    assert.equal(coordinate.response.status, 200);
    assert.equal(coordinate.payload.data.accepted, false);

    const report = await host.requestJson(ROUTES.PLATFORM_UPDATE_CLIENT_REPORT, {
      body: {
        clientId: 'client-1',
        windowId: 'window-1',
        buildVersion: '1.2.0',
        buildCommit: null,
        pageToken: 'page-1',
        startedAt: new Date().toISOString(),
      },
    });
    assert.equal(report.response.status, 200);
    assert.equal(report.payload.data.accepted, true);
    assert.equal(report.payload.data.state, 'idle');
    // Expected identity comes from the running bundle's own release.json (the
    // worktree now carries the release tooling's identity file).
    const ownIdentity = createHostIdentity({ env: { DSH_HOME: '/tmp/dsh-gm-no-profile' }, version: readBundleVersion() });
    assert.deepEqual(report.payload.data.expected, ownIdentity.expectedClient);
    assert.equal(report.payload.data.expected.buildVersion, readBundleVersion());

    const badReport = await host.requestJson(ROUTES.PLATFORM_UPDATE_CLIENT_REPORT, {
      body: { clientId: 'c', windowId: 'w', buildVersion: 'not-semver', buildCommit: null },
    });
    assert.equal(badReport.response.status, 400);
    assert.equal(badReport.payload.error.code, GM.INVALID_PARAM);

    const getRefresh = await host.requestJson(ROUTES.PLATFORM_UPDATE_REFRESH);
    assert.equal(getRefresh.response.status, 400);
    assert.equal(getRefresh.payload.error.code, GM.UNKNOWN_METHOD);
  });

  test('begin fails closed with GM-5038 when a validated target exists but no plugin manager is reachable', async (t) => {
    const host = await createHostHarness(t, {
      prepareDataRoot: async (dataRoot) => {
        await writeDiscoveryCache(dataRoot, makeCacheDocument());
      },
    });
    const begin = await host.requestJson(ROUTES.PLATFORM_UPDATE_BEGIN, {
      body: { targetId: makeCacheTarget().id },
    });
    assert.equal(begin.response.status, 503);
    assert.equal(begin.payload.error.code, GM.UPDATE_ADAPTER_UNAVAILABLE);
    const inspect = await host.data(ROUTES.PLATFORM_UPDATE);
    assert.equal(inspect.target.version, '1.2.9');
    assert.equal(inspect.capability.canBeginUpdate, false);
    assert.equal(inspect.capability.reasonKey, 'update.reason.adapterUnavailable');
  });

  test('the plugin manager is re-resolved after activation (t0-missing → later present)', async (t) => {
    const fake = createFakePluginManager({ hmr: { runExclusive: async (task) => task() } });
    const managerRef = { current: null };
    const host = await createHostHarness(t, {
      config: { platformUpdate: { startupCheck: false } },
      pluginManagerResolver: () => managerRef.current,
      hmrResolver: () => fake.state.hmr,
      prepareDataRoot: async (dataRoot) => {
        await writeDiscoveryCache(dataRoot, makeCacheDocument());
      },
    });
    const before = await host.data(ROUTES.PLATFORM_UPDATE);
    assert.equal(before.capability.canBeginUpdate, false);
    assert.equal(before.capability.reasonKey, 'update.reason.adapterUnavailable');
    managerRef.current = fake.manager;
    const after = await host.data(ROUTES.PLATFORM_UPDATE);
    assert.equal(after.capability.hmr, 'present');
    assert.equal(after.capability.canBeginUpdate, true);
    assert.equal(after.capability.reasonKey, null);
    assert.equal(after.installed.enabled, true);
    assert.equal(after.installed.version, '1.2.0');
  });

  test('profile discovery handles multiple profiles and dev-row shadowing without guessing', async (t) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-profiles-'));
    const home = path.join(directory, 'home');
    const profilesRoot = path.join(home, 'profiles');
    const writeProfileManifest = async (name, dependencies) => {
      const dir = path.join(profilesRoot, name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: `profile-${name}`, dependencies }, null, 2)
      );
      return dir;
    };
    const bundleRoot = path.join(directory, 'running-bundle');
    await fs.mkdir(bundleRoot, { recursive: true });
    t.after(async () => {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    });
    const spec = `github:heswy/dsh-game-market#${COMMIT_A}`;
    const profileA = await writeProfileManifest('alpha', { 'dsh-game-market': spec });
    const profileB = await writeProfileManifest('beta', { 'dsh-game-market': spec });

    // Ambiguous: no profile's installed copy matches the running bundle.
    const ambiguous = discoverProfile({ env: { DSH_HOME: home }, bundleRoot });
    assert.equal(ambiguous.dir, null);
    assert.equal(ambiguous.source, 'unknown');

    // The profile that really carries the running bundle wins by realpath.
    await fs.mkdir(path.join(profileB, 'node_modules'), { recursive: true });
    await fs.symlink(bundleRoot, path.join(profileB, 'node_modules', 'dsh-game-market'), 'dir');
    const installed = discoverProfile({ env: { DSH_HOME: home }, bundleRoot });
    assert.equal(installed.dir, profileB);
    assert.equal(installed.source, 'installed');
    assert.equal(installed.devSource, false);

    // Two profiles: a dev row that mentions the running checkout identifies the
    // profile without pretending the installed package is the running code.
    await fs.rm(path.join(profileB, 'node_modules'), { recursive: true, force: true });
    await fs.writeFile(
      path.join(profileA, 'cordis.patch.yml'),
      `- insert:\n    - id: dsh-game-market\n      name: 'file://${bundleRoot}/index.js'\n`
    );
    const dev = discoverProfile({ env: { DSH_HOME: home }, bundleRoot });
    assert.equal(dev.dir, profileA);
    assert.equal(dev.source, 'dev-row');
    assert.equal(dev.devSource, true);

    // Single profile with a local dependency spec is a dev source too.
    const soloHome = path.join(directory, 'solo-home');
    const soloDir = path.join(soloHome, 'profiles', 'web');
    await fs.mkdir(soloDir, { recursive: true });
    await fs.writeFile(
      path.join(soloDir, 'package.json'),
      JSON.stringify({ name: 'profile-web', dependencies: { 'dsh-game-market': `link:${bundleRoot}` } }, null, 2)
    );
    const solo = discoverProfile({ env: { DSH_HOME: soloHome }, bundleRoot });
    assert.equal(solo.dir, soloDir);
    assert.equal(solo.source, 'single-profile');
    assert.equal(solo.devSource, true);
  });

  test('derived capability matrix follows the frozen HMR/dev/anomaly rules', () => {
    const present = deriveUpdateCapability({ adapter: { available: true, hmr: 'present' }, hasTarget: true, hasAnomaly: false });
    assert.deepEqual(present, { hmr: 'present', updatePath: 'in-place-hmr', canBeginUpdate: true, reasonKey: null });
    const absent = deriveUpdateCapability({ adapter: { available: true, hmr: 'absent' }, hasTarget: true, hasAnomaly: false });
    assert.equal(absent.updatePath, 'restart-required');
    assert.equal(absent.canBeginUpdate, true);
    const unknown = deriveUpdateCapability({ adapter: { available: true, hmr: 'unknown' }, hasTarget: true, hasAnomaly: false });
    assert.equal(unknown.updatePath, 'unsupported');
    assert.equal(unknown.canBeginUpdate, false);
    assert.equal(unknown.reasonKey, 'update.reason.hmrUnknown');
    const unavailable = deriveUpdateCapability({ adapter: { available: false }, hasTarget: true, hasAnomaly: false });
    assert.equal(unavailable.reasonKey, 'update.reason.adapterUnavailable');
    const dev = deriveUpdateCapability({
      adapter: { available: true, hmr: 'present' },
      devRowShadow: true,
      hasTarget: true,
      hasAnomaly: false,
    });
    assert.equal(dev.updatePath, 'in-place-hmr');
    assert.equal(dev.canBeginUpdate, false);
    assert.equal(dev.reasonKey, 'update.reason.devSource');
    const noTarget = deriveUpdateCapability({ adapter: { available: true, hmr: 'present' }, hasTarget: false, hasAnomaly: false });
    assert.equal(noTarget.reasonKey, 'update.reason.noTarget');
    const anomaly = deriveUpdateCapability({ adapter: { available: true, hmr: 'present' }, hasTarget: true, hasAnomaly: true });
    assert.equal(anomaly.canBeginUpdate, false);
    assert.equal(anomaly.reasonKey, 'update.reason.versionCommitAnomaly');
  });

  test('release identity is read from the running bundle (release-tooling REPO_URL form)', async (t) => {
    // V1 non-HMR restart finding: release.json carries repo
    // "https://github.com/heswy/dsh-game-market" (no .git). Rejecting that made
    // expectedClient.buildCommit null, so a real matching Client report was
    // classified as stale-runtime. The Host must derive the expected Client
    // identity from the running bundle's own release.json.
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-release-identity-'));
    t.after(async () => {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    });
    const bundleRoot = path.join(directory, 'bundle');
    await fs.mkdir(path.join(bundleRoot, 'platform-updates'), { recursive: true });
    await fs.writeFile(
      path.join(bundleRoot, 'platform-updates', 'release.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          version: '1.2.2',
          clientBuildCommit: COMMIT_B,
          repo: 'https://github.com/heswy/dsh-game-market',
          artifacts: { algorithm: 'sha256-tree-v1', roots: ['client.js'] },
        },
        null,
        2
      )
    );
    const identity = createHostIdentity({
      env: { DSH_HOME: path.join(directory, 'home') },
      version: '1.2.2',
      bundleRoot,
    });
    assert.equal(identity.releaseError, null);
    assert.notEqual(identity.release, null);
    assert.equal(identity.release.clientBuildCommit, COMMIT_B);
    assert.deepEqual(identity.expectedClient, { buildVersion: '1.2.2', buildCommit: COMMIT_B });

    // A foreign repository must not be accepted as this release identity.
    await fs.writeFile(
      path.join(bundleRoot, 'platform-updates', 'release.json'),
      JSON.stringify({
        schemaVersion: 1,
        version: '1.2.2',
        clientBuildCommit: COMMIT_B,
        repo: 'https://github.com/evil/dsh-game-market',
      })
    );
    const forged = createHostIdentity({
      env: { DSH_HOME: path.join(directory, 'home') },
      version: '1.2.2',
      bundleRoot,
    });
    assert.equal(forged.release, null);
    assert.equal(forged.releaseError, 'E_RELEASE_INVALID');
    assert.deepEqual(forged.expectedClient, { buildVersion: '1.2.2', buildCommit: null });
  });

  test('health identity is frozen at activation (disk-new/running-old stays old)', async (t) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-update-identity-'));
    const home = path.join(directory, 'home');
    const dataRoot = path.join(directory, 'data');
    const tCleanup = async () => {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    };
    t.after(tCleanup);
    await writeProfile(null, home, {
      spec: `github:heswy/dsh-game-market#${COMMIT_A}`,
      diskVersion: '1.2.0',
    });
    const host = createHost({
      config: {
        dataRoot,
        builtinGamesRoot: FIXTURE_ROOT,
        registry: { url: path.join(directory, 'missing-registry.json'), allowLocalFile: true },
        platformUpdate: { startupCheck: false },
      },
      env: { DSH_HOME: home },
      version: '1.2.0',
      hostEpoch: 'he_0123456789abcdef',
    });
    try {
      const before = await host.services.health.snapshot();
      assert.equal(before.buildCommit, COMMIT_A);
      assert.equal(before.loadedVersion, '1.2.0');
      assert.equal(before.version, '1.2.0');

      const inspected = await host.services.platformUpdate.inspect();
      assert.equal(inspected.host.commit, COMMIT_A);
      assert.equal(inspected.host.version, '1.2.0');
      assert.equal(inspected.installed.spec, `github:heswy/dsh-game-market#${COMMIT_A}`);
      assert.equal(inspected.installed.specShape, 'git-url');
      assert.equal(inspected.installed.version, '1.2.0');
      assert.equal(inspected.installed.loadedVersion, '1.2.0');
      assert.equal(inspected.installed.loadedCommit, COMMIT_A);

      // Non-HMR overwrite: the installer rewrites the profile dependency and
      // node_modules while the old code keeps running.
      await updateProfileSpec(home, {
        spec: `github:heswy/dsh-game-market#${COMMIT_B}`,
        diskVersion: '1.3.0',
      });
      const after = await host.services.health.snapshot();
      assert.equal(after.buildCommit, COMMIT_A, 'running commit must stay frozen at activation');
      assert.equal(after.loadedVersion, '1.2.0', 'running version must stay frozen at activation');
      const inspectAfter = await host.services.platformUpdate.inspect();
      assert.equal(inspectAfter.installed.version, '1.3.0', 'disk version is reported as installed, not as running');
      assert.equal(inspectAfter.installed.loadedVersion, '1.2.0');
      assert.equal(inspectAfter.installed.loadedCommit, COMMIT_A);
      assert.equal(inspectAfter.installed.spec, `github:heswy/dsh-game-market#${COMMIT_B}`);
    } finally {
      await host.platformUpdate.stop();
      await host.maintenance?.ready?.();
      await host.services.registry?.ready?.();
      await host.storage.flush();
      await host.dispose();
    }
  });

  test('/health exposes additive buildCommit/loadedVersion without regressing old fields', async (t) => {
    const host = await createHarness(t);
    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.buildCommit, null);
    assert.equal(health.loadedVersion, readBundleVersion());
    assert.equal(health.version, readBundleVersion());
    assert.equal(typeof health.hostEpoch, 'string');
    assert.equal(health.devMode, false);
    assert.equal(typeof health.storage.ok, 'boolean');
  });
}
