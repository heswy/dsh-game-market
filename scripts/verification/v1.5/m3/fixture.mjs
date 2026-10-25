#!/usr/bin/env node
/**
 * M3 transport fixture for the FIXED official plugin-market index URL.
 *
 * The product MUST keep using the frozen URL
 *   https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json
 * and its own HTTPS/policy code. To feed verification data without writing the
 * production index or weakening the URL policy, the isolated probe Host process
 * is started with a *transport-layer* fixture:
 *
 *   - a local selective TLS-interception proxy listens on 127.0.0.1;
 *   - the Host process gets `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY=<proxy>` so
 *     Node's real global `fetch` uses the proxy (Node >= 24 feature), and
 *     `NODE_EXTRA_CA_CERTS=<fixture CA>` so the fixture's leaf certificate for
 *     raw.githubusercontent.com validates exactly like a real certificate;
 *   - ONLY the exact fixed URL's path is answered from the fixture. Every other
 *     path on the same host is passed through to the real origin (through the
 *     machine's normal proxy) byte-for-byte, and every other host is tunnelled
 *     untouched. The audit log records which mode served each request, so a
 *     reader can verify that nothing but the fixed URL was replaced;
 *   - CA/leaf material is generated with the system `openssl` into a scratch
 *     dir under /tmp/dsh-v15/m3 and removed on cleanup. No user/App/git config
 *     is modified, and nothing is written to the repository except evidence.
 *
 * Honest evidence level: `isolated transport fixture`. It is NOT a real
 * production-index fetch, NOT real Desktop/Electron networking, and it does not
 * prove the public index's current content. It proves the discovery code can be
 * exercised end-to-end against its fixed URL inside the real isolated DSH host.
 *
 * Scenario control allows later M3-V2 cases (HTTP error, oversize body, slow
 * response, malformed JSON) without changing the product or the URL.
 */
import fs from 'node:fs';
import net from 'node:net';
import { buildHostNetworkEnv, resolveNetworkMode, networkModeLabel } from './network-env.mjs';
import tls from 'node:tls';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync, spawnSync } from 'node:child_process';

export const FIXED_INDEX_URL = 'https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json';
export const FIXED_INDEX_HOST = 'raw.githubusercontent.com';
export const FIXED_INDEX_PATH = '/heswy/dsh-game-market/main/platform-updates/plugins.json';
export const DEFAULT_UPSTREAM_PROXY = 'http://127.0.0.1:7897';

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function message(error) {
  return String(error && error.message ? error.message : error);
}

// ---------------------------------------------------------------------------
// TLS material (system openssl, scratch dir only)
// ---------------------------------------------------------------------------

/**
 * Generate a throwaway CA + a leaf certificate for the fixed index host.
 * Returns paths, SHA-256 digests and the openssl invocation records.
 */
