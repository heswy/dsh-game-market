/**
 * M0 S-A1 probe resource service — the "target design" for M1, exercised for
 * real by a browser. It is deliberately NOT wired into the production Host
 * route table: M1 owns the real implementation. What this module proves:
 *
 *   - entry document and subresources are served through an *instance-bound
 *     resource credential in the URL path prefix* (`/res/<instance>/<token>/…`),
 *     so a static package with relative URLs (`scripts/main.js`, `levels/x.json`)
 *     resolves without any `<base>` tag or HTML rewriting;
 *   - the entry document still carries a separate *one-shot launch credential*
 *     (`?launch=…`): first document GET consumes it, a replay gets 410, while
 *     the same entry file stays readable through the repeatable resource
 *     credential (needed for reload / repeated GET / HEAD);
 *   - the response-header set required for an opaque-origin sandbox:
 *     anonymous CORS (`Access-Control-Allow-Origin: *`), `nosniff`, exact MIME,
 *     `no-store`, `Referrer-Policy: no-referrer`, and an explicit
 *     resource-origin CSP (never `'self'` — an opaque origin matches nothing);
 *   - only files listed in the validated package manifest are served; paths are
 *     canonicalised once and anything else (traversal, absolute, encoded
 *     separators, directory listing, unknown file) is rejected;
 *   - TTL / renew / release invalidate reads, while the instance resource
 *     credential allows repeated GET/HEAD during the instance lifetime.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { buildContentSecurityPolicy } from '../../../../../packages/host/src/entry.js';

export const ID_PATTERN = /^[a-f0-9]{32}$/;
export const DEFAULT_TTL_MS = 10 * 60 * 1000;
export const MIME_BY_EXT = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.wav': 'audio/wav',
});

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function mimeFor(rel) {
  const ext = path.extname(rel).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`no MIME mapping for ${rel}`);
  return mime;
}

function safeRelativePath(rel) {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 240) return null;
  if (rel.includes('\0') || rel.includes('\\') || rel.startsWith('/')) return null;
  if (rel.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return rel;
}

/**
 * Validate the package on disk: descriptor syntax, per-file size + sha256.
 * Bytes are cached in memory, so what the service serves is exactly what was
 * verified at startup (a file mutated on disk during the probe cannot leak in).
 */
export function loadPackage(packageRoot) {
  const descriptorPath = path.join(packageRoot, 'dsh-package.json');
  if (!fs.existsSync(descriptorPath)) throw new Error(`fixture descriptor missing: ${descriptorPath}`);
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  if (descriptor.formatVersion !== 2) throw new Error('fixture dsh-package.json must be formatVersion 2');
  if (typeof descriptor.entry !== 'string' || !descriptor.files.some((f) => f.path === descriptor.entry)) {
    throw new Error('fixture entry is not listed in the manifest');
  }
  const resolvedRoot = path.resolve(packageRoot);
  const files = new Map();
  const problems = [];
  for (const entry of descriptor.files) {
    const rel = safeRelativePath(entry.path);
    if (!rel) {
      problems.push(`unsafe-path:${entry.path}`);
      continue;
    }
    const filePath = path.resolve(resolvedRoot, rel);
    if (filePath !== path.join(resolvedRoot, rel)) {
      problems.push(`escapes-root:${rel}`);
      continue;
    }
    if (!fs.existsSync(filePath)) {
      problems.push(`missing:${rel}`);
      continue;
    }
    const bytes = fs.readFileSync(filePath);
    if (bytes.length !== entry.size) problems.push(`size:${rel}`);
    if (sha256(bytes) !== entry.sha256) problems.push(`sha256:${rel}`);
    try {
      files.set(rel, { rel, bytes, size: bytes.length, sha256: entry.sha256, mime: mimeFor(rel) });
    } catch (error) {
      problems.push(`mime:${rel}`);
    }
  }
  if (problems.length > 0) throw new Error(`fixture package failed verification: ${problems.join(', ')}`);
  return { descriptor, files, root: resolvedRoot };
}

