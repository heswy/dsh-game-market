#!/usr/bin/env node
/**
 * V1/V2 shared scaffolding for M3 update verification.
 *
 * Everything here is designed for the REAL path:
 *   - isolated DSH_HOME + real `dsh web` + real installed bundle (exact git
 *     commit through the real pluginManager), never a dev-row for the update
 *     under test;
 *   - fixed official index URL served by the audited transport fixture
 *     (`fixture.mjs`), with per-step index body switching (R_A -> R_B -> R_final);
 *   - a real DSH page driven over CDP: UI clicks use trusted CDP mouse events,
 *     and the update is started/refreshed/cancelled through the real Client UI
 *     (`[data-action]` buttons / the confirmation dialog), not direct API calls;
 *   - Host-side evidence is read with same-origin page `fetch` (read-only
 *     observation of the frozen routes) and the probe operator plugin;
 *   - clean-up is asserted (port refused, PID dead, home/chrome dir removed) and
 *     evidence is sanitised (`sanitiseM3`: keeps 40-hex SHAs, masks credentials).
 *
 * A runner that cannot meet a precondition must record a failed required check
 * (or a labelled `not-run` precondition) and exit non-zero — never claim a pass.
 *
 * This module only defines helpers; the V1/V2 runners own the scenario flow.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  Cdp,
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
  removeHome,
  sleep,
  uniqueRunTag,
  verifyRuntime,
  pageFetchJson,
  waitForDshPage,
  hostPid,
} from './lib.mjs';
import { createFixtureTls, createIndexTransport, removeFixtureTls } from './fixture.mjs';
import { dismissOverlays, openMarketPanel } from '../m2/lib/ui.mjs';

export { createReport, finalizeRun, ensureDir, freePort, log, sleep, uniqueRunTag, verifyRuntime };

export const REPO_URL = 'https://github.com/heswy/dsh-game-market.git';
export const PUBLISH_TS = 1761000000;
export const PLATFORM_UPDATE_PATH = '/api/game-market/platform-update';

// ---------------------------------------------------------------------------
// Target arguments (A / B / final SHAs + versions)
// ---------------------------------------------------------------------------

export function parseTargets(argv, { versions = { a: '1.2.1', b: '1.2.2', final: '1.3.0' } } = {}) {
  const args = { a: null, b: null, final: null, versionA: versions.a, versionB: versions.b, versionFinal: versions.final, homeSuffix: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--a') args.a = argv[++i];
    else if (arg === '--b') args.b = argv[++i];
    else if (arg === '--final') args.final = argv[++i];
    else if (arg === '--version-a') args.versionA = argv[++i];
    else if (arg === '--version-b') args.versionB = argv[++i];
    else if (arg === '--version-final') args.versionFinal = argv[++i];
    else if (arg === '--home-suffix') args.homeSuffix = argv[++i];
    else throw new Error(`unknown argument ${arg}`);
  }
  for (const key of ['a', 'b']) {
    if (!/^[0-9a-f]{40}$/.test(String(args[key]))) throw new Error(`--${key} must be a full lowercase 40-hex commit`);
  }
  if (!/^[0-9a-f]{40}$/.test(String(args.final))) throw new Error('--final must be a full lowercase 40-hex commit');
  return args;
}

/**
 * Fetch the pushed probe-release commits into an isolated temp clone (never the
 * shared worktree) and return a git runner bound to that clone. The full fetch
 * of `final` brings the chain; each SHA is then fetched explicitly (the
 * exact-SHA want path pnpm uses for `https://…git#<40hex>`).
 *
 * Network is read-only; proxy env is applied only to these child git commands.
 */
const PROXY_ENV = {
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  ALL_PROXY: 'http://127.0.0.1:7897',
  NO_PROXY: '127.0.0.1,localhost',
};
const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'npm_config_https_proxy', 'npm_config_http_proxy', 'npm_config_proxy'];

function gitNetworkEnv(mode) {
  const base = { ...process.env };
  for (const key of PROXY_KEYS) delete base[key];
  base.NO_PROXY = '127.0.0.1,localhost';
  if (mode === 'proxy') Object.assign(base, PROXY_ENV);
  return base;
}

function sleepSync(ms) {
  try {
    spawnSync('sleep', [String(Math.max(1, Math.round(ms / 1000)))]);
  } catch { /* ignore */ }
}

/**
 * Fetch the pushed probe-release commits into an isolated temp clone (never the
 * shared worktree) and return a git runner bound to that clone.
 *
 * Network mode is DIRECT-first with a recorded proxy fallback (current machine
 * topology: local proxy broken, direct GitHub works). Each commit fetch retries
 * with backoff (~up to 60s per mode) and every attempt/mode is recorded.
 */
