#!/usr/bin/env node
/**
 * M3-V0 transport-fixture proof for the FIXED official index URL.
 *
 * Question this run answers: can the isolated real DSH Host be made to fetch
 * the frozen URL `https://raw.githubusercontent.com/heswy/dsh-game-market/main/
 * platform-updates/plugins.json` and receive verification data WITHOUT writing
 * the production index, changing the product URL/policy, or adding a product
 * test-only branch?
 *
 * Method (transport layer, auditable):
 *   - generate a throwaway CA + leaf cert for the fixed host with system openssl
 *     in /tmp/dsh-v15/m3;
 *   - start a local selective CONNECT proxy. Exactly `fixed host + fixed path`
 *     is answered from a scenario fixture; every other path on that host is
 *     passed through to the real origin byte-for-byte; every other host is a
 *     plain opaque tunnel. All of it is recorded in an audit log;
 *   - run real global `fetch` (a) in fresh node children and (b) inside the real
 *     isolated `dsh web` Host process (via the M3 probe plugin) with
 *     NODE_USE_ENV_PROXY=1 + HTTPS_PROXY=<proxy> + NODE_EXTRA_CA_CERTS=<CA>.
 *
 * Negative controls prove the interception is real: without the fixture CA the
 * same fetch fails certificate validation; the passthrough path is real network
 * content, not fixture content.
 *
 * Honest evidence level: `isolated transport fixture` (isolated DSH host, real
 * Node fetch). NOT a real production-index fetch, NOT Electron main-process
 * networking. Production index is never written.
 *
 * Usage: node scripts/verification/v1.5/m3/run-v0-fixture.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  PROBE_ROW_ID,
  PROBE_NETWORK_ENV,
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
  removeHome,
  runWithCleanup,
  uniqueRunTag,
  verifyRuntime,
  portAccepting,
} from './lib.mjs';
import {
  FIXED_INDEX_URL,
  createFixtureTls,
  createIndexTransport,
  fetchViaChild,
  removeFixtureTls,
} from './fixture.mjs';

const RUN_PREFIX = 'v0-fixture';
const runTag = uniqueRunTag(RUN_PREFIX);
const runDir = path.join(RUNS_ROOT, runTag);
const fixtureRoot = path.join('/tmp/dsh-v15/m3', `fixture-${runTag}`);
const tlsDir = path.join(fixtureRoot, 'tls');
const evidenceRel = `M3-V0-fixture-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const REPORT_ID = 'M3-V0-fixture';
const PASSTHROUGH_URL = 'https://raw.githubusercontent.com/heswy/dsh-game-market/main/package.json';
const TUNNEL_URL = 'https://api.github.com/zen';
const PRODUCTION_INDEX_REPO_PATH = path.join(REPO_ROOT, 'platform-updates', 'plugins.json');

const report = createReport({
  id: REPORT_ID,
  title: 'Transport fixture for the fixed official index URL inside the isolated real DSH host',
  commands: ['node scripts/verification/v1.5/m3/run-v0-fixture.mjs'],
});

const state = { tls: null, transport: null, home: null, host: null, hostPort: null, productionIndexBefore: null };

function productionIndexStat() {
  try {
    const stat = fs.statSync(PRODUCTION_INDEX_REPO_PATH);
    return { exists: true, bytes: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return { exists: false };
  }
}

function withoutCa(env) {
  const copy = { ...env };
  delete copy.NODE_EXTRA_CA_CERTS;
  return copy;
}

async function cleanup() {
  if (state.host) {
    try {
      await state.host.stop();
    } catch (error) {
      report.add('host-stop-without-throw', false, error && error.message ? error.message : String(error));
    }
    state.host = null;
  }
  if (state.home) {
    try {
      removeHome(state.home);
    } catch (error) {
      report.add('isolated-home-removal-without-throw', false, error && error.message ? error.message : String(error));
    }
  }
  if (state.transport) {
    try {
      await state.transport.close();
    } catch (error) {
      report.add('fixture-transport-close-without-throw', false, error && error.message ? error.message : String(error));
    }
  }
  if (state.tls) {
    try {
      removeFixtureTls(state.tls);
    } catch (error) {
      report.add('fixture-tls-removal-without-throw', false, error && error.message ? error.message : String(error));
    }
  }
  if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  const proof = await cleanupProof({
    ports: [state.transport ? state.transport.port : null, state.hostPort].filter((port) => Number.isInteger(port)),
    pids: [state.host ? state.host.pid : null].filter((pid) => Number.isInteger(pid)),
    dirs: [state.home, tlsDir, fixtureRoot].filter(Boolean),
    label: 'v0-fixture-cleanup',
  });
  report.add('cleanup-ports-refused-pids-dead-dirs-gone', proof.ok, proof);
  return proof;
}

async function body() {
  // 0. Runtime + production-index non-touch snapshot ------------------------
  const identity = verifyRuntime();
  state.productionIndexBefore = productionIndexStat();
  report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);
  report.add('runtime-expected-version', identity.versionsMatchExpected.dsh && identity.versionsMatchExpected.pluginManager, identity.versions);
  report.add('production-index-exists-before-run-snapshot-recorded', true, state.productionIndexBefore);

  // 1. Fixture TLS material -------------------------------------------------
  ensureDir(runDir);
  ensureDir(fixtureRoot);
  const tlsMaterial = createFixtureTls(tlsDir);
  state.tls = tlsMaterial;
  report.add('fixture-ca-and-leaf-generated', fs.existsSync(tlsMaterial.caPem) && fs.existsSync(tlsMaterial.leafPem), {
    openssl: tlsMaterial.opensslVersion,
    caPemSha256: tlsMaterial.caPemSha256,
    leafPemSha256: tlsMaterial.leafPemSha256,
    leafFingerprintSha256: tlsMaterial.leafFingerprintSha256,
    subjectAltName: tlsMaterial.subjectAltName,
    commands: tlsMaterial.commands,
  });
  report.add('fixture-leaf-is-scoped-to-fixed-host', tlsMaterial.subjectAltName === 'DNS:raw.githubusercontent.com', tlsMaterial.subjectAltName);

  // 2. Selective transport up ----------------------------------------------
  const transport = await createIndexTransport({ tlsMaterial, upstreamProxy: PROBE_NETWORK_ENV.HTTPS_PROXY, log });
  state.transport = transport;
  report.add('fixture-proxy-listening', await portAccepting(transport.port), { port: transport.port, origin: transport.origin });
  const fixtureEnv = transport.envForHost({ marker: runTag });
  report.add('fixture-env-derived', fixtureEnv.NODE_USE_ENV_PROXY === '1' && fixtureEnv.NODE_EXTRA_CA_CERTS === tlsMaterial.caPem && fixtureEnv.HTTPS_PROXY === transport.origin, fixtureEnv);
  const fixtureSha256 = transport.fixtureSha256;
  report.add('fixture-body-has-sha256', /^[0-9a-f]{64}$/.test(fixtureSha256), fixtureSha256);

  // 3a. Real global fetch through the fixture (child process) --------------
  const validFetch = await fetchViaChild({ env: fixtureEnv, url: FIXED_INDEX_URL });
  report.add('child-fetch-fixed-url-via-fixture-200', validFetch.ok === true && validFetch.status === 200, {
    status: validFetch.status ?? null,
    bytes: validFetch.bytes ?? null,
    sha256: validFetch.sha256 ?? null,
    error: validFetch.error ?? null,
    env: validFetch.env ?? null,
  });
  report.add('child-fetch-fixed-url-body-is-fixture', validFetch.sha256 === fixtureSha256, { got: validFetch.sha256 ?? null, expected: fixtureSha256 });
  const auditAfterValid = transport.audit();
  const validAuditEntry = auditAfterValid.requests.filter((request) => request.path === new URL(FIXED_INDEX_URL).pathname).at(-1) ?? null;
  report.add('audit-recorded-fixture-mode-fixed-path', validAuditEntry !== null && validAuditEntry.mode === 'fixture' && validAuditEntry.status === 200, validAuditEntry);

  // 3b. Same host, other path -> real origin passthrough (only the fixed URL replaced)
  const passthroughFetch = await fetchViaChild({ env: fixtureEnv, url: PASSTHROUGH_URL });
  const auditAfterPassthrough = transport.audit();
  const passthroughEntry = auditAfterPassthrough.requests.filter((request) => request.path === new URL(PASSTHROUGH_URL).pathname).at(-1) ?? null;
  report.add('only-fixed-url-is-replaced-passthrough-attempted', passthroughEntry !== null && passthroughEntry.mode === 'passthrough', passthroughEntry);
  report.add('passthrough-serves-real-not-fixture-bytes', passthroughFetch.ok === true && passthroughFetch.sha256 !== fixtureSha256 && (passthroughFetch.bodyPrefix ?? '').includes('"name"'), {
    status: passthroughFetch.status ?? null,
    sha256: passthroughFetch.sha256 ?? null,
    bodyPrefix: passthroughFetch.bodyPrefix ?? null,
    error: passthroughFetch.error ?? null,
    note: 'requires the machine network/proxy; transport attempt is asserted above even if the network call fails',
  }, { required: true });

  // 4. Scenario control: HTTP error / oversize / slow ----------------------
  const serverError = transport.control.setScenario('server-error');
  const serverErrorFetch = await fetchViaChild({ env: fixtureEnv, url: FIXED_INDEX_URL });
  report.add('scenario-server-error-503', serverErrorFetch.status === 503, { status: serverErrorFetch.status ?? null, bytes: serverErrorFetch.bytes ?? null, scenario: serverError });
  const auditError = transport.audit();
  const errorEntry = auditError.requests.at(-1) ?? null;
  report.add('audit-recorded-server-error-scenario', errorEntry !== null && errorEntry.scenario === 'server-error' && errorEntry.status === 503, errorEntry);

  transport.control.setScenario('oversize');
  const oversizeFetch = await fetchViaChild({ env: fixtureEnv, url: FIXED_INDEX_URL });
  report.add('scenario-oversize-body-over-256kib', oversizeFetch.ok === true && oversizeFetch.status === 200 && (oversizeFetch.bytes ?? 0) > 256 * 1024, {
    bytes: oversizeFetch.bytes ?? null,
    sha256: oversizeFetch.sha256 ?? null,
    note: 'discovery MUST reject >256 KiB; this proves the fixture can produce that case',
  });

  transport.control.setScenario('slow');
  const slowFetch = await fetchViaChild({ env: fixtureEnv, url: FIXED_INDEX_URL, timeoutMs: 20000 });
  report.add('scenario-slow-delays-response', slowFetch.ok === true && (slowFetch.elapsedMs ?? 0) >= 3500, { elapsedMs: slowFetch.elapsedMs ?? null, status: slowFetch.status ?? null });

  transport.control.setScenario('valid');

  // 5. Negative control: interception is the CA, not a global downgrade ----
  const auditBeforeNoCa = transport.audit();
  const noCaFetch = await fetchViaChild({ env: withoutCa(fixtureEnv), url: FIXED_INDEX_URL });
  const auditNoCa = transport.audit();
  const noCaTlsErrors = auditNoCa.tlsErrors.length - auditBeforeNoCa.tlsErrors.length;
  const certFailure = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(`${noCaFetch.causeCode ?? ''} ${noCaFetch.error ?? ''} ${noCaFetch.stderr ?? ''}`);
  report.add('negative-control-without-fixture-ca-fails-cert-validation', noCaFetch.ok === false && certFailure, {
    child: { ok: noCaFetch.ok, error: noCaFetch.error ?? null, causeCode: noCaFetch.causeCode ?? null, stderr: (noCaFetch.stderr ?? '').slice(0, 800) },
    newTlsHandshakeErrors: noCaTlsErrors,
    note: 'a client-side certificate rejection may not produce a server-side TLS error event; the certificate error code is the decisive proof',
  });
  report.add('negative-control-did-not-serve-fixture-body', noCaFetch.ok === false, noCaFetch.status ?? null);

  // 6. Any other host is tunnelled, never intercepted ----------------------
  const tunnelFetch = await fetchViaChild({ env: fixtureEnv, url: TUNNEL_URL });
  const auditTunnels = transport.audit();
  report.add('other-host-tunnelled-not-intercepted', auditTunnels.tunnels.some((tunnel) => tunnel.target.startsWith('api.github.com:')), auditTunnels.tunnels);
  report.record('other-host-tunnel-real-response', { status: tunnelFetch.status ?? null, bytes: tunnelFetch.bytes ?? null, error: tunnelFetch.error ?? null }, { required: false });

  // 7. End-to-end proof inside the REAL isolated DSH Host process ----------
  const homeName = `${RUN_PREFIX}-${runTag}`;
  const home = await makeIsolatedHome(homeName, { port: await freePort() });
  state.home = home;
  const hostPort = await freePort();
  state.hostPort = hostPort;
  const hostEnv = { ...fixtureEnv, /* real proxy env is irrelevant here: the fixture proxies other hosts through it */ };
  const auditBeforeHost = transport.audit();
  const { host, probe, boot } = await bootProbeHost({
    name: homeName,
    home,
    runDir,
    bootTag: runTag,
    port: hostPort,
    env: hostEnv,
    pluginMode: 'none',
    logName: `${homeName}-host`,
  });
  state.host = host;
  report.add('isolated-dsh-host-boots-with-fixture-env', boot.bootTag === runTag && boot.env?.fixtureRunTag === runTag, {
    pid: boot.pid,
    nodeVersion: boot.nodeVersion,
    env: boot.env,
    managerMethodsPresent: (boot.managerInternal?.methods ?? []).includes('installBundle'),
  });
  report.add('host-env-carries-fixture-ca-and-env-proxy', boot.env?.hasUseEnvProxy === '1' && boot.env?.extraCaCerts === path.basename(tlsMaterial.caPem), { env: boot.env, expectedCaBasename: path.basename(tlsMaterial.caPem) });

  const hostFetch = await probe.send({ id: 'v0-fetch-fixed-index', action: 'fetch-fixed-index', url: FIXED_INDEX_URL, timeoutMs: 15000 });
  report.add('host-process-fetch-fixed-url-returns-fixture', hostFetch.ok === true && hostFetch.status === 200 && hostFetch.sha256 === fixtureSha256, {
    status: hostFetch.status ?? null,
    bytes: hostFetch.bytes ?? null,
    sha256: hostFetch.sha256 ?? null,
    bodyPrefix: (hostFetch.bodyTextPrefix ?? '').slice(0, 400),
    error: hostFetch.error ?? null,
    hostPid: boot.pid,
  });
  const auditAfterHost = transport.audit();
  const hostAuditRequests = auditAfterHost.requests.slice(auditBeforeHost.requests.length);
  const hostFixedRequest = hostAuditRequests.filter((request) => request.path === new URL(FIXED_INDEX_URL).pathname).at(-1) ?? null;
  report.add('host-fetch-observed-by-fixture-audit', hostFixedRequest !== null && hostFixedRequest.mode === 'fixture', { requestCountDuringHost: hostAuditRequests.length, fixedRequest: hostFixedRequest });
  report.add('host-fetch-recorded-as-fixture-not-passthrough', hostFixedRequest !== null && hostFixedRequest.mode === 'fixture', hostFixedRequest);

  // 8. Production index untouched -----------------------------------------
  const productionIndexAfter = productionIndexStat();
  const untouched = JSON.stringify(state.productionIndexBefore) === JSON.stringify(productionIndexAfter);
  report.add('production-index-not-written-or-modified', untouched, { before: state.productionIndexBefore, after: productionIndexAfter, repoPath: PRODUCTION_INDEX_REPO_PATH });

  return { identity, fixtureSha256, transport: transport.audit(), hostEvidence: { boot, fetch: hostFetch } };
}