/** Candidate M1 CSP: explicit resource origin only; `'self'` cannot work here. */
export function candidateContentSecurityPolicy({ resourceOrigin, frameAncestorOrigin }) {
  return [
    "default-src 'none'",
    `script-src ${resourceOrigin}`,
    `style-src ${resourceOrigin}`,
    `img-src ${resourceOrigin} data:`,
    `media-src ${resourceOrigin}`,
    `font-src ${resourceOrigin}`,
    `connect-src ${resourceOrigin}`,
    "child-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestorOrigin}`,
  ].join('; ');
}

const RESOURCE_PATH = /^\/res\/([a-f0-9]{32})\/([a-f0-9]{32})\/(.+)$/;
const ENCODED_SEPARATOR = /%2f|%5c|%00|%2e/i;

function createIds() {
  return {
    instanceId: randomBytes(16).toString('hex'),
    resourceToken: randomBytes(16).toString('hex'),
    launchNonce: randomBytes(16).toString('hex'),
  };
}

/**
 * @param {{
 *   packageRoot: string,
 *   port?: number,
 *   frameAncestorOrigin: string,
 *   queryExtras?: Record<string,string>,
 *   ttlMs?: number,
 *   now?: () => number,
 * }} options
 */
export function createProbeResourceService({
  packageRoot,
  port = 58232,
  frameAncestorOrigin,
  queryExtras = {},
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now,
}) {
  const pkg = loadPackage(packageRoot);
  const instances = new Map();
  const log = [];
  let server = null;
  let seq = 0;
  let actualPort = null;

  const resourceOrigin = () => `http://127.0.0.1:${actualPort}`;

  function baseUrl() {
    return resourceOrigin();
  }

  function createInstance({ gameId = 'probe-orbit', version = '1.0.0', ttl = ttlMs } = {}) {
    const ids = createIds();
    const instance = {
      gameId,
      version,
      ...ids,
      createdAt: now(),
      expiresAt: now() + ttl,
      released: false,
      launchConsumedAt: null,
      ttl,
    };
    instances.set(ids.instanceId, instance);
    return instance;
  }

  function entryPath(instance) {
    return `/res/${instance.instanceId}/${instance.resourceToken}/${pkg.descriptor.entry}`;
  }

  function entryUrl(instance, { variant = 'candidate', launch = true } = {}) {
    const query = new URLSearchParams({ ...queryExtras, variant });
    if (launch) query.set('launch', instance.launchNonce);
    return `${baseUrl()}${entryPath(instance)}?${query.toString()}`;
  }

  function renewInstance(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance || instance.released || instance.expiresAt <= now()) return null;
    instance.expiresAt = now() + instance.ttl;
    return instance;
  }

  function expireInstance(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) return false;
    instance.expiresAt = now() - 1;
    return true;
  }

  function releaseInstance(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) return false;
    instance.released = true;
    return true;
  }

  function redactPath(pathname, instance) {
    let out = pathname;
    if (instance) {
      out = out.replaceAll(instance.instanceId, '<instance>').replaceAll(instance.resourceToken, '<token>');
    }
    return out;
  }

  function record(entry) {
    seq += 1;
    log.push({ seq, at: new Date().toISOString(), ...entry });
    if (log.length > 500) log.shift();
  }

  function respond(res, status, headers, body, method) {
    const payload = body === null || body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    res.writeHead(status, { ...headers, ...(payload ? { 'content-length': String(payload.length) } : {}) });
    if (method === 'HEAD' || payload === null) res.end();
    else res.end(payload);
  }

  function baseHeaders(instance, variant, { document = false } = {}) {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    };
    // CSP applies to documents (and workers), so it is only sent on the entry
    // document; subresource CSP headers would be ignored by the browser.
    if (!document) {
      headers['x-probe-variant'] = variant;
      return headers;
    }
    if (variant === 'candidate') {
      headers['content-security-policy'] = candidateContentSecurityPolicy({
        resourceOrigin: resourceOrigin(),
        frameAncestorOrigin,
      });
    } else if (variant === 'self') {
      // Control: `'self'` cannot authorize anything inside a sandboxed document
      // (its origin serializes to "null"), so every cross-origin subresource is
      // blocked. This is why M1 must name the resource origin explicitly.
      headers['content-security-policy'] = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "media-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        "child-src 'none'",
        "worker-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        `frame-ancestors ${frameAncestorOrigin}`,
      ].join('; ');
    } else if (variant === 'legacy') {
      // The *production* V1.2 CSP builder, unmodified: this is the control that
      // shows the current platform CSP cannot serve a multi-file package.
      headers['content-security-policy'] = buildContentSecurityPolicy(resourceOrigin(), {
        frameAncestors: [frameAncestorOrigin],
      });
    }
    // variant === 'none' intentionally sends no CSP at all: the control that
    // separates "CORS header behaviour" from "CSP enforcement".
    headers['x-probe-variant'] = variant;
    return headers;
  }

  function describeBinding(instance) {
    if (!instance) return null;
    return {
      instanceId: instance.instanceId,
      gameId: instance.gameId,
      version: instance.version,
      expiresAt: new Date(instance.expiresAt).toISOString(),
      released: instance.released,
      launchConsumed: instance.launchConsumedAt !== null,
    };
  }

  function handleResource(req, res, url, instanceId, token, rawRel, variantFromQuery) {
    const instance = instances.get(instanceId);
    const isEntryRequest = rawRel === pkg.descriptor.entry || rawRel.endsWith(`/${pkg.descriptor.entry}`);
    const headers = instance ? baseHeaders(instance, variantFromQuery, { document: isEntryRequest }) : {
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    };
    const finish = (status, body) => {
      respond(res, status, headers, body, req.method);
      record({
        route: 'resource',
        method: req.method,
        path: redactPath(url.pathname, instance),
        query: redactQuery(url, instance),
        origin: req.headers.origin ?? null,
        referer: redactReferer(req.headers.referer, instance),
        secFetchSite: req.headers['sec-fetch-site'] ?? null,
        status,
        instance: describeBinding(instance),
        responseHeaders: summariseHeaders(headers, req.method),
      });
      return status;
    };

    if (!ID_PATTERN.test(instanceId) || !ID_PATTERN.test(token)) return finish(403, 'forbidden');
    if (!instance) return finish(403, 'forbidden');
    if (instance.released) return finish(403, 'forbidden');
    if (instance.expiresAt <= now()) return finish(403, 'forbidden');
    if (!safeEqual(token, instance.resourceToken)) return finish(403, 'forbidden');

    if (ENCODED_SEPARATOR.test(rawRel)) return finish(403, 'forbidden path');
    let decodedRel;
    try {
      decodedRel = decodeURIComponent(rawRel);
    } catch (_error) {
      return finish(403, 'forbidden path');
    }
    const rel = safeRelativePath(decodedRel);
    if (!rel) return finish(403, 'forbidden path');
    const file = pkg.files.get(rel);
    if (!file) return finish(404, 'not found');

    headers['content-type'] = file.mime;

    const isEntry = rel === pkg.descriptor.entry;
    if (isEntry) {
      const launch = url.searchParams.get('launch');
      if (launch !== null) {
        if (instance.launchConsumedAt !== null) return finish(410, 'launch credential already consumed');
        if (!safeEqual(launch, instance.launchNonce)) return finish(403, 'forbidden');
        instance.launchConsumedAt = now();
        record({
          route: 'entry-credential',
          method: req.method,
          path: redactPath(url.pathname, instance),
          status: 200,
          event: 'launch-credential-consumed',
          instance: describeBinding(instance),
        });
      }
    }

    const bytes = file.bytes;
    const status = 200;
    headers['content-length'] = String(bytes.length);
    respond(res, status, headers, bytes, req.method);
    record({
      route: isEntry ? 'entry' : 'resource',
      method: req.method,
      path: redactPath(url.pathname, instance),
      query: redactQuery(url, instance),
      origin: req.headers.origin ?? null,
      referer: redactReferer(req.headers.referer, instance),
      secFetchSite: req.headers['sec-fetch-site'] ?? null,
      status,
      rel,
      bytes: bytes.length,
      sha256: file.sha256,
      instance: describeBinding(instance),
      responseHeaders: summariseHeaders(headers, req.method),
    });
    return status;
  }

  function redactQuery(url, instance) {
    if (!url.search) return '';
    const parts = [...url.searchParams.entries()].map(([key, value]) => {
      if (key === 'launch') return 'launch=<redacted>';
      if (key === 'host' || key === 'evil') return `${key}=${value}`;
      return `${key}=${value}`;
    });
    return `?${parts.join('&')}`;
  }

  function redactReferer(referer, instance) {
    if (typeof referer !== 'string') return null;
    let out = referer;
    if (instance) {
      out = out.replaceAll(instance.instanceId, '<instance>').replaceAll(instance.resourceToken, '<token>');
    }
    return out.replace(/launch=[^&]+/g, 'launch=<redacted>').slice(0, 200);
  }

  function summariseHeaders(headers, method) {
    const wanted = [
      'access-control-allow-origin',
      'access-control-allow-methods',
      'x-content-type-options',
      'cache-control',
      'referrer-policy',
      'content-type',
      'content-security-policy',
      'x-probe-variant',
    ];
    const out = {};
    for (const name of wanted) if (headers[name] !== undefined) out[name] = headers[name];
    if (headers['content-length'] !== undefined) out['content-length'] = headers['content-length'];
    else if (method !== 'HEAD') out['content-length'] = '(streamed)';
    return out;
  }

  function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
    } catch (_error) {
      req.destroy();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respond(res, 405, { 'access-control-allow-origin': '*', allow: 'GET, HEAD' }, 'method not allowed', req.method);
      record({ route: 'method', method: req.method, path: url.pathname, status: 405 });
      return;
    }
    const variant = url.searchParams.get('variant');
    const variantFromQuery = ['legacy', 'none', 'candidate', 'self'].includes(variant) ? variant : 'candidate';
    const match = RESOURCE_PATH.exec(url.pathname);
    if (!match) {
      respond(res, 404, { 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' }, 'not found', req.method);
      record({ route: 'route', method: req.method, path: url.pathname, query: redactQuery(url, null), status: 404 });
      return;
    }
    handleResource(req, res, url, match[1], match[2], match[3], variantFromQuery);
  }

  function start() {
    return new Promise((resolve, reject) => {
      server = http.createServer(handler);
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        actualPort = server.address().port;
        resolve({ port: actualPort, origin: resourceOrigin() });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server = null;
    });
  }

  function snapshot() {
    return {
      origin: resourceOrigin(),
      descriptor: pkg.descriptor,
      verifiedFiles: [...pkg.files.values()].map((file) => ({ rel: file.rel, size: file.size, sha256: file.sha256, mime: file.mime })),
      instances: [...instances.values()].map((instance) => ({
        instanceId: instance.instanceId,
        resourceToken: instance.resourceToken,
        launchNonce: instance.launchNonce,
        ...describeBinding(instance),
      })),
      requestLog: log.slice(),
    };
  }

  return {
    start,
    stop,
    createInstance,
    entryUrl,
    entryPath,
    renewInstance,
    expireInstance,
    releaseInstance,
    snapshot,
    requestLog: () => log.slice(),
    resetLog: () => {
      log.length = 0;
    },
    packageInfo: () => ({ descriptor: pkg.descriptor, files: snapshot().verifiedFiles }),
    get origin() {
      return resourceOrigin();
    },
    instances,
  };
}

