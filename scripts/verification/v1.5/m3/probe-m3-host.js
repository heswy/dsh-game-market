/**
 * V1.5 M3 probe Host plugin.
 *
 * An INDEPENDENT Host plugin (its own `file://` row, never part of
 * `dsh-game-market`) that can:
 *   - read the real `pluginManager` service and drive its public methods
 *     (`listBundles` / `installBundle` / `waitForInstall` / `cancelInstall`);
 *   - read loader rows, the profile manifest/disk package, and this Host's
 *     `/health` snapshot through the real connection routes;
 *   - call the FIXED official index URL with the Host process's own global
 *     `fetch` (the M3 transport-fixture proof: the request must go through the
 *     isolated fixture and the response body is recorded);
 *   - call any exact `/api/game-market/**` route in-process (`hostRoute`) so a
 *     runner can inspect Host state without a browser (UI-driven operations are
 *     the CDP probes' job; this is only observation/negative control).
 *
 * It is driven by a file inbox so one Host boot can serve many steps:
 *   <outDir>/inbox.json          {"commands":[{"id":"...","action":"...",...}]}
 *   <outDir>/results/<id>.json   one atomic result per command
 *   <outDir>/boot.json           runtime/capability/profile record (once)
 *   <outDir>/ready.json          written after the HMR capability read stabilises
 *   <outDir>/events.ndjson       plugin-manager install-state/install-log/changed
 *   <outDir>/heartbeat.json      liveness: the operator fiber must survive updates
 *
 * It imports only Node builtins so it keeps running while the bundle under test
 * is replaced by HMR. Observations of undocumented internals are labelled
 * `internal:`; every behavioural claim comes from a public method's own result.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const name = 'v15-m3-probe';

const VERSION = 1;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Write JSON atomically so the orchestrator never reads a partial file. */
function atomicWriteJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function appendNdjson(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

function message(error) {
  return String(error && error.message ? error.message : error);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/** Resolve a Host service from the probe scope / manager context / root. */
function serviceOf(ctx, manager, serviceName) {
  const attempts = [];
  try {
    attempts.push(['probeScope', ctx.get(serviceName)]);
  } catch { /* restricted scope */ }
  try {
    attempts.push(['managerContext', manager?.ownerContext?.get(serviceName)]);
  } catch { /* internal, may be absent */ }
  try {
    attempts.push(['root', ctx.root?.get?.(serviceName)]);
  } catch { /* root may be sealed */ }
  for (const [scope, value] of attempts) {
    if (value !== undefined && value !== null) return { service: value, scope };
  }
  return { service: undefined, scope: null };
}

/** Loader rows relevant to an update: hmr, the bundle row, this probe. */
function loaderRows(ctx, manager) {
  const loader = serviceOf(ctx, manager, 'loader');
  if (!loader.service || typeof loader.service.entries !== 'function') {
    return { available: false, scope: loader.scope, rows: [], totalEntries: null };
  }
  const rows = [];
  let totalEntries = 0;
  for (const entry of loader.service.entries()) {
    totalEntries += 1;
    const id = entry.options?.id;
    const rowName = entry.options?.name;
    if (id !== 'hmr' && id !== 'v15-m3-probe' && !String(rowName ?? '').includes('dsh-game-market')) continue;
    rows.push({
      id: id ?? null,
      name: rowName ?? null,
      disabled: entry.options?.disabled ?? null,
      hasFiber: entry.fiber !== undefined,
      fiberState: entry.fiber?.state ?? null,
      // internal: fiber uid is how a later observe proves the operator survived.
      fiberUid: entry.fiber?.uid ?? null,
    });
  }
  return { available: true, scope: loader.scope, rows, totalEntries };
}

/** HMR capability: only the manager owner context read counts (M0 finding). */
function capabilitySnapshot(ctx, manager, samples) {
  const ownerHmr = manager?.ownerContext?.get?.('hmr');
  const loader = loaderRows(ctx, manager);
  const hmrRow = loader.rows.find((row) => row.id === 'hmr') ?? null;
  const probeHmr = (() => {
    try {
      return ctx.get('hmr') !== undefined;
    } catch {
      return false;
    }
  })();
  return {
    at: new Date().toISOString(),
    probeScopeHmr: probeHmr,
    managerContextHmr: ownerHmr !== undefined,
    managerContextHmrCtor: ownerHmr === null || ownerHmr === undefined ? null : (ownerHmr.constructor?.name ?? null),
    managerContextHmrHasRunExclusive: typeof ownerHmr?.runExclusive === 'function',
    hmrLoaderRow: hmrRow,
    samplesSinceBoot: samples.length,
  };
}

function profileSnapshot(manager, config) {
  const dir = manager?.profileContext?.dir ?? manager?.profile?.dir ?? config.profileDir ?? null;
  const result = { dir, packageJson: null, dependency: null, diskPackage: null, devRow: null };
  if (dir === null) return result;
  const manifest = readJsonSafe(path.join(dir, 'package.json'));
  if (manifest !== null) {
    result.packageJson = {
      name: manifest.name ?? null,
      dependencies: manifest.dependencies ?? null,
      profileBundles: manifest.dsh?.profile?.bundles ?? null,
    };
    result.dependency = manifest.dependencies?.['dsh-game-market'] ?? null;
  }
  const packageDir = path.join(dir, 'node_modules', 'dsh-game-market');
  const pkg = readJsonSafe(path.join(packageDir, 'package.json'));
  if (pkg !== null) {
    result.diskPackage = { name: pkg.name ?? null, version: pkg.version ?? null };
    try {
      result.diskPackageRealPath = fs.realpathSync(packageDir);
    } catch {
      result.diskPackageRealPath = null;
    }
  }
  return result;
}

function storageSnapshot(config) {
  const root = config.storageDir;
  if (typeof root !== 'string') return { configured: false };
  const snapshot = { configured: true, root, exists: fs.existsSync(root), entries: [], markerPresent: false };
  try {
    snapshot.entries = fs.readdirSync(root).sort();
  } catch { /* root may not exist yet */ }
  const markerPath = path.join(root, `${config.bootTag ?? 'boot'}-marker.json`);
  snapshot.markerPath = markerPath;
  snapshot.markerPresent = fs.existsSync(markerPath);
  if (snapshot.markerPresent) snapshot.markerContent = readJsonSafe(markerPath);
  const savesDir = path.join(root, 'saves');
  try {
    snapshot.saves = fs.existsSync(savesDir) ? fs.readdirSync(savesDir).sort() : [];
  } catch {
    snapshot.saves = [];
  }
  return snapshot;
}

function limitJson(value, maxBytes = 20000) {
  const text = JSON.stringify(value);
  if (text.length <= maxBytes) return value;
  return { truncated: true, bytes: text.length, textPrefix: text.slice(0, maxBytes) };
}

/** Read `/api/game-market/health` through the real connection route. */
async function routeSnapshot(ctx, manager, requestPath, { method = 'GET', body = undefined, headers = {} } = {}) {
  const connection = serviceOf(ctx, manager, 'connection');
  const routes = connection.service?.fetchRoutes;
  const route = routes && typeof routes.get === 'function' ? routes.get(requestPath) : undefined;
  const result = {
    path: requestPath,
    method,
    available: Boolean(connection.service),
    connectionScope: connection.scope,
    routeRegistered: Boolean(route && typeof route.fetch === 'function'),
  };
  if (!result.routeRegistered) return result;
  try {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers = { 'content-type': 'application/json', ...init.headers };
    }
    const request = new Request(`http://127.0.0.1${requestPath}`, init);
    const response = await route.fetch(request);
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    // The /api transport wraps handler results in {ok, data, requestId, serverTime}.
    const unwrapped = parsed !== null && typeof parsed === 'object' && parsed.data !== undefined ? parsed.data : parsed;
    result.status = response.status;
    result.envelope = parsed !== null && typeof parsed === 'object'
      ? { ok: parsed.ok ?? null, requestId: parsed.requestId ?? null, serverTime: parsed.serverTime ?? null }
      : null;
    result.body = limitJson(unwrapped);
    result.bodyTextPrefix = text.slice(0, 4000);
  } catch (error) {
    result.error = message(error);
  }
  return result;
}

function bundleSummary(bundles) {
  return bundles.map((bundle) => ({
    name: bundle.name,
    version: bundle.version ?? null,
    enabled: bundle.enabled ?? null,
    installed: bundle.installed ?? null,
    removable: bundle.removable ?? null,
    availability: bundle.availability ?? null,
    devMode: bundle.devMode ?? null,
    error: bundle.error ?? null,
  }));
}

async function observe(ctx, manager, config, state) {
  const loader = loaderRows(ctx, manager);
  let bundles = null;
  let bundlesError = null;
  try {
    bundles = bundleSummary(await manager.listBundles());
  } catch (error) {
    bundlesError = message(error);
  }
  return {
    observedAt: new Date().toISOString(),
    bootTag: config.bootTag ?? null,
    pid: process.pid,
    node: { version: process.version, execArgv: process.execArgv },
    selfFiberUid: ctx.fiber?.uid ?? null,
    capability: capabilitySnapshot(ctx, manager, state.capabilitySamples),
    managerInternal: {
      ownerEntryId: manager.ownerEntryId ?? null,
      ownerContextIsProbeContext: manager.ownerContext === ctx,
      ctor: manager.constructor?.name ?? null,
      hasInstallBundle: typeof manager.installBundle === 'function',
      hasWaitForInstall: typeof manager.waitForInstall === 'function',
      hasCancelInstall: typeof manager.cancelInstall === 'function',
      hasRemoveBundle: typeof manager.removeBundle === 'function',
      hasListBundles: typeof manager.listBundles === 'function',
      installedCount: manager.installs?.size ?? null,
    },
    profile: profileSnapshot(manager, config),
    bundles,
    bundlesError,
    loader,
    health: await routeSnapshot(ctx, manager, '/api/game-market/health'),
    storage: storageSnapshot(config),
    eventCounts: {
      installState: state.installStateEvents.length,
      installLog: state.installLogEvents.length,
      changed: state.changedEvents.length,
    },
  };
}

/** Global fetch of the fixed official index URL from inside the real Host process. */
async function actionFetchFixedIndex(ctx, manager, config, state, command) {
  const url = command.url ?? config.fixedIndexUrl;
  const timeoutMs = command.timeoutMs ?? 15000;
  const startedAt = Date.now();
  const envEvidence = {
    hasUseEnvProxy: process.env.NODE_USE_ENV_PROXY ?? null,
    httpsProxy: process.env.HTTPS_PROXY ?? null,
    httpProxy: process.env.HTTP_PROXY ?? null,
    noProxy: process.env.NO_PROXY ?? null,
    extraCaCerts: process.env.NODE_EXTRA_CA_CERTS ? path.basename(process.env.NODE_EXTRA_CA_CERTS) : null,
    fixtureRunTag: process.env.M3_FIXTURE_RUN_TAG ?? null,
  };
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'dsh-v15-m3-probe' },
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      action: 'fetch-fixed-index',
      url,
      startedAt: new Date(startedAt).toISOString(),
      elapsedMs: Date.now() - startedAt,
      ok: response.ok,
      status: response.status,
      redirected: response.redirected,
      location: response.headers.get('location'),
      contentType: response.headers.get('content-type'),
      bytes: buffer.length,
      sha256: sha256(buffer),
      bodyTextPrefix: buffer.subarray(0, 2048).toString('utf8'),
      env: envEvidence,
    };
  } catch (error) {
    return {
      action: 'fetch-fixed-index',
      url,
      startedAt: new Date(startedAt).toISOString(),
      elapsedMs: Date.now() - startedAt,
      ok: false,
      error: { message: message(error), name: error?.name ?? null, causeCode: error?.cause?.code ?? null },
      env: envEvidence,
    };
  }
}

