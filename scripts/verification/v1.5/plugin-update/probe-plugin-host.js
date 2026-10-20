/**
 * V1.5 M0 S-U1/S-U2/S-U3 probe: an independent Host plugin that calls the
 * real, running `pluginManager` Cordis service.
 *
 * Why a separate plugin: the probe must prove that a profile plugin update can
 * be owned by a Host service that is INDEPENDENT of the bundle being updated.
 * This plugin is inserted as its own row into an isolated probe profile; it is
 * never part of dsh-game-market, so a successful update performed from here
 * demonstrates "operator != updated bundle".
 *
 * It is driven by a file command inbox so one Host boot can run many steps:
 *   <outDir>/inbox.json   {"commands":[{"id":"...","action":"...",...}]}
 *   <outDir>/results/<id>.json
 *   <outDir>/boot.json    runtime/capability record written once at startup
 *   <outDir>/ready.json   written after the capability read has stabilised
 *   <outDir>/events.ndjson plugin-manager install-state/install-log/changed events
 *
 * The module is imported by the Cordis loader through a file:// URL from the
 * profile patch; it deliberately imports nothing from the repository so the
 * probe keeps running even while the bundle under test is being replaced.
 *
 * Observations that read undocumented internals (`ownerContext`, `installs`,
 * `ownerEntryId`, `fetchRoutes`) are labelled `internal:` in their output. They
 * are read-only observations used to schedule / explain a public API call; all
 * behavioural claims come from the public service method's own result.
 */

import fs from 'node:fs';
import path from 'node:path';

export const name = 'v15-plugin-update-probe';

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

function serviceOf(ctx, manager, serviceName) {
  const attempts = [];
  try {
    attempts.push(['probeScope', ctx.get(serviceName)]);
  } catch { /* scope may be restricted */ }
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

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Loader rows relevant to the update: hmr capability, the bundle row, and this probe. */
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
    const text = `${String(id ?? '')} ${String(rowName ?? '')}`;
    if (!text.includes('dsh-game-market') && !text.includes('v15-fixture') && id !== 'v15-plugin-update-probe' && id !== 'hmr') continue;
    rows.push({
      id: id ?? null,
      name: rowName ?? null,
      disabled: entry.options?.disabled ?? null,
      hasFiber: entry.fiber !== undefined,
      fiberState: entry.fiber?.state ?? null,
      // internal: fiber uid lets a later observe prove this fiber kept running.
      fiberUid: entry.fiber?.uid ?? null,
    });
  }
  return { available: true, scope: loader.scope, rows, totalEntries };
}

/** Call the game market /health exact fetch route through the Host connection service. */
async function healthSnapshot(ctx, manager) {
  const connection = serviceOf(ctx, manager, 'connection');
  const routes = connection.service?.fetchRoutes;
  const route = routes && typeof routes.get === 'function' ? routes.get('/api/game-market/health') : undefined;
  if (!route || typeof route.fetch !== 'function') {
    return {
      available: false,
      connectionService: connection.service !== undefined,
      connectionScope: connection.scope,
      routeRegistered: false,
    };
  }
  try {
    const request = new Request('http://127.0.0.1/api/game-market/health', { method: 'GET' });
    const response = await route.fetch(request);
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    // The /api transport wraps handler results in {ok, data, requestId, serverTime}.
    const body = parsed !== null && typeof parsed === 'object' && parsed.data !== undefined && parsed.data !== null
      ? parsed.data
      : parsed;
    return {
      available: true,
      connectionScope: connection.scope,
      routeRegistered: true,
      status: response.status,
      envelope: parsed !== null && typeof parsed === 'object'
        ? { ok: parsed.ok ?? null, requestId: parsed.requestId ?? null, serverTime: parsed.serverTime ?? null }
        : null,
      body: body === null ? null : {
        ok: body.ok ?? null,
        version: body.version ?? null,
        hostEpoch: body.hostEpoch ?? null,
        devMode: body.devMode ?? null,
        uptimeMs: body.uptimeMs ?? null,
        storage: body.storage ?? null,
        installRegistries: body.registry ?? null,
        installations: body.installations ?? null,
        error: body.error ?? null,
      },
      bodyText: text.slice(0, 4000),
    };
  } catch (error) {
    return { available: true, connectionScope: connection.scope, routeRegistered: true, error: message(error) };
  }
}

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
    // Decisive source: installBundle itself reads hmr from the manager's own context.
    managerContextHmr: ownerHmr !== undefined,
    managerContextHmrCtor: ownerHmr === null || ownerHmr === undefined ? null : (ownerHmr.constructor?.name ?? null),
    managerContextHmrHasRunExclusive: typeof ownerHmr?.runExclusive === 'function',
    hmrLoaderRow: hmrRow,
    samplesSinceBoot: samples.length,
  };
}