export function prepareTargetRepo({ final, commits = [], workDir = `/tmp/dsh-v15/m3/v1-target-repo-${process.pid}-${Date.now().toString(36)}`, originUrl = REPO_URL } = {}) {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const run = (gitArgs, { allowFail = false, mode = 'direct' } = {}) => {
    // `-c http.proxy=` neutralizes any user-level git proxy config; the network
    // mode decides whether an explicit proxy is configured instead.
    const proxyArgs = mode === 'proxy'
      ? ['-c', `http.proxy=${PROXY_ENV.HTTP_PROXY}`, '-c', `https.proxy=${PROXY_ENV.HTTP_PROXY}`]
      : ['-c', 'http.proxy=', '-c', 'https.proxy='];
    const result = spawnSync('git', ['-C', workDir, ...proxyArgs, ...gitArgs], { encoding: 'utf8', env: gitNetworkEnv(mode), maxBuffer: 256 * 1024 * 1024 });
    if (result.status !== 0) {
      if (allowFail) return { ok: false, status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
      throw new Error(`git ${gitArgs.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
    }
    return { ok: true, status: 0, stdout: result.stdout.trim(), stderr: result.stderr ?? '' };
  };
  run(['init', '-q', '.']);
  run(['remote', 'add', 'origin', originUrl]);

  const fetchResults = [];
  const fetchOne = (commit, kind) => {
    const started = Date.now();
    const attempts = [];
    let ok = false;
    let modeUsed = null;
    let lastError = null;
    for (const mode of ['direct', 'proxy']) {
      for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
        const result = run(['fetch', '--no-tags', 'origin', commit], { allowFail: true, mode });
        attempts.push({ mode, attempt, ok: result.ok, elapsedMs: Date.now() - started });
        if (result.ok) {
          ok = true;
          modeUsed = mode;
          break;
        }
        lastError = result.stderr.split('\n').slice(-2).join(' | ');
        sleepSync(attempt === 1 ? 3000 : attempt === 2 ? 6000 : 12000);
      }
      if (ok) break;
    }
    fetchResults.push({ commit, kind, ok, mode: modeUsed, attempts, elapsedMs: Date.now() - started, stderr: ok ? null : lastError });
    return ok;
  };
  fetchOne(final, 'full-history');
  for (const commit of commits) fetchOne(commit, 'by-sha');
  const gitRunner = (gitArgs, { allowFail = false } = {}) => {
    const result = run(gitArgs, { allowFail, mode: 'direct' });
    return allowFail ? (result.ok ? result.stdout.trim() : null) : result.stdout.trim();
  };
  const networkModes = [...new Set(fetchResults.map((item) => item.mode).filter(Boolean))];
  return { dir: workDir, fetchResults, networkModes, git: gitRunner };
}

/**
 * Exact-commit install with bounded retry on the KNOWN transient failure mode
 * observed in M0 and here: the native manager's GitHub connectivity pre-check
 * can time out ("connection to github.com timed out after 5000ms") and fail the
 * whole operation without touching the profile. Retries are recorded verbatim;
 * only this transient/timeout shape is retried, never a real management failure.
 */
export async function installExactWithRetry(probe, { spec, requestIdBase, attempts = 3, timeoutMs = 420000 } = {}) {
  const tried = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const requestId = `${requestIdBase}-try${attempt}`;
    const startedAt = Date.now();
    let response = null;
    try {
      response = await probe.send({ id: `install-${requestIdBase}-try${attempt}`, action: 'install', spec, requestId, enabled: true }, { timeoutMs });
    } catch (error) {
      tried.push({ attempt, requestId, thrown: String(error && error.message ? error.message : error), elapsedMs: Date.now() - startedAt });
      await sleep(2000);
      continue;
    }
    const result = response.result ?? null;
    const transient = result?.application === 'failed' && (
      result?.error?.code === 'operation-error' ||
      (result?.packageResult?.kind === 'timeout') ||
      /connection to github\.com timed out|network|ETIMEDOUT|ECONNRESET/i.test(String(result?.error?.diagnostic ?? result?.packageResult?.output ?? ''))
    );
    tried.push({ attempt, requestId, result, elapsedMs: Date.now() - startedAt, transient: transient === true });
    if (!transient) return { result, attempts: tried, retried: attempt > 1 };
    await sleep(4000);
  }
  return { result: null, attempts: tried, retried: tried.length > 1, exhausted: true };
}

export async function bootstrapInstalledProfile({
  targetA,
  fixtureTargetVersion,
  fixtureTargetCommit,
  namePrefix,
  runTag,
  hmr = true,
} = {}) {
  const env = makeScenarioEnvironment(runTag);
  const transport = await startTransport(env);
  transport.control.setFixtureBody(buildIndexBody({ versions: [{ version: fixtureTargetVersion, commit: fixtureTargetCommit }] }));
  const name = `${namePrefix}-${runTag}`;
  const home = await makeIsolatedHome(name, { port: await freePort() });
  if (!hmr) writeNoHmrPatch(home);
  const context = { name, home, transport, host: null, probe: null, boot: null, hostPort: null, bootIndex: 1 };
  const booted = await bootProbeHost({
    name,
    home,
    runDir: path.join(RUNS_ROOT, runTag, 'boot1'),
    bootTag: `${name}-boot1`,
    port: await freePort(),
    env: transport.envForHost({ marker: runTag }),
    pluginMode: 'none',
    logName: `${name}-boot1`,
  });
  context.host = booted.host;
  context.probe = booted.probe;
  context.boot = booted.boot;
  context.hostPort = booted.host.port;
  const installOutcome = await installExactWithRetry(context.probe, { spec: targetA.spec, requestIdBase: `m3-${name}-base` });
  const result = installOutcome.result;
  context.installAttempts = installOutcome.attempts;
  context.installRetried = installOutcome.retried === true;
  let applied = null;
  if (hmr) applied = await waitForHostVersion(context.probe, targetA.version, { timeoutMs: 240000 });
  const routeReady = await waitForRoute(context, { timeoutMs: 90000 });
  return { env, tls: env.tls, tlsDir: env.tlsDir, transport, home, name, context, booted, install: result, installAttempts: installOutcome.attempts, installRetried: installOutcome.retried === true, exhausted: installOutcome.exhausted === true, applied, routeReady };
}

/**
 * Wait for the discovery cache to be able to refresh. Optional cache seed
 * manipulation is purposely NOT used here: product state is not edited.
 */
export async function discoveryCanRefresh(context, { timeoutMs = 90000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const inspect = (await probeInspect(context)).body;
    if (inspect?.discovery?.canRefresh === true) return { ok: true, waitedMs: Date.now() - started, inspect };
    await sleep(1000);
  }
  return { ok: false, waitedMs: Date.now() - started };
}

/** Read a commit's `platform-updates/release.json` (read-only git). */
export function readReleaseIdentity(commit, { git = null } = {}) {
  const runner = git ?? ((args) => {
    const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  });
  const raw = runner(['show', `${commit}:platform-updates/release.json`]);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function targetRefs({ a, b, final, versionA, versionB, versionFinal }) {
  return [
    { key: 'A', commit: a, version: versionA, spec: `${REPO_URL}#${a}` },
    { key: 'B', commit: b, version: versionB, spec: `${REPO_URL}#${b}` },
    { key: 'FINAL', commit: final, version: versionFinal, spec: `${REPO_URL}#${final}` },
  ];
}

// ---------------------------------------------------------------------------
// Fixture index body (exact DSH plugin-market-index format 1)
// ---------------------------------------------------------------------------

export function buildIndexBody({ versions, title = 'DSH plugin index (M3 verification fixture)' }) {
  return `${JSON.stringify({
    format: 1,
    title: { en: title, zh: 'DSH 插件索引（M3 验证夹具）' },
    plugins: [{
      name: 'dsh-game-market',
      versions: versions.map((entry) => ({
        version: entry.version,
        publishTimestamp: entry.publishTimestamp ?? PUBLISH_TS,
        source: { type: 'git', url: REPO_URL, commit: entry.commit },
      })),
    }],
  }, null, 2)}\n`;
}

export function indexBodyForTarget(target) {
  return buildIndexBody({ versions: [{ version: target.version, commit: target.commit }] });
}

// ---------------------------------------------------------------------------
// Scenario setup: transport fixture + isolated host with an installed base bundle
// ---------------------------------------------------------------------------

export function makeScenarioEnvironment(runTag, { transport: provided = null } = {}) {
  const root = path.join('/tmp/dsh-v15/m3', `scenario-${runTag}`);
  const tlsDir = path.join(root, 'tls');
  ensureDir(root);
  const tls = provided?.tls ?? createFixtureTls(tlsDir);
  return { root, tlsDir, tls, transport: provided?.transport ?? null };
}

export async function startTransport(env) {
  if (env.transport !== null) return env.transport;
  env.transport = await createIndexTransport({ tlsMaterial: env.tls, upstreamProxy: 'http://127.0.0.1:7897' });
  return env.transport;
}

/** Apply a patch disabling the shipped hmr row => a real non-HMR profile. */
export function writeNoHmrPatch(home, profile = 'web') {
  const file = path.join(home, 'profiles', profile, 'cordis.patch.yml');
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, [
    '# Isolated non-HMR verification profile: disable the hmr row dsh-base inserts.',
    '# Declared vs actual is verified with `dsh web --dump-config` (M0 S-U1 evidence).',
    '- id: hmr',
    '  disabled: true',
    '',
  ].join('\n'), 'utf8');
  return file;
}

/**
 * Boot an isolated host (probe row only: NO game-market dev row) and install the
 * base release commit `installTarget` through the real pluginManager.
 *
 * `bootIndex` tells the caller how many Host boots happened; each boot gets its
 * own probe runDir so old file-inbox commands are never replayed on a new boot.
 */
export async function bootWithInstalledBase({
  name,
  transport,
  installTarget,
  noHmr = false,
  bootIndex = 1,
  logNamePrefix = null,
  registerCleanup = null,
} = {}) {
  const home = await makeIsolatedHome(name, { port: await freePort() });
  if (noHmr) writeNoHmrPatch(home);
  const hostPort = await freePort();
  const runDir = path.join(RUNS_ROOT, `${name}-boot${bootIndex}`);
  ensureDir(runDir);
  const bootTag = `${name}-boot${bootIndex}`;
  const { host, probe, boot } = await bootProbeHost({
    name,
    home,
    runDir,
    bootTag,
    port: hostPort,
    env: transport.envForHost({ marker: name }),
    pluginMode: 'none',
    logName: logNamePrefix ? `${logNamePrefix}-boot${bootIndex}` : `${name}-boot${bootIndex}`,
  });
  const context = { home, host, probe, boot, hostPort, runDir, bootTag, bootIndex, transport, noHmr, installTarget, restarts: [] };
  if (registerCleanup) registerCleanup(context);

  // Routes are absent until the bundle installs; install first, then wait.
  const requestId = `m3-boot-${name}-${bootIndex}`;
  const install = await probe.send({
    id: `install-base-${bootIndex}`,
    action: 'install',
    spec: installTarget.spec,
    requestId,
    enabled: true,
  }, { timeoutMs: 360000 });
  context.installResult = install.result ?? null;

  if (noHmr) {
    // Non-HMR profile: the install returns restart-required and the running Host
    // still executes the previous code (or nothing on the first install).
    context.needsRestartAfterBaseInstall = context.installResult?.application === 'restart-required';
  } else {
    // HMR profile: wait for the applied plugin to answer health / update routes.
    const applied = await waitForHostVersion(probe, installTarget.version, { timeoutMs: 180000 });
    context.baseApplied = applied;
  }
  return context;
}

/** Stop the current host of a context, optionally restart on the same home. */
export async function restartContextHost(context, { logNamePrefix = null } = {}) {
  if (!Array.isArray(context.restarts)) context.restarts = [];
  const previousPid = context.host ? hostPid(context.host) : null;
  if (context.host) {
    await context.host.stop();
    context.restarts.push({ phase: 'stop', pid: previousPid, at: new Date().toISOString() });
  }
  context.bootIndex += 1;
  const runDir = path.join(RUNS_ROOT, `${context.name ?? 'scenario'}-boot${context.bootIndex}`);
  ensureDir(runDir);
  const bootTag = `restart-${context.bootIndex}`;
  const hostPort = await freePort();
  const { host, probe, boot } = await bootProbeHost({
    name: context.name ?? 'scenario',
    home: context.home,
    runDir,
    bootTag,
    port: hostPort,
    env: context.transport.envForHost({ marker: context.name ?? 'scenario' }),
    pluginMode: 'none',
    logName: logNamePrefix ? `${logNamePrefix}-boot${context.bootIndex}` : `scenario-boot${context.bootIndex}`,
  });
  context.host = host;
  context.probe = probe;
  context.boot = boot;
  context.bootTag = bootTag;
  context.runDir = runDir;
  context.hostPort = hostPort;
  context.restarts.push({ phase: 'start', pid: host.pid, port: hostPort, at: new Date().toISOString() });
  return context;
}

// ---------------------------------------------------------------------------
// Host-side observation through the real routes (probe / page)
// ---------------------------------------------------------------------------

export async function probeInspect(context) {
  return context.probe.send({ id: `inspect-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, action: 'host-route', path: PLATFORM_UPDATE_PATH, method: 'GET' });
}

export function envelopeData(routeResult) {
  return routeResult && routeResult.status === 200 && routeResult.envelope && routeResult.envelope.ok === true ? routeResult.body : null;
}

export async function probeHealth(context) {
  return context.probe.send({ id: `health-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, action: 'host-route', path: '/api/game-market/health', method: 'GET' });
}

export async function waitForHostVersion(probe, expectedVersion, { timeoutMs = 180000, label = 'host-version' } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await probeHealth({ probe });
      const data = envelopeData(await probeInspect({ probe }));
      const health = envelopeData(await last);
      const installedVersion = data?.installed?.version ?? null;
      const loadedVersion = data?.host?.version ?? health?.version ?? null;
      if (installedVersion === expectedVersion && loadedVersion === expectedVersion) {
        return { ok: true, waitedMs: Date.now() - started, inspect: data, health: envelopeData(last) };
      }
    } catch (error) {
      last = { error: String(error && error.message ? error.message : error) };
    }
    await sleep(500);
  }
  return { ok: false, waitedMs: Date.now() - started, last };
}