const results = await runWithCleanup({ report, runDir, cleanup, body });
const evidence = finalizeRun({
  report,
  evidenceRel,
  runDir,
  extra: {
    runTag,
    evidenceLevel: 'isolated transport fixture (isolated real DSH host process + real Node global fetch; production index untouched)',
    notProven: [
      'the real production index content',
      'real Desktop/Electron main-process networking (fixture is verified against the isolated `dsh web` process)',
      'that the fixed URL is currently served with this fixture body (fixture bodies are verification data)',
    ],
    fixtureMethod: 'selective TLS interception proxy (NODE_USE_ENV_PROXY + NODE_EXTRA_CA_CERTS) with exact host+path fixture, real passthrough for other paths and opaque tunnels for other hosts',
    fixedIndexUrl: FIXED_INDEX_URL,
    fixture: results.cleanupResult && state.transport ? {
      tls: {
        caPemSha256: state.tls?.caPemSha256 ?? null,
        leafPemSha256: state.tls?.leafPemSha256 ?? null,
        leafFingerprintSha256: state.tls?.leafFingerprintSha256 ?? null,
        subjectAltName: state.tls?.subjectAltName ?? null,
      },
    } : null,
    cleanupProof: results.cleanupResult,
    environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
    commands: report.commands,
    thrown: results.thrown ? String(results.thrown.stack ?? results.thrown) : null,
  },
});
process.exitCode = evidence.summary.passed ? 0 : 1;