export function createFixtureTls(dir) {
  ensureDir(dir);
  const paths = {
    dir,
    caKey: path.join(dir, 'fixture-ca.key'),
    caPem: path.join(dir, 'fixture-ca.pem'),
    leafKey: path.join(dir, 'fixture-leaf.key'),
    leafCsr: path.join(dir, 'fixture-leaf.csr'),
    leafPem: path.join(dir, 'fixture-leaf.pem'),
    extFile: path.join(dir, 'fixture-leaf.ext.cnf'),
    opensslVersion: null,
    commands: [],
  };
  const run = (args) => {
    paths.commands.push(`openssl ${args.join(' ')}`);
    return execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  };
  run(['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '3',
    '-keyout', paths.caKey, '-out', paths.caPem,
    '-subj', '/CN=DSH V1.5 M3 Verification Fixture CA',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  run(['req', '-newkey', 'rsa:2048', '-sha256', '-nodes',
    '-keyout', paths.leafKey, '-out', paths.leafCsr,
    '-subj', '/CN=raw.githubusercontent.com']);
  fs.writeFileSync(paths.extFile, [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    'subjectAltName=DNS:raw.githubusercontent.com',
    '',
  ].join('\n'), 'utf8');
  run(['x509', '-req', '-in', paths.leafCsr, '-CA', paths.caPem, '-CAkey', paths.caKey,
    '-CAcreateserial', '-out', paths.leafPem, '-days', '3', '-sha256', '-extfile', paths.extFile]);
  paths.opensslVersion = execFileSync('openssl', ['version'], { encoding: 'utf8' }).trim();
  const leaf = fs.readFileSync(paths.leafPem);
  const ca = fs.readFileSync(paths.caPem);
  const fingerprint = execFileSync('openssl', ['x509', '-in', paths.leafPem, '-noout', '-fingerprint', '-sha256'], { encoding: 'utf8' }).trim();
  return {
    ...paths,
    caPemSha256: sha256(ca),
    leafPemSha256: sha256(leaf),
    leafFingerprintSha256: fingerprint.replace(/^.*?=/, ''),
    subjectAltName: 'DNS:raw.githubusercontent.com',
    validDays: 3,
  };
}

/** Remove the scratch TLS directory (private keys must not outlive the run). */
export function removeFixtureTls(created) {
  if (!created || !created.dir) return false;
  fs.rmSync(created.dir, { recursive: true, force: true });
  return true;
}

// ---------------------------------------------------------------------------
// Fixture bodies (scenario map)
// ---------------------------------------------------------------------------

/**
 * Default fixture body. IMPORTANT: this is a verification fixture, not the
 * production index and not the authoritative schema. The frozen format-1
 * validator (M3-H1) is the authority once implemented; these bodies are shaped
 * so they can be swapped for validator-conformant fixtures without touching the
 * transport. `scenarioBodies` is intentionally data-only.
 */
export function defaultFixtureBody() {
  // Exact DSH plugin-market-index format-1 shape (as accepted by the frozen
  // strict validator in packages/shared/src/platform-update.js). The content is
  // verification data, not the production index; callers overwrite it per case.
  return `${JSON.stringify({
    format: 1,
    title: { en: 'DSH plugin index (M3 verification fixture)', zh: 'DSH 插件索引（M3 验证夹具）' },
    plugins: [
      {
        name: 'dsh-game-market',
        versions: [
          {
            version: '1.2.0',
            publishTimestamp: 1761000000,
            source: {
              type: 'git',
              url: 'https://github.com/heswy/dsh-game-market.git',
              commit: 'f422e8d04b3b3de3f920a794317c0d28ee1246a2',
            },
          },
        ],
      },
    ],
  }, null, 2)}\n`;
}

function defaultScenarios() {
  return new Map([
    ['valid', { kind: 'fixture', status: 200, contentType: 'application/json', body: defaultFixtureBody() }],
    ['server-error', { kind: 'fixture', status: 503, contentType: 'text/plain', body: 'fixture: upstream error\n' }],
    ['malformed-json', { kind: 'fixture', status: 200, contentType: 'application/json', body: '{ this is not json\n' }],
    ['oversize', { kind: 'fixture', status: 200, contentType: 'application/json', body: `{"padding":"${'x'.repeat(300 * 1024)}"}\n` }],
    ['slow', { kind: 'fixture', status: 200, contentType: 'application/json', body: defaultFixtureBody(), delayMs: 4000 }],
    // Deliberately longer than the frozen 5s whole-index budget (discovery timeout case).
    ['timeout', { kind: 'fixture', status: 200, contentType: 'application/json', body: defaultFixtureBody(), delayMs: 8000 }],
    // Connection dies before any HTTP response (network-failure/offline case).
    ['abort', { kind: 'abort' }],
    // Redirect policy cases: http downgrade is rejected; a loop exceeds maxRedirects=3.
    ['redirect-http', { kind: 'redirect', status: 302, location: 'http://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json' }],
    ['redirect-loop', { kind: 'redirect', status: 302, location: 'https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json' }],
  ]);
}

// ---------------------------------------------------------------------------
// Data-plane helpers: real origin passthrough through the machine proxy
// ---------------------------------------------------------------------------

// Current machine topology (2026-10-21): the DNS-resolved github.com address is
// blocked and the local proxy flaps. These alternate GitHub IPs are reachable;
// git/libcurl pins them per-host via http.curloptResolve (proven by Lead), and
// the TLS servername stays the real hostname.
const PINNED_RESOLVES = {
  'github.com': '140.82.112.3',
  'codeload.github.com': '140.82.112.3',
  'raw.githubusercontent.com': '185.199.108.133',
};
const RESOLVE_CONFIG_ENTRIES = Object.entries(PINNED_RESOLVES).map(([host, ip]) => `${host}:443:${ip}`);

/** GIT_CONFIG_* env that pins GitHub hosts to reachable IPs (applies to git and to pnpm's git shell-outs). */
function pinnedGitEnv() {
  const env = { GIT_CONFIG_COUNT: String(RESOLVE_CONFIG_ENTRIES.length) };
  RESOLVE_CONFIG_ENTRIES.forEach((entry, index) => {
    env[`GIT_CONFIG_KEY_${index}`] = 'http.curloptResolve';
    env[`GIT_CONFIG_VALUE_${index}`] = entry;
  });
  return env;
}

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'npm_config_https_proxy', 'npm_config_http_proxy', 'npm_config_proxy'];

/** Connect directly to host:port (no proxy) with a bounded timeout; pinned IP first. */
function connectDirect(host, port = 443, timeoutMs = 20000) {
  const targetHost = PINNED_RESOLVES[host] ?? host;
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: targetHost, port });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => fail(new Error(`direct connect ${host}:${port} timed out`)));
    socket.once('error', fail);
    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      resolve({ socket, mode: PINNED_RESOLVES[host] ? 'pinned' : 'direct', resolvedAddress: targetHost });
    });
  });
}