/** Third-party origin stand-in: deliberately no CORS headers (unreadable). */
export function createThirdPartyService({ port = 58233 } = {}) {
  const log = [];
  let server = null;
  let actualPort = null;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
    } catch (_error) {
      req.destroy();
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      log.push({
        method: req.method,
        path: url.pathname,
        origin: req.headers.origin ?? null,
        secFetchSite: req.headers['sec-fetch-site'] ?? null,
        bodyPrefix: body.slice(0, 120),
      });
      if (url.pathname === '/evil.json') {
        // No Access-Control-Allow-Origin on purpose: a cross-origin fetch can
        // send this request but must not be able to read the response.
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ evil: true, secret: 'third-party-read-should-fail' }));
      } else if (url.pathname === '/no-cors.png') {
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(png);
      } else if (url.pathname === '/sink') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('sink-ok');
      } else if (url.pathname === '/external.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>third party</title><body>third party origin</body>');
      } else {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
      }
    });
  }
  return {
    start: () =>
      new Promise((resolve, reject) => {
        server = http.createServer(handler);
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
          actualPort = server.address().port;
          resolve({ port: actualPort, origin: `http://127.0.0.1:${actualPort}` });
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
        server = null;
      }),
    requestLog: () => log.slice(),
    get origin() {
      return `http://127.0.0.1:${actualPort}`;
    },
  };
}