export async function waitForRoute(context, { timeoutMs = 60000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const inspect = await probeInspect(context);
      if (inspect.status === 200 && inspect.envelope?.ok === true) return { ok: true, waitedMs: Date.now() - started, inspect: inspect.body };
    } catch { /* keep polling */ }
    await sleep(400);
  }
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Real page: launch + UI helpers
// ---------------------------------------------------------------------------

export async function openRealPage(context, { chromePort = null, marketOpenTimeoutMs = 60000 } = {}) {
  const port = chromePort ?? await freePort();
  const cdp = await Cdp.launch({ port });
  const page = { cdp, port, chromePid: cdp.chrome ? cdp.chrome.pid : null, chromeDir: path.join('/tmp/dsh-v15/m3', `chrome-${port}`) };
  await cdp.navigate(context.host.url);
  await waitForDshPage(cdp, context.host.origin, { timeoutMs: 60000 });
  await dismissOverlays(cdp, null);

  // Opening the Market panel: the sidebar may still be mounting right after
  // boot, so retry the real trusted click until the panel reports open.
  const started = Date.now();
  let opened = await openMarketPanel(cdp, null);
  while (opened.opened !== true && Date.now() - started < marketOpenTimeoutMs) {
    await dismissOverlays(cdp, null);
    const clicked = await cdp.eval(`(() => {
      const candidates = [...document.querySelectorAll('button, [role="button"], a')]
        .filter((node) => node.offsetParent !== null && (node.innerText || '').trim() === '游戏市场');
      const node = candidates[0];
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (clicked !== null) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: clicked.x, y: clicked.y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clicked.x, y: clicked.y, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clicked.x, y: clicked.y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(700);
    opened = await openMarketPanel(cdp, null);
  }
  page.marketOpened = opened;
  page.marketOpenedAt = new Date().toISOString();
  return page;
}

export async function reloadRealPage(page, context, { attempts = 5, perAttemptMs = 25000, expectedClientCommit = null } = {}) {
  const cdp = page.cdp;
  const tried = [];
  let mount = { ok: false };
  let opened = { opened: false };
  let served = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt === 1) {
      await cdp.send('Page.reload', { ignoreCache: true });
    } else {
      // A fresh navigation with a cache-buster is the user-equivalent "refresh
      // again". It is needed when the DSH module manifest was served while the
      // Host plugin was mid HMR re-apply: such a page can mount but still run
      // the PREVIOUS client bundle, which would never satisfy activation.
      await cdp.navigate(`${context.host.url}&r=${Date.now()}-${attempt}`);
    }
    await waitForDshPage(cdp, context.host.origin, { timeoutMs: 60000 });
    mount = await waitForClientMount(cdp, { timeoutMs: perAttemptMs });
    served = mount.ok === true ? await readServedClientIdentity(cdp) : null;
    const identityOk = expectedClientCommit === null
      || served?.found === true && served.identity?.buildCommit === expectedClientCommit;
    tried.push({ attempt, mount, served, identityOk });
    if (mount.ok === true && identityOk) break;
    await sleep(3000);
  }
  await dismissOverlays(cdp, null);
  opened = await openMarketPanel(cdp, null);
  if (opened.opened !== true) {
    await sleep(1500);
    opened = await openMarketPanel(cdp, null);
  }
  return { opened, mount, attempts: tried, served, reNavigated: tried.length > 1, page: { ready: 'complete' } };
}

export async function closeRealPage(page) {
  if (!page) return null;
  try {
    page.cdp.dispose();
  } catch (error) {
    log(`cdp dispose failed: ${error && error.message}`);
  }
  const deadline = Date.now() + 10000;
  while (page.chromePid && Date.now() < deadline) {
    try {
      process.kill(page.chromePid, 0);
    } catch {
      break;
    }
    await sleep(100);
  }
  if (page.chromeDir) fs.rmSync(page.chromeDir, { recursive: true, force: true });
  return { chromePid: page.chromePid, chromeDir: page.chromeDir };
}

/** Full update-UI snapshot from the real page (read-only DOM). */
export async function readUpdateUi(cdp) {
  return cdp.eval(`(() => {
    const section = document.querySelector('.dgm-update');
    const operation = document.querySelector('.dgm-update-operation');
    const banner = document.querySelector('[data-testid="update-banner"]');
    const discovery = document.querySelector('[data-testid="update-discovery"]');
    const blocked = section ? section.querySelector('.dgm-update-blocked') : null;
    const coordination = section ? section.querySelector('.dgm-update-coordination') : null;
    const dialog = document.querySelector('.dgm-dialog');
    const actionButtons = [...document.querySelectorAll('.dgm-update [data-action], .dgm-dialog [data-action], [data-testid="update-banner"] [data-action]')]
      .filter((node) => node.offsetParent !== null)
      .map((node) => ({ action: node.getAttribute('data-action'), text: (node.textContent || '').trim(), disabled: node.disabled === true }));
    return {
      sectionPresent: Boolean(section),
      sectionHidden: section ? section.getAttribute('data-update-hidden') : null,
      discovery: discovery ? {
        tone: discovery.getAttribute('data-tone'),
        lines: [...discovery.querySelectorAll('p')].map((node) => (node.textContent || '').trim()),
        anomaly: (discovery.querySelector('[data-anomaly]') || {}).textContent || null,
      } : null,
      identities: section ? [...section.querySelectorAll('.dgm-update-identity')].map((row) => ({
        commitAttr: row.getAttribute('data-commit') || '',
        label: (row.querySelector('.dgm-update-identity-label') || {}).textContent || '',
        version: (row.querySelector('.dgm-update-identity-version') || {}).textContent || '',
        commitText: (row.querySelector('.dgm-update-identity-commit') || {}).textContent || '',
        commitTitle: (row.querySelector('.dgm-update-identity-commit') || {}).title || '',
      })) : [],
      blocked: blocked ? {
        reason: blocked.getAttribute('data-reason'),
        title: (blocked.querySelector('.dgm-update-blocked-title') || {}).textContent || '',
        body: (blocked.querySelector('.dgm-update-blocked-body') || {}).textContent || '',
      } : null,
      coordination: coordination ? { status: coordination.getAttribute('data-status'), text: (coordination.textContent || '').trim() } : null,
      operation: operation ? {
        state: operation.getAttribute('data-state'),
        success: operation.getAttribute('data-success'),
        title: (operation.querySelector('.dgm-update-operation-title') || {}).textContent || '',
        body: (operation.querySelector('.dgm-update-operation-body') || {}).textContent || '',
        code: (operation.querySelector('.dgm-update-operation-code') || {}).textContent || '',
        recovery: (operation.querySelector('.dgm-update-recovery') || {}).textContent || '',
        progressIndex: [...operation.querySelectorAll('.dgm-update-stage')].findIndex((node) => node.getAttribute('aria-current') === 'step'),
      } : null,
      banner: banner ? {
        text: (banner.textContent || '').trim(),
        actions: [...banner.querySelectorAll('[data-action]')].map((node) => ({ action: node.getAttribute('data-action'), text: (node.textContent || '').trim() })),
      } : null,
      dialog: dialog ? {
        title: (dialog.querySelector('.dgm-dialog-title') || {}).textContent || '',
        body: (dialog.querySelector('.dgm-dialog-body') || {}).textContent || '',
        meta: [...dialog.querySelectorAll('.dgm-dialog-meta dt')].map((node, index) => ({
          label: (node.textContent || '').trim(),
          value: ((dialog.querySelectorAll('.dgm-dialog-meta dd')[index] || {}).textContent || '').trim(),
        })),
        warnings: [...dialog.querySelectorAll('.dgm-dialog-note')].map((node) => (node.textContent || '').trim()),
        primary: (dialog.querySelector('.dgm-dialog .dgm-btn-primary, .dgm-dialog .dgm-btn-danger') || {}).textContent || null,
      } : null,
      actionButtons,
      bodyText: (document.body.innerText || '').slice(0, 2500),
    };
  })()`);
}

/** Trusted CDP mouse click on the first visible/enabled element with `[data-action]`. */
export async function clickAction(cdp, action, label = null) {
  const found = await cdp.eval(`(() => {
    const candidates = [...document.querySelectorAll('[data-action="${action}"]')]
      .filter((node) => node.offsetParent !== null && node.disabled !== true);
    const node = candidates[0];
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return { x, y, text: (node.textContent || '').trim(), tag: node.tagName };
  })()`);
  if (found === null) return { clicked: false, label: label ?? action, reason: 'not-found-or-disabled' };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: found.x, y: found.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: found.x, y: found.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: found.x, y: found.y, button: 'left', buttons: 0, clickCount: 1 });
  return { clicked: true, label: label ?? action, target: found, trusted: 'Input.dispatchMouseEvent' };
}

/** Click the confirmation dialog primary button (real mouse event). */
export async function confirmDialog(cdp) {
  const found = await cdp.eval(`(() => {
    const node = document.querySelector('.dgm-dialog .dgm-btn-primary, .dgm-dialog .dgm-btn-danger');
    if (!node || node.offsetParent === null) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: (node.textContent || '').trim() };
  })()`);
  if (!found) return { clicked: false, reason: 'no-dialog-primary' };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: found.x, y: found.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: found.x, y: found.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: found.x, y: found.y, button: 'left', buttons: 0, clickCount: 1 });
  return { clicked: true, target: found, trusted: 'Input.dispatchMouseEvent' };
}

export async function waitForUi(cdp, predicate, { timeoutMs = 20000, intervalMs = 250 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await readUpdateUi(cdp);
    if (predicate(last)) return { ok: true, waitedMs: Date.now() - started, ui: last };
    await sleep(intervalMs);
  }
  return { ok: false, waitedMs: Date.now() - started, ui: last };
}

/** Page-side GET of the frozen inspect route (read-only observation). */
export async function inspectFromPage(cdp) {
  const response = await pageFetchJson(cdp, PLATFORM_UPDATE_PATH);
  let body = null;
  try {
    body = JSON.parse(response.body);
  } catch { /* not json */ }
  return { status: response.status, envelope: body, data: body && body.ok === true ? body.data : null };
}

export async function healthFromPage(cdp) {
  const response = await pageFetchJson(cdp, '/api/game-market/health');
  let body = null;
  try {
    body = JSON.parse(response.body);
  } catch { /* not json */ }
  return { status: response.status, data: body && body.ok === true ? body.data : null };
}

/** Read the Client bundle identity that the Host actually served to this page. */
export async function readServedClientIdentity(cdp) {
  return cdp.eval(`(async () => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => name.includes('dsh-game-market/client.js'));
    if (!url) return { found: false, reason: 'plugin-client-resource-not-loaded' };
    try {
      const text = await (await fetch(url)).text();
      const marker = 'RAW_IDENTITY = ';
      const index = text.indexOf(marker);
      if (index < 0) return { found: false, reason: 'RAW_IDENTITY-assignment-not-found', url: url.slice(0, 200) };
      const rest = text.slice(index + marker.length).trimStart();
      const quote = rest[0];
      if (quote !== '"' && quote !== "'") return { found: false, reason: 'RAW_IDENTITY-not-a-literal', url: url.slice(0, 200) };
      let escaped = false;
      let literalEnd = -1;
      for (let i = 1; i < rest.length; i += 1) {
        const ch = rest[i];
        if (escaped) { escaped = false; continue; }
        if (ch === String.fromCharCode(92)) { escaped = true; continue; }
        if (ch === quote) { literalEnd = i; break; }
      }
      if (literalEnd < 0) return { found: false, reason: 'RAW_IDENTITY-literal-unterminated', url: url.slice(0, 200) };
      const literal = rest.slice(0, literalEnd + 1);
      let identity = null;
      try {
        identity = JSON.parse(JSON.parse(literal));
      } catch (error) {
        return { found: false, reason: 'RAW_IDENTITY-unparseable', url: url.slice(0, 200) };
      }
      return { found: true, url: url.slice(0, 200), identity };
    } catch (error) {
      return { found: false, reason: String(error && error.message ? error.message : error), url: url.slice(0, 200) };
    }
  })()`);
}

/** Wait until the game-market Client has mounted (panel root or sidebar entry). */
export async function waitForClientMount(cdp, { timeoutMs = 25000 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await cdp.eval(`(() => {
      const root = Boolean(document.querySelector('.dgm-root'));
      const sidebar = [...document.querySelectorAll('button, [role="button"], a')]
        .some((node) => node.offsetParent !== null && (node.innerText || '').trim() === '游戏市场');
      return { ready: document.readyState, root, sidebar };
    })()`).catch((error) => ({ error: String(error && error.message ? error.message : error) }));
    if (last && (last.root === true || last.sidebar === true)) return { ok: true, waitedMs: Date.now() - started, state: last };
    await sleep(500);
  }
  return { ok: false, waitedMs: Date.now() - started, state: last };
}

/** Same-origin POST from the page (test control / negative-control calls only). */
export async function pagePostJson(cdp, requestPath, body = {}) {
  return cdp.eval(
    `fetch(${JSON.stringify(requestPath)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) })` +
    `.then(async (response) => ({ status: response.status, body: await response.text() })).catch((error) => ({ error: String(error) }))`
  );
}

/** Same-origin GET already exists as pageFetchJson in lib.mjs; re-wrap for symmetry. */
export async function pageGetJson(cdp, requestPath) {
  return pageFetchJson(cdp, requestPath);
}

/** Poll the operation state through the Host route (authoritative state machine). */
export async function waitForOperation(cdp, desiredStates, { timeoutMs = 180000, intervalMs = 500, onTransition = null } = {}) {
  const transitions = [];
  const wanted = new Set(desiredStates);
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const inspect = await inspectFromPage(cdp);
    const observation = inspect.data?.operation ?? null;
    const state = observation?.state ?? null;
    if (state !== null && (transitions.length === 0 || transitions.at(-1).state !== state)) {
      const entry = { at: new Date().toISOString(), state, observation };
      transitions.push(entry);
      if (onTransition) onTransition(entry);
    }
    last = { inspect: inspect.data, observation, transitions };
    if (state !== null && wanted.has(state)) return { ok: true, waitedMs: Date.now() - started, state, observation, transitions, inspect: inspect.data };
    await sleep(intervalMs);
  }
  return { ok: false, waitedMs: Date.now() - started, last, transitions };
}

/**
 * Start the update through the real UI: banner "打开更新/更新" -> confirmation
 * dialog (captured) -> primary confirm. Returns dialog text + operation id.
 */
export async function beginUpdateThroughUi(cdp, { expectVersion = null } = {}) {
  const banner = await waitForUi(cdp, (ui) => ui.banner !== null, { timeoutMs: 30000 });
  const open = await clickAction(cdp, 'open-update', 'open-update-banner');
  const dialog = await waitForUi(cdp, (ui) => ui.dialog !== null, { timeoutMs: 15000 });
  const dialogSnapshot = dialog.ui?.dialog ?? null;
  const confirm = await confirmDialog(cdp);
  let operationId = null;
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const inspect = await inspectFromPage(cdp);
    const id = inspect.data?.operation?.operationId ?? null;
    if (id !== null) {
      operationId = id;
      break;
    }
    await sleep(400);
  }
  return {
    banner: banner.ui?.banner ?? null,
    open,
    dialog: dialogSnapshot,
    dialogMatchesTargetVersion: expectVersion === null || dialogSnapshot === null ? null : `${dialogSnapshot.title} ${dialogSnapshot.body} ${JSON.stringify(dialogSnapshot.meta)}`.includes(expectVersion),
    confirm,
    operationId,
  };
}

/** Wait until the discovery target matches `version` (fixture step switch). */
export async function waitForDiscoveredTarget(cdp, version, { timeoutMs = 90000 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const inspect = await inspectFromPage(cdp);
    last = inspect.data;
    if (last?.target?.version === version) return { ok: true, waitedMs: Date.now() - started, target: last.target, discovery: last.discovery };
    await sleep(500);
  }
  return { ok: false, waitedMs: Date.now() - started, last };
}

/**
 * Refresh discovery through the real UI refresh button.
 *
 * KNOWN CLIENT DEFECT (observed 2026-10-20, V1 HMR run): after any successful
 * discovery check the Host reports `discovery.canRefresh:true` (manual throttle
 * 60s has elapsed) but also sets `discovery.nextCheckAt` to the NEXT AUTOMATIC
 * check (~6h). The Client (`update-state.js`) derives its refresh countdown from
 * `nextCheckAt`, so the UI refresh button stays disabled for ~6h and the user
 * cannot force a re-check. The Host route itself returns `throttled:true/false`
 * correctly.
 *
 * Verification behaviour (recorded, not hidden): if the button is disabled while
 * `canRefresh === true`, record the defect and fall back to a page-side POST of
 * the same frozen refresh route as a TEST CONTROL (discovery switch only; the
 * update action itself stays UI-driven). The caller records which mode ran.
 */
export async function refreshDiscoveryThroughUi(cdp, { maxWaitMs = 90000, allowApiFallback = true } = {}) {
  const started = Date.now();
  let lastUi = null;
  while (Date.now() - started < maxWaitMs) {
    lastUi = await readUpdateUi(cdp);
    const refreshButton = lastUi.actionButtons.find((button) => button.action === 'refresh-update');
    if (refreshButton === undefined) return { clicked: false, mode: 'absent', reason: 'refresh-button-absent', waitedMs: Date.now() - started, ui: lastUi };
    if (refreshButton.disabled !== true) {
      const click = await clickAction(cdp, 'refresh-update', 'refresh-update');
      return { clicked: click.clicked === true, mode: 'ui', click, waitedMs: Date.now() - started, ui: lastUi };
    }
    if (allowApiFallback) {
      const inspect = await inspectFromPage(cdp);
      const canRefresh = inspect.data?.discovery?.canRefresh === true;
      if (canRefresh) {
        const response = await pagePostJson(cdp, `${PLATFORM_UPDATE_PATH}/refresh`, {});
        let envelope = null;
        try {
          envelope = JSON.parse(response.body);
        } catch { /* not json */ }
        return {
          clicked: false,
          mode: 'api-fallback-after-ui-defect',
          waitedMs: Date.now() - started,
          ui: lastUi,
          defect: {
            observedAt: new Date().toISOString(),
            buttonDisabled: true,
            hostCanRefresh: true,
            nextCheckAt: inspect.data?.discovery?.nextCheckAt ?? null,
            discoveryState: inspect.data?.discovery?.state ?? null,
            note: 'client refresh countdown uses discovery.nextCheckAt (next automatic check ~6h) although canRefresh is true (manual throttle 60s elapsed); UI cannot force a re-check',
          },
          response: { status: response.status, envelopeOk: envelope?.ok ?? null, refreshed: envelope?.data?.refreshed ?? null, throttled: envelope?.data?.throttled ?? null },
        };
      }
    }
    await sleep(1000);
    if (Date.now() - started > maxWaitMs) break;
  }
  return { clicked: false, mode: 'timeout', waitedMs: Date.now() - started, ui: lastUi };
}

// ---------------------------------------------------------------------------
// Storage / data preservation fixtures
// ---------------------------------------------------------------------------

export function seedUserData(home, bootTag) {
  const root = path.join(home, 'storages', 'dsh-game-market');
  ensureDir(path.join(root, 'saves', 'snake'));
  ensureDir(path.join(root, 'preferences'));
  const marker = { marker: 'v1.5-m3-v1-data-marker', bootTag, writtenAt: new Date().toISOString() };
  const save = {
    schemaVersion: 1,
    gameId: 'snake',
    playSessionId: `m3-v1-${bootTag}`,
    score: 42,
    state: { snake: [[3, 3]], direction: 'right' },
    updatedAt: new Date().toISOString(),
  };
  const preferences = { schemaVersion: 1, values: { muted: true, theme: 'dark' }, writtenAt: new Date().toISOString() };
  const files = {
    marker: path.join(root, `${bootTag}-marker.json`),
    save: path.join(root, 'saves', 'snake', 'current.json'),
    preferences: path.join(root, 'preferences', 'values.json'),
  };
  fs.writeFileSync(files.marker, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  fs.writeFileSync(files.save, `${JSON.stringify(save, null, 2)}\n`, 'utf8');
  fs.writeFileSync(files.preferences, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
  return { root, files };
}

export function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

export function readUserData(home, fixture) {
  const files = {};
  for (const [name, file] of Object.entries(fixture.files)) files[name] = { present: fs.existsSync(file), sha256: sha256File(file) };
  return { files };
}

/** Compare the seeded user data against the original byte digests. */
export function userDataPreserved(before, after) {
  const names = Object.keys(before.files);
  const changed = names.filter((name) => before.files[name].sha256 !== after.files[name].sha256);
  return { preserved: changed.length === 0, changed, before: before.files, after: after.files };
}

// ---------------------------------------------------------------------------
// Evidence + cleanup plumbing
// ---------------------------------------------------------------------------

export function createRunContext(prefix) {
  const runTag = uniqueRunTag(prefix);
  return {
    runTag,
    runDir: path.join(RUNS_ROOT, runTag),
    scenarioRoot: path.join('/tmp/dsh-v15/m3', `scenario-${runTag}`),
    evidenceRel: `M3-${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    hosts: [],
    pages: [],
    homes: [],
    ports: [],
    pids: [],
    dirs: [],
    report: null,
  };
}