/**
 * Open a TCP tunnel with recorded network mode: DIRECT first (current machine
 * topology), falling back to the configured upstream proxy only when direct
 * fails. The chosen mode is recorded by the transport audit.
 */
async function openTunnel(host, port, { proxyUrl = null, timeoutMs = 20000 } = {}) {
  try {
    return await connectDirect(host, port, timeoutMs);
  } catch (directError) {
    if (proxyUrl === null) throw directError;
    const viaProxy = await connectViaProxy(proxyUrl, host, port, timeoutMs);
    return { ...viaProxy, mode: 'proxy', directError: message(directError) };
  }
}

/** CONNECT through the environment's HTTP proxy and return the raw tunnel. */
function connectViaProxy(proxyUrl, host, port = 443, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port || 80) });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => fail(new Error(`proxy CONNECT ${host}:${port} timed out`)));
    socket.once('error', fail);
    let buffered = Buffer.alloc(0);
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end === -1) return;
      socket.removeListener('data', onData);
      socket.once('error', () => { /* tunnel errors surface on the caller side */ });
      const statusLine = buffered.subarray(0, buffered.indexOf('\r\n')).toString('latin1');
      const match = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})/);
      if (!match || Number(match[1]) !== 200) {
        fail(new Error(`proxy CONNECT ${host}:${port} refused: ${statusLine}`));
        return;
      }
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      const rest = buffered.subarray(end + 4);
      resolve({ socket, rest });
    };
    socket.on('data', onData);
    socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
  });
}

/**
 * Fetch one real path from the real origin through the machine proxy, at the
 * TLS layer (the proxy tunnels HTTPS; no certificate interception happens for
 * passthrough traffic). Used only to prove "non-fixture paths are untouched".
 */
async function fetchRealThroughProxy({ proxyUrl, host, port = 443, requestPath, method = 'GET', headers = {}, timeoutMs = 25000 }) {
  // Direct first (current topology), proxy fallback. Returns { mode } for audit.
  try {
    const { socket } = await connectDirect(host, port, timeoutMs);
    return await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        try { secure.destroy(); } catch { /* ignore */ }
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const secure = tls.connect({ socket, servername: host, ALPNProtocols: ['http/1.1'] }, () => {
        secure.write([
          `${method} ${requestPath} HTTP/1.1`,
          `Host: ${host}`,
          ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
          'Connection: close',
          'Accept-Encoding: identity',
          '',
          '',
        ].join('\r\n'));
      });
      const chunks = [];
      secure.setTimeout(timeoutMs);
      secure.once('timeout', () => fail(new Error(`direct fetch ${host}${requestPath} timed out`)));
      secure.once('error', fail);
      secure.on('data', (chunk) => chunks.push(chunk));
      secure.once('end', () => {
        if (settled) return;
        settled = true;
        resolve(parseRawHttpResponse(Buffer.concat(chunks), 'direct'));
      });
    });
  } catch (directError) {
    const { socket, rest } = await connectViaProxy(proxyUrl, host, port, timeoutMs);
    return fetchOverTunnelSocket({ socket, rest, host, requestPath, method, headers, timeoutMs, mode: 'proxy', directError: message(directError) });
  }
}