function profileSnapshot(manager, config) {
  const dir = manager?.profileContext?.dir ?? manager?.profile?.dir ?? config.profileDir ?? null;
  const result = { dir, packageJson: null, dependency: null, diskPackage: null, diskPackagePath: null };
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
  const packageJsonPath = path.join(packageDir, 'package.json');
  result.diskPackagePath = packageJsonPath;
  const pkg = readJsonSafe(packageJsonPath);
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
  const marker = '-update-marker.json';
  const markerPath = path.join(root, `${config.bootTag ?? 'boot'}${marker}`);
  const snapshot = {
    configured: true,
    root,
    exists: fs.existsSync(root),
    entries: [],
    markers: [],
  };
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) snapshot.entries.push(`${entry.name}/`);
      else snapshot.entries.push(entry.name);
    }
  } catch { /* root may not exist yet */ }
  const savesDir = path.join(root, 'saves');
  try {
    snapshot.saves = fs.existsSync(savesDir) ? fs.readdirSync(savesDir) : [];
  } catch {
    snapshot.saves = [];
  }
  snapshot.markerPath = markerPath;
  snapshot.markerPresent = fs.existsSync(markerPath);
  if (snapshot.markerPresent) snapshot.markerContent = readJsonSafe(markerPath);
  return snapshot;
}