async function actionInstall(ctx, manager, config, state, command) {
  const startedAt = Date.now();
  const requestId = command.requestId ?? null;
  const options = {
    enabled: command.enabled !== false,
    ...(requestId === null ? {} : { requestId }),
    ...(command.registry !== undefined ? { registry: command.registry } : {}),
    // Verification-only seam: lets the comparison probe reproduce the exact
    // adapter option set (e.g. saveExact) against the same native manager.
    ...(command.installOptions !== null && typeof command.installOptions === 'object' ? command.installOptions : {}),
  };
  const record = { action: 'install', spec: command.spec, options, startedAt: new Date().toISOString() };
  try {
    record.result = await manager.installBundle(command.spec, options);
  } catch (error) {
    record.thrown = { message: message(error), name: error?.name ?? null };
  }
  if (requestId !== null) {
    try {
      record.waitForInstallAfterSettle = await manager.waitForInstall(requestId);
    } catch (error) {
      record.waitForInstallAfterSettleError = message(error);
    }
  }
  record.elapsedMs = Date.now() - startedAt;
  record.resultKeys = record.result !== null && typeof record.result === 'object' ? Object.keys(record.result).sort() : [];
  return record;
}

async function actionWaitForInstall(ctx, manager, config, state, command) {
  const timeoutMs = command.timeoutMs ?? 120000;
  const startedAt = Date.now();
  const record = { action: 'wait-for-install', requestId: command.requestId ?? null, timeoutMs };
  let timer = null;
  try {
    const value = await Promise.race([
      manager.waitForInstall(command.requestId),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('__m3_timeout__'), timeoutMs);
      }),
    ]);
    record.timedOut = value === '__m3_timeout__';
    record.value = value === '__m3_timeout__' ? null : value;
  } catch (error) {
    record.error = message(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
  record.elapsedMs = Date.now() - startedAt;
  return record;
}

async function actionCancelInstall(ctx, manager, config, state, command) {
  return {
    action: 'cancel-install',
    requestId: command.requestId ?? null,
    status: await manager.cancelInstall(command.requestId),
  };
}

async function actionHostRoute(ctx, manager, config, state, command) {
  return {
    action: 'host-route',
    ...(await routeSnapshot(ctx, manager, command.path, { method: command.method, body: command.body, headers: command.headers })),
  };
}

async function actionListBundles(ctx, manager, config, state, command) {
  return { action: 'list-bundles', bundles: bundleSummary(await manager.listBundles()) };
}

async function runCommand(ctx, manager, config, state, command) {
  switch (command.action) {
    case 'ping':
      return { action: 'ping', at: new Date().toISOString(), bootTag: config.bootTag ?? null, pid: process.pid };
    case 'observe':
      return { action: 'observe', label: command.label ?? null, snapshot: await observe(ctx, manager, config, state) };
    case 'list-bundles':
      return actionListBundles(ctx, manager, config, state, command);
    case 'install':
      return actionInstall(ctx, manager, config, state, command);
    case 'wait-for-install':
      return actionWaitForInstall(ctx, manager, config, state, command);
    case 'cancel-install':
      return actionCancelInstall(ctx, manager, config, state, command);
    case 'fetch-fixed-index':
      return actionFetchFixedIndex(ctx, manager, config, state, command);
    case 'host-route':
      return actionHostRoute(ctx, manager, config, state, command);
    default:
      throw new Error(`unknown probe action ${JSON.stringify(command.action)}`);
  }
}

export function apply(ctx, config = {}) {
  const outDir = config.outDir;
  if (typeof outDir !== 'string' || outDir.length === 0) {
    throw new Error('v15-m3-probe: config.outDir is required');
  }
  ensureDir(outDir);
  const state = {
    stopped: false,
    capabilitySamples: [],
    installStateEvents: [],
    installLogEvents: [],
    changedEvents: [],
    processed: [],
  };

  // Stop the command loop when this fiber is disposed (HMR may restart rows).
  ctx.effect(() => () => {
    state.stopped = true;
  }, 'v15-m3-probe: command loop lifetime');

  void (async () => {
    const t0 = Date.now();
    let manager = null;
    while (!state.stopped && Date.now() - t0 < 30000) {
      manager = ctx.get('pluginManager');
      if (manager !== undefined) break;
      await sleep(200);
    }
    if (manager === undefined) {
      atomicWriteJson(path.join(outDir, 'boot.json'), {
        probeVersion: VERSION,
        error: 'pluginManager service did not become available within 30s',
        pid: process.pid,
        at: new Date().toISOString(),
      });
      return;
    }

    const record = (kind, payload) => {
      const event = { at: new Date().toISOString(), kind, payload };
      if (kind === 'install-state') state.installStateEvents.push(event);
      else if (kind === 'install-log') state.installLogEvents.push(event);
      else state.changedEvents.push(event);
      appendNdjson(path.join(outDir, 'events.ndjson'), event);
    };
    try {
      // internal: the manager emits its install events on its own owner context.
      manager.ownerContext?.on?.('plugin-manager/install-state', (payload) => record('install-state', payload));
      manager.ownerContext?.on?.('plugin-manager/install-log', (payload) => record('install-log', payload));
      manager.ownerContext?.on?.('plugin-manager/changed', (payload) => record('changed', payload));
    } catch (error) {
      appendNdjson(path.join(outDir, 'events.ndjson'), { at: new Date().toISOString(), kind: 'subscribe-error', payload: message(error) });
    }

    // Sample the decisive capability until stable (hmr registers in async init).
    const waitUntil = Date.now() + (config.hmrWaitMs ?? 15000);
    while (!state.stopped && Date.now() < waitUntil) {
      const sample = capabilitySnapshot(ctx, manager, state.capabilitySamples);
      state.capabilitySamples.push({
        at: sample.at,
        managerContextHmr: sample.managerContextHmr,
        probeScopeHmr: sample.probeScopeHmr,
        hmrLoaderRow: sample.hmrLoaderRow,
      });
      if (sample.managerContextHmr) break;
      await sleep(500);
    }
    await sleep(config.settleMs ?? 1200);

    const boot = {
      probeVersion: VERSION,
      bootTag: config.bootTag ?? null,
      pid: process.pid,
      nodeVersion: process.version,
      execArgv: process.execArgv,
      startedAt: new Date().toISOString(),
      capabilitySamples: state.capabilitySamples,
      capability: capabilitySnapshot(ctx, manager, state.capabilitySamples),
      managerInternal: {
        ownerEntryId: manager.ownerEntryId ?? null,
        ownerContextIsProbeContext: manager.ownerContext === ctx,
        ctor: manager.constructor?.name ?? null,
        methods: Object.getOwnPropertyNames(Object.getPrototypeOf(manager)).filter((key) => key !== 'constructor').sort(),
      },
      profile: profileSnapshot(manager, config),
      env: {
        hasUseEnvProxy: process.env.NODE_USE_ENV_PROXY ?? null,
        httpsProxy: process.env.HTTPS_PROXY ?? null,
        httpProxy: process.env.HTTP_PROXY ?? null,
        noProxy: process.env.NO_PROXY ?? null,
        extraCaCerts: process.env.NODE_EXTRA_CA_CERTS ? path.basename(process.env.NODE_EXTRA_CA_CERTS) : null,
        fixtureRunTag: process.env.M3_FIXTURE_RUN_TAG ?? null,
      },
      probeScopeServices: {
        pluginManager: ctx.get('pluginManager') !== undefined,
        connection: (() => {
          try {
            return ctx.get('connection') !== undefined;
          } catch {
            return false;
          }
        })(),
      },
    };
    atomicWriteJson(path.join(outDir, 'boot.json'), boot);
    atomicWriteJson(path.join(outDir, 'ready.json'), {
      bootTag: config.bootTag ?? null,
      pid: process.pid,
      at: new Date().toISOString(),
      managerContextHmr: boot.capability.managerContextHmr,
      sampledForMs: boot.capabilitySamples.length * 500,
    });

    let commandIndex = 0;
    let heartbeatTick = 0;
    while (!state.stopped) {
      heartbeatTick += 1;
      atomicWriteJson(path.join(outDir, 'heartbeat.json'), {
        bootTag: config.bootTag ?? null,
        pid: process.pid,
        selfFiberUid: ctx.fiber?.uid ?? null,
        tick: heartbeatTick,
        at: new Date().toISOString(),
        processed: state.processed.length,
      });
      const inbox = readJsonSafe(path.join(outDir, 'inbox.json'));
      const commands = Array.isArray(inbox?.commands) ? inbox.commands : [];
      for (const command of commands) {
        if (state.stopped) break;
        if (typeof command?.id !== 'string' || typeof command.action !== 'string') continue;
        if (state.processed.includes(command.id)) continue;
        state.processed.push(command.id);
        commandIndex += 1;
        const startedAt = new Date().toISOString();
        try {
          const payload = await runCommand(ctx, manager, config, state, command);
          atomicWriteJson(path.join(outDir, 'results', `${command.id}.json`), {
            probeVersion: VERSION,
            bootTag: config.bootTag ?? null,
            commandIndex,
            command,
            startedAt,
            finishedAt: new Date().toISOString(),
            ok: true,
            ...payload,
          });
        } catch (error) {
          atomicWriteJson(path.join(outDir, 'results', `${command.id}.json`), {
            probeVersion: VERSION,
            bootTag: config.bootTag ?? null,
            commandIndex,
            command,
            startedAt,
            finishedAt: new Date().toISOString(),
            ok: false,
            error: { message: message(error), stack: error?.stack ?? null },
          });
        }
      }
      await sleep(150);
    }
  })().catch((error) => {
    try {
      atomicWriteJson(path.join(outDir, 'fatal.json'), {
        at: new Date().toISOString(),
        error: message(error),
        stack: error?.stack ?? null,
      });
    } catch { /* nothing else we can do */ }
  });
}