/** Parse a raw HTTP/1.1 response body+status (shared by direct/proxy paths). */
function parseRawHttpResponse(raw, mode) {
  const split = raw.indexOf('\r\n\r\n');
  const headerText = split === -1 ? raw.toString('latin1') : raw.subarray(0, split).toString('latin1');
  const statusMatch = headerText.match(/^HTTP\/1\.[01]\s+(\d{3})/);
  return {
    mode,
    status: statusMatch ? Number(statusMatch[1]) : null,
    headers: headerText.split('\r\n').slice(1),
    bytes: raw.length,
    bodyPrefix: (split === -1 ? '' : raw.subarray(split + 4, split + 4 + 512).toString('utf8')),
    raw,
  };
}

/** Fetch over an already-established CONNECT tunnel (proxy mode fallback). */
function fetchOverTunnelSocket({ socket, rest, host, requestPath, method, headers, timeoutMs, mode, directError = null }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { secure.destroy(); } catch { /* ignore */ }
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const secure = tls.connect({ socket, servername: host, ALPNProtocols: ['http/1.1'] }, () => {
      secure.write([
        `${method} ${requestPath} HTTP/1.1`,
        `Host: ${host}`,
        ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
        'Connection: close',
        'Accept-Encoding: identity',
        '',
        '',
      ].join('\r\n'));
      if (rest && rest.length > 0) secure.write(rest);
    });
    const chunks = [];
    secure.setTimeout(timeoutMs);
    secure.once('timeout', () => fail(new Error(`proxy fetch ${host}${requestPath} timed out`)));
    secure.once('error', fail);
    secure.on('data', (chunk) => chunks.push(chunk));
    secure.once('end', () => {
      if (settled) return;
      settled = true;
      const parsed = parseRawHttpResponse(Buffer.concat(chunks), mode);
      parsed.directError = directError;
      resolve(parsed);
    });
  });
}

// ---------------------------------------------------------------------------
// Selective TLS-interception proxy
// ---------------------------------------------------------------------------

/**
 * Start the selective fixture proxy.
 *
 * Modes recorded per request:
 *   - `fixture`:   exact fixed host+path answered from the scenario body;
 *   - `passthrough`: same host, any other path — real origin content, raw bytes;
 *   - `tunnel`:    any other host — opaque CONNECT tunnel to the real network;
 *   - `rejected`:  non-CONNECT proxy requests (plain HTTP) — refused.
 */