function bundleSummary(bundles) {
  return bundles
    .filter((bundle) => String(bundle.name).includes('game-market') || String(bundle.name).includes('v15-fixture'))
    .map((bundle) => ({
      name: bundle.name,
      version: bundle.version ?? null,
      enabled: bundle.enabled ?? null,
      installed: bundle.installed ?? null,
      removable: bundle.removable ?? null,
      availability: bundle.availability ?? null,
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
    health: await healthSnapshot(ctx, manager),
    storage: storageSnapshot(config),
    installStateEvents: state.installStateEvents.slice(),
    eventCounts: {
      installState: state.installStateEvents.length,
      installLog: state.installLogEvents.length,
      changed: state.changedEvents.length,
    },
  };
}

async function actionInstall(ctx, manager, config, state, command) {
  const startedAt = Date.now();
  const requestId = command.requestId ?? null;
  const options = {
    enabled: command.enabled !== false,
    ...(command.saveExact === true ? { saveExact: true } : {}),
    ...(requestId === null ? {} : { requestId }),
    ...(command.registry !== undefined ? { registry: command.registry } : {}),
  };
  const record = {
    action: 'install',
    spec: command.spec,
    options,
    startedAt: new Date().toISOString(),
  };
  const installPromise = manager.installBundle(command.spec, options);
  if (command.waitConcurrently === true) {
    record.waitConcurrently = true;
    const waitPromise = Promise.resolve(manager.waitForInstall(requestId)).then((value) => {
      record.waitResolvedWhileActive = true;
      return value;
    });
    if (command.cancelAfterMs !== undefined) {
      await sleep(command.cancelAfterMs);
      record.cancel = { afterMs: command.cancelAfterMs, result: await manager.cancelInstall(requestId) };
    }
    record.result = await installPromise;
    const waited = await waitPromise;
    record.waitValue = waited;
    record.waitEqualsResult =
      waited !== null && record.result !== null && JSON.stringify(waited) === JSON.stringify(record.result);
  } else {
    if (command.cancelAfterMs !== undefined) {
      await sleep(command.cancelAfterMs);
      record.cancel = { afterMs: command.cancelAfterMs, result: await manager.cancelInstall(requestId) };
    }
    record.result = await installPromise;
  }
  if (requestId !== null) {
    record.waitForInstallAfterSettle = await manager.waitForInstall(requestId);
  }
  record.elapsedMs = Date.now() - startedAt;
  record.resultKeys = record.result !== null && typeof record.result === 'object' ? Object.keys(record.result).sort() : [];
  return record;
}

/**
 * Deterministically hit the cancel boundary. `installBundle` phases are
 * installing -> applying; the public cancelInstall returns `too-late` only in
 * `applying`. The internal phase is read only to schedule the public call at
 * the boundary; the reported status is cancelInstall's own answer.
 */
async function actionCancelAtApplying(ctx, manager, config, state, command) {
  const requestId = command.requestId;
  const record = {
    action: 'cancel-at-applying',
    spec: command.spec,
    requestId,
    phaseSource: 'internal pm.installs phase read ONLY to schedule the public cancel call',
    phasesSeen: [],
    startedAt: new Date().toISOString(),
  };
  const installPromise = manager.installBundle(command.spec, { enabled: true, requestId });
  let cancelResult = null;
  let scheduled = false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 600000) {
    const control = manager.installs?.get?.(requestId);
    const phase = control?.phase ?? null;
    if (record.phasesSeen.at(-1) !== phase) record.phasesSeen.push(phase);
    if (phase === 'applying') {
      scheduled = true;
      cancelResult = await manager.cancelInstall(requestId);
      break;
    }
    if (control === undefined) break;
    await sleep(2);
  }
  record.scheduledAtApplying = scheduled;
  record.cancelResult = cancelResult;
  record.result = await installPromise;
  record.elapsedMs = Date.now() - startedAt;
  return record;
}

async function actionCancelDuringInstall(ctx, manager, config, state, command) {
  const requestId = command.requestId;
  const startedAt = Date.now();
  const record = { action: 'cancel-during-install', spec: command.spec, requestId, startedAt: new Date().toISOString() };
  const installPromise = manager.installBundle(command.spec, { enabled: true, requestId });
  await sleep(command.afterMs ?? 250);
  record.cancelResult = await manager.cancelInstall(requestId);
  record.result = await installPromise;
  record.elapsedMs = Date.now() - startedAt;
  return record;
}

async function actionCancelUnknown(ctx, manager, config, state, command) {
  const requestId = command.requestId ?? `v15-unknown-${Date.now()}`;
  return {
    action: 'cancel-unknown',
    requestId,
    cancelResult: await manager.cancelInstall(requestId),
    waitForInstallResult: await manager.waitForInstall(requestId),
    waitForInstallUnknownSecond: await manager.waitForInstall(`${requestId}-other`),
  };
}

async function actionRemoveBundle(ctx, manager, config, state, command) {
  const startedAt = Date.now();
  const before = { selfFiberUid: ctx.fiber?.uid ?? null, at: new Date().toISOString() };
  const record = { action: 'remove-bundle', name: command.name, before };
  try {
    record.result = await manager.removeBundle(command.name);
  } catch (error) {
    record.thrown = { message: message(error), name: error?.name ?? null };
  }
  record.elapsedMs = Date.now() - startedAt;
  record.after = { selfFiberUid: ctx.fiber?.uid ?? null, at: new Date().toISOString(), alive: true };
  return record;
}

async function actionObserve(ctx, manager, config, state, command) {
  return { action: 'observe', label: command.label ?? null, snapshot: await observe(ctx, manager, config, state) };
}

async function runCommand(ctx, manager, config, state, command) {
  switch (command.action) {
    case 'observe':
      return actionObserve(ctx, manager, config, state, command);
    case 'install':
      return actionInstall(ctx, manager, config, state, command);
    case 'cancel-at-applying':
      return actionCancelAtApplying(ctx, manager, config, state, command);
    case 'cancel-during-install':
      return actionCancelDuringInstall(ctx, manager, config, state, command);
    case 'cancel-unknown':
      return actionCancelUnknown(ctx, manager, config, state, command);
    case 'remove-bundle':
      return actionRemoveBundle(ctx, manager, config, state, command);
    case 'ping':
      return { action: 'ping', at: new Date().toISOString(), bootTag: config.bootTag ?? null };
    default:
      throw new Error(`unknown probe action ${JSON.stringify(command.action)}`);
  }
}

export function apply(ctx, config = {}) {
  const outDir = config.outDir;
  if (typeof outDir !== 'string' || outDir.length === 0) {
    throw new Error('v15-plugin-update-probe: config.outDir is required');
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
  }, 'v15-plugin-update-probe: command loop lifetime');

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

    const capabilityEvents = [];
    const record = (kind, payload) => {
      const event = { at: new Date().toISOString(), kind, payload };
      if (kind === 'install-state') {
        state.installStateEvents.push(event);
        appendNdjson(path.join(outDir, 'events.ndjson'), event);
      } else if (kind === 'install-log') {
        state.installLogEvents.push(event);
        appendNdjson(path.join(outDir, 'events.ndjson'), event);
      } else {
        state.changedEvents.push(event);
        appendNdjson(path.join(outDir, 'events.ndjson'), event);
      }
    };
    try {
      // internal: the manager emits its install events on its own owner context.
      manager.ownerContext?.on?.('plugin-manager/install-state', (payload) => record('install-state', payload));
      manager.ownerContext?.on?.('plugin-manager/install-log', (payload) => record('install-log', payload));
      manager.ownerContext?.on?.('plugin-manager/changed', (payload) => record('changed', payload));
    } catch (error) {
      capabilityEvents.push({ error: `event subscription failed: ${message(error)}` });
    }

    // Sample the decisive capability (manager context hmr) until stable. The
    // hmr Service registers in an async init, so a single early read can be a
    // false negative; this mirrors how installBundle itself reads it later.
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
    // Give the rest of the tree a moment to settle after the hmr row starts.
    await sleep(config.settleMs ?? 1500);

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
        methods: Object.getOwnPropertyNames(Object.getPrototypeOf(manager))
          .filter((key) => key !== 'constructor')
          .sort(),
      },
      profile: profileSnapshot(manager, config),
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
      eventSubscriptionErrors: capabilityEvents,
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
      // Liveness heartbeat: proves this operator plugin stayed alive (same
      // fiber uid) while the bundle under update was stopped and replaced.
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
        let payload;
        try {
          payload = await runCommand(ctx, manager, config, state, command);
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