export function attachReport(run, report) {
  run.report = report;
  return report;
}

export function trackHost(run, context) {
  run.hosts.push(context);
  if (context.hostPort) run.ports.push(context.hostPort);
  if (context.host && context.host.pid) run.pids.push(context.host.pid);
  if (context.home) run.homes.push(context.home);
  return context;
}

export function trackPage(run, page) {
  run.pages.push(page);
  if (page.port) run.ports.push(page.port);
  if (page.chromePid) run.pids.push(page.chromePid);
  if (page.chromeDir) run.dirs.push(page.chromeDir);
  return page;
}

/** Stop host(s), close page(s), remove isolated homes, then prove no leaks. */
export async function cleanupRun(run) {
  const results = { hosts: [], pages: [], homes: [], proof: null };
  for (const page of run.pages) {
    try {
      results.pages.push(await closeRealPage(page));
    } catch (error) {
      results.pages.push({ error: String(error && error.message ? error.message : error) });
    }
  }
  for (const context of run.hosts) {
    try {
      if (context.host) {
        const closed = await context.host.stop();
        results.hosts.push({ pid: context.host.pid, closed });
      }
    } catch (error) {
      results.hosts.push({ error: String(error && error.message ? error.message : error) });
    }
  }
  for (const home of run.homes) {
    try {
      removeHome(home);
      results.homes.push({ home, removed: true });
    } catch (error) {
      results.homes.push({ home, error: String(error && error.message ? error.message : error) });
    }
  }
  for (const dir of run.dirs) fs.rmSync(dir, { recursive: true, force: true });
  const proof = await cleanupProof({ ports: run.ports, pids: run.pids, dirs: [...run.homes, ...run.dirs], label: 'run-cleanup' });
  results.proof = proof;
  return results;
}

export function sanitizeScenario(value) {
  return value;
}

export { Cdp, hostPid, waitForDshPage };