export async function createIndexTransport({
  tlsMaterial,
  upstreamProxy = DEFAULT_UPSTREAM_PROXY,
  fixedHost = FIXED_INDEX_HOST,
  fixedPath = FIXED_INDEX_PATH,
  requestTimeoutMs = 30000,
  log = () => {},
} = {}) {
  const secureContext = tls.createSecureContext({
    key: fs.readFileSync(tlsMaterial.leafKey),
    cert: fs.readFileSync(tlsMaterial.leafPem),
    ca: fs.readFileSync(tlsMaterial.caPem),
  });
  const state = {
    scenario: 'valid',
    scenarios: defaultScenarios(),
    connects: [],
    requests: [],
    tunnels: [],
    tlsErrors: [],
    rejected: [],
    sockets: new Set(),
    closed: false,
  };
  const fixtureBody = () => state.scenarios.get(state.scenario).body;
  const startScenario = () => ({ scenario: state.scenario });

  function track(socket) {
    state.sockets.add(socket);
    socket.once('close', () => state.sockets.delete(socket));
    return socket;
  }

  function parseRequest(buffer) {
    const split = buffer.indexOf('\r\n\r\n');
    if (split === -1) return null;
    const headerText = buffer.subarray(0, split).toString('latin1');
    const lines = headerText.split('\r\n');
    const match = lines[0].match(/^([A-Z]+)\s+(\S+)\s+HTTP\/1\.[01]$/);
    if (!match) return { error: `bad request line: ${lines[0]}` };
    const headers = {};
    for (const line of lines.slice(1)) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    return { method: match[1], requestPath: match[2], headers, headerLength: split + 4, raw: buffer.subarray(0, split + 4) };
  }

  const STATUS_TEXT = { 200: 'OK', 302: 'Found', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 502: 'Bad Gateway', 503: 'Service Unavailable' };

  function writeResponse(socket, { status = 200, contentType = 'application/json', body = '', extraHeaders = [] }) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const head = [
      `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Status'}`,
      `Content-Type: ${contentType}`,
      `Content-Length: ${payload.length}`,
      'Connection: close',
      ...extraHeaders,
      '',
      '',
    ].join('\r\n');
    socket.write(head);
    socket.write(payload);
    socket.end();
  }

  async function serveIntercepted(index, tlsSocket, request) {
    const scenario = state.scenarios.get(state.scenario);
    const record = {
      at: new Date().toISOString(),
      mode: null,
      host: fixedHost,
      method: request.method,
      path: request.requestPath,
      scenario: state.scenario,
      status: null,
      bytes: null,
      sha256: null,
    };
    state.requests.push(record);
    if (request.requestPath !== fixedPath) {
      record.mode = 'passthrough';
      try {
        const real = await fetchRealThroughProxy({
          proxyUrl: upstreamProxy,
          host: fixedHost,
          requestPath: request.requestPath,
          method: request.method,
          headers: { 'user-agent': request.headers['user-agent'] ?? 'm3-fixture-proxy' },
          timeoutMs: requestTimeoutMs,
        });
        record.status = real.status;
        record.bytes = real.bytes;
        record.sha256 = sha256(real.raw);
        if (real.raw.length > 0) tlsSocket.write(real.raw);
        tlsSocket.end();
      } catch (error) {
        record.error = message(error);
        writeResponse(tlsSocket, { status: 502, contentType: 'text/plain', body: `fixture passthrough failed: ${message(error)}\n` });
      }
      return;
    }
    record.mode = 'fixture';
    if (scenario.kind === 'abort') {
      record.aborted = true;
      record.status = null;
      record.bytes = 0;
      record.sha256 = null;
      tlsSocket.destroy();
      return;
    }
    if (scenario.kind === 'redirect') {
      record.kind = 'redirect';
      record.status = scenario.status ?? 302;
      record.location = scenario.location ?? null;
      record.bytes = 0;
      record.sha256 = null;
      writeResponse(tlsSocket, {
        status: record.status,
        contentType: 'text/plain',
        body: 'fixture redirect\n',
        extraHeaders: [`Location: ${scenario.location}`],
      });
      return;
    }
    record.status = scenario.status ?? 200;
    record.bytes = Buffer.byteLength(scenario.body ?? '');
    record.sha256 = sha256(Buffer.from(scenario.body ?? '', 'utf8'));
    record.contentType = scenario.contentType ?? 'application/json';
    const respond = () => {
      if (tlsSocket.destroyed) return;
      writeResponse(tlsSocket, {
        status: record.status,
        contentType: record.contentType,
        body: Buffer.from(scenario.body ?? '', 'utf8'),
      });
      log(`fixture served ${request.method} ${request.requestPath} scenario=${state.scenario} status=${record.status} bytes=${record.bytes}`);
    };
    if (scenario.delayMs) setTimeout(respond, scenario.delayMs);
    else respond();
  }

  function handleConnect(req, clientSocket, head) {
    track(clientSocket);
    const target = req.url ?? '';
    const [host, portText] = target.split(':');
    const port = Number(portText || 443);
    clientSocket.on('error', (error) => {
      state.tlsErrors.push({ at: new Date().toISOString(), host, stage: 'client-socket', error: message(error) });
    });
    if (host !== fixedHost || port !== 443) {
      // Opaque tunnel: any other host is not intercepted at all.
      state.tunnels.push({ at: new Date().toISOString(), target });
      openTunnel(host, port, { proxyUrl: upstreamProxy, timeoutMs: requestTimeoutMs }).then(({ socket, rest, mode }) => {
        state.tunnels.push({ at: new Date().toISOString(), target, mode });
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest && rest.length > 0) socket.write(rest);
        socket.pipe(clientSocket);
        clientSocket.pipe(socket);
        socket.on('error', (error) => state.tunnels.push({ at: new Date().toISOString(), target, error: message(error) }));
        clientSocket.on('close', () => socket.destroy());
        socket.on('close', () => clientSocket.destroy());
      }).catch((error) => {
        if (!clientSocket.destroyed) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        state.tunnels.push({ at: new Date().toISOString(), target, error: message(error) });
      });
      return;
    }

    state.connects.push({ at: new Date().toISOString(), target, intercepted: true });
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length > 0) {
      // Early TLS bytes: hand them to the TLS socket as if read from the wire.
    }
    const tlsSocket = track(new tls.TLSSocket(clientSocket, {
      isServer: true,
      secureContext,
      ALPNProtocols: ['http/1.1'],
    }));
    tlsSocket.setTimeout(requestTimeoutMs);
    tlsSocket.once('timeout', () => tlsSocket.destroy());
    tlsSocket.on('error', (error) => {
      state.tlsErrors.push({ at: new Date().toISOString(), host, stage: 'tls', error: message(error) });
    });
    let buffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
    let busy = false;
    tlsSocket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (busy) return;
      const request = parseRequest(buffer);
      if (!request) return;
      if (request.error) {
        state.rejected.push({ at: new Date().toISOString(), target, error: request.error });
        tlsSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      busy = true;
      const index = state.requests.length;
      void serveIntercepted(index, tlsSocket, request);
    });
  }

  // Isolated git config for the HOST process: pins reachable GitHub IPs and
  // disables proxying for git/pnpm, while the host's Node fetch keeps using
  // this fixture proxy for the fixed index URL. Written per scenario dir.
  const scenarioDir = path.dirname(tlsMaterial.caPem);
  const hostGitConfigPath = path.join(scenarioDir, 'host-gitconfig');
  // Deterministic offline install transport: when the Lead-provided local bare
  // mirror config exists, it rewrites the official git URL to the mirror
  // (url.insteadOf). Commits are identical to origin; the production transport
  // is unchanged. Recorded in evidence as isolated-mirror mode.
  const MIRROR_CONFIG = '/tmp/m3-mirror-gitconfig';
  const mirrorAvailable = fs.existsSync(MIRROR_CONFIG);
  const hostGitConfigFinal = mirrorAvailable ? MIRROR_CONFIG : hostGitConfigPath;
  if (mirrorAvailable) {
    fs.writeFileSync('/tmp/dsh-v15/m3/mirror-mode', '1', 'utf8');
  }
  fs.writeFileSync(hostGitConfigPath, [
    '[http]',
    ...RESOLVE_CONFIG_ENTRIES.map((entry) => `\tcurloptResolve = ${entry}`),
    '',
  ].join('\n'), 'utf8');

  // Verification-only DNS pin preload for the isolated HOST process: the
  // machine's resolver intermittently returns wildcard/blocked records for the
  // GitHub hosts (e.g. raw.githubusercontent.com -> ::/0.0.0.0), which makes the
  // product's public-destination guard reject the frozen index URL before the
  // fixture proxy ever sees the request. The preload pins only these three
  // hostnames to the reachable public IPs; no product code is modified.
  const dnsPinPath = path.join(scenarioDir, 'dns-pin.cjs');
  fs.writeFileSync(dnsPinPath, `'use strict';
const dns = require('node:dns');
const PINNED = ${JSON.stringify({ 'github.com': '140.82.112.3', 'codeload.github.com': '140.82.112.3', 'raw.githubusercontent.com': '185.199.108.133' })};
function pick(hostname) { return PINNED[String(hostname).toLowerCase()] || null; }
const originalLookup = dns.lookup;
dns.lookup = function patchedLookup(hostname, options, callback) {
  let opts = options;
  let cb = callback;
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  const ip = pick(hostname);
  if (ip === null) return originalLookup.call(dns, hostname, opts, cb);
  if (opts && opts.all === true) return process.nextTick(() => cb(null, [{ address: ip, family: 4 }]));
  return process.nextTick(() => cb(null, ip, 4));
};
const originalPromiseLookup = dns.promises.lookup;
dns.promises.lookup = async function patchedPromiseLookup(hostname, options) {
  const ip = pick(hostname);
  if (ip === null) return originalPromiseLookup.call(dns.promises, hostname, options);
  if (options && options.all === true) return [{ address: ip, family: 4 }];
  return { address: ip, family: 4 };
};
`, 'utf8');

  const server = http.createServer((req, res) => {
    // A plain HTTP proxy request would mean product code downgraded to http://.
    state.rejected.push({ at: new Date().toISOString(), method: req.method, url: req.url, reason: 'plain-http-request-refused' });
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('fixture proxy accepts CONNECT over TLS only\n');
  });
  server.on('connect', handleConnect);
  server.on('clientError', (error, socket) => {
    state.rejected.push({ at: new Date().toISOString(), reason: 'client-error', error: message(error) });
    try { socket.destroy(); } catch { /* ignore */ }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = server.address().port;

  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    tlsMaterial,
    get fixtureSha256() {
      return sha256(Buffer.from(fixtureBody(), 'utf8'));
    },
    control: {
      /** Replace the body served for the fixed URL by the 'valid' scenario. */
      setFixtureBody(body) {
        const scenario = state.scenarios.get('valid');
        scenario.body = typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`;
        scenario.status = 200;
        scenario.contentType = 'application/json';
        state.scenario = 'valid';
        return { scenario: 'valid', bytes: Buffer.byteLength(scenario.body), sha256: sha256(Buffer.from(scenario.body, 'utf8')) };
      },
      setScenario(scenarioName) {
        if (!state.scenarios.has(scenarioName)) throw new Error(`unknown fixture scenario ${scenarioName}`);
        state.scenario = scenarioName;
        return { scenario: scenarioName, bodyBytes: Buffer.byteLength(state.scenarios.get(scenarioName).body ?? ''), status: state.scenarios.get(scenarioName).status ?? 200 };
      },
      current: () => startScenario(),
      scenarios: () => [...state.scenarios.keys()],
    },
    /** Environment for the isolated probe Host process (and its child fetch tests). */
    /**
     * Self-check the exact isolated host network env before launching:
     *  a) git ls-remote with the FULL env (proxy path: fixture CONNECT tunnels);
     *  b) git ls-remote with proxy vars scrubbed (the native manager's
     *     github preflight path: GIT_CONFIG_* pins must resolve reachable IPs).
     * Retries because the machine's link flaps; the result is recorded.
     */
    async validateHostNetworkEnv({ attempts = 3, timeoutMs = 30000 } = {}) {
      if (this.hostEnvCheck !== undefined) return this.hostEnvCheck;
      const fullEnv = { ...process.env, ...this.envForHost({ marker: 'host-env-selfcheck' }) };
      const scrubbed = { ...fullEnv };
      for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'npm_config_https_proxy', 'npm_config_http_proxy', 'npm_config_proxy']) delete scrubbed[key];
      const runGit = (env) => {
        const args = ['ls-remote', 'https://github.com/heswy/dsh-game-market.git', 'HEAD'];
        const result = spawnSync('git', args, { encoding: 'utf8', env, timeout: timeoutMs, killSignal: 'SIGKILL' });
        return { ok: result.status === 0, status: result.status, stderr: (result.stderr || '').split(String.fromCharCode(10)).slice(-2).join(' | '), stdout: (result.stdout || '').split(String.fromCharCode(10))[0] ?? null };
      };
      const fullAttempts = [];
      let full = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        full = await runGit(fullEnv);
        fullAttempts.push({ attempt, ...full });
        if (full.ok) break;
      }
      const scrubbedAttempts = [];
      let scrubbedResult = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        scrubbedResult = await runGit(scrubbed);
        scrubbedAttempts.push({ attempt, ...scrubbedResult });
        if (scrubbedResult.ok) break;
      }
      this.hostEnvCheck = {
        // The native manager's github preflight runs with the scrubbed env
        // (proxy vars dropped, GIT_CONFIG_GLOBAL kept), so the scrubbed check
        // is the required gate; the full-env check is informational.
        ok: scrubbedResult !== null && scrubbedResult.ok === true,
        gitVersion: (spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout || '').trim(),
        envKeys: Object.keys(this.envForHost({ marker: 'host-env-selfcheck' })).sort(),
        full: { ok: full !== null && full.ok, attempts: fullAttempts },
        scrubbed: { ok: scrubbedResult !== null && scrubbedResult.ok, attempts: scrubbedAttempts },
        networkMode: resolveNetworkMode(),
        networkModeLabel: networkModeLabel(resolveNetworkMode()),
        pinned: PINNED_RESOLVES,
      };
      if (this.hostEnvCheck.ok !== true) {
        console.warn('[m3] host network env self-check failed:', JSON.stringify({
          full: this.hostEnvCheck.full.attempts.map((a) => a.stderr),
          scrubbed: this.hostEnvCheck.scrubbed.attempts.map((a) => a.stderr),
        }));
      }
      return this.hostEnvCheck;
    },

    envForHost({ marker = null } = {}) {
      const proxy = `http://127.0.0.1:${port}`;
      const mode = resolveNetworkMode();
      // ONE env builder for every runner (see network-env.mjs). The fixture
      // proxy/CA/DNS-pin vars are local-only; the network-mode vars decide how
      // git/pnpm reach the exact commits (default: isolated local mirror).
      return {
        NODE_USE_ENV_PROXY: '1',
        NODE_EXTRA_CA_CERTS: tlsMaterial.caPem,
        HTTPS_PROXY: proxy,
        HTTP_PROXY: proxy,
        ALL_PROXY: proxy,
        npm_config_https_proxy: proxy,
        npm_config_http_proxy: proxy,
        npm_config_proxy: proxy,
        NODE_OPTIONS: `--require ${dnsPinPath}`,
        ...buildHostNetworkEnv({ mode, marker }),
        M3_NETWORK_MODE_LABEL: networkModeLabel(mode),
      };
    },
    audit() {
      const count = (mode) => state.requests.filter((request) => request.mode === mode).length;
      return {
        scenarioSequence: state.requests.map((request) => request.scenario),
        connects: state.connects.slice(),
        tunnels: state.tunnels.slice(),
        tlsErrors: state.tlsErrors.slice(),
        rejected: state.rejected.slice(),
        requests: state.requests.slice(),
        counts: {
          fixtureRequests: count('fixture'),
          passthroughRequests: count('passthrough'),
          tunnelConnects: state.tunnels.length,
          rejectedPlainHttp: state.rejected.length,
          tlsHandshakeErrors: state.tlsErrors.filter((entry) => entry.stage === 'tls').length,
        },
      };
    },
    async close() {
      if (state.closed) return { closed: true, alreadyClosed: true };
      state.closed = true;
      for (const socket of state.sockets) {
        try { socket.destroy(); } catch { /* ignore */ }
      }
      state.sockets.clear();
      await new Promise((resolve) => server.close(() => resolve()));
      return { closed: true, alreadyClosed: false };
    },
  };
}

// ---------------------------------------------------------------------------
// Child-process real-fetch proof (same wire path as the Host's global fetch)
// ---------------------------------------------------------------------------

const CHILD_FETCH_SCRIPT = `
const url = process.env.M3_FETCH_URL;
const timeoutMs = Number(process.env.M3_FETCH_TIMEOUT_MS || '15000');
const startedAt = Date.now();
try {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'm3-fixture-child' },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const { createHash } = await import('node:crypto');
  console.log(JSON.stringify({
    ok: true,
    status: response.status,
    redirected: response.redirected,
    location: response.headers.get('location'),
    contentType: response.headers.get('content-type'),
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bodyPrefix: buffer.subarray(0, 512).toString('utf8'),
    elapsedMs: Date.now() - startedAt,
    env: {
      NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? null,
      hasExtraCaCerts: Boolean(process.env.NODE_EXTRA_CA_CERTS),
      httpsProxy: process.env.HTTPS_PROXY ?? null,
      noProxy: process.env.NO_PROXY ?? null,
    },
  }));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    name: error?.name ?? null,
    error: String(error?.message ?? error),
    causeCode: error?.cause?.code ?? null,
    elapsedMs: Date.now() - startedAt,
    env: {
      NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? null,
      hasExtraCaCerts: Boolean(process.env.NODE_EXTRA_CA_CERTS),
      httpsProxy: process.env.HTTPS_PROXY ?? null,
    },
  }));
  process.exitCode = 1;
}
`;

/**
 * Fetch `url` from a fresh `node` child process with exactly `env` on top of the
 * current environment. This is the same global-fetch code path the Host uses,
 * so it is a valid pre-Host proof of the transport fixture.
 */
export async function fetchViaChild({ env, url, timeoutMs = 20000 }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_FETCH_SCRIPT], {
      env: { ...process.env, ...env, M3_FETCH_URL: url, M3_FETCH_TIMEOUT_MS: String(timeoutMs) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve({ ok: false, timedOut: true, error: `child fetch timed out after ${timeoutMs + 5000}ms`, stdout, stderr, elapsedMs: Date.now() - startedAt });
    }, timeoutMs + 5000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const line = stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
      let parsed = null;
      try { parsed = JSON.parse(line); } catch { parsed = null; }
      resolve({ exitCode: code, ...(parsed ?? { ok: false, error: 'unparseable child output' }), stdout, stderr, elapsedMs: Date.now() - startedAt });
    });
  });
}

export { sha256, sleep };
