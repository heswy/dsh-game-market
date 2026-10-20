/**
 * Zero-dependency Local Runtime Simulator server (PRD §4.5 / DEV-02).
 *
 * Serves exactly three resources:
 *   `/`      the simulator harness (fake Runtime + controls)
 *   `/game`  the built single-file game (rebuilds from source on each load)
 *   `/health` a tiny JSON status document
 *
 * It never exposes the filesystem, proxies remote URLs or talks to an Agent.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { EXIT_CODES, CliError, ValidationFailure, usageError } from './lib/cli-error.mjs';
import { renderHarness, renderWrapper } from './lib/dev-harness.mjs';
import { fileExists } from './lib/fs-utils.mjs';
import { formatReport } from './lib/issues.mjs';
import { ASSET_ZIP_V2, isZipFormat, resolveFormat } from './lib/formats.mjs';
import { buildPackageV2 } from './lib/package-v2.mjs';
import { buildProject, defaultOutFile, loadConfig, loadProjectManifest } from './lib/project.mjs';

const MIME_BY_EXTENSION = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

function mimeFor(filePath) {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function randomHex(length) {
  const bytes = new Uint8Array(length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Entry-document CSP used by the simulator resource origin. */
function nowIso() {
  return new Date().toISOString();
}

/** Read and JSON-parse a small request body (dev-only endpoints). */
async function readJsonBody(request, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw usageError(`Request body is larger than ${maxBytes} bytes`, 'Saves are limited to a single small JSON document.');
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim().length === 0) throw usageError('Request body must be JSON');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw usageError(`Request body is not valid JSON: ${error.message}`);
  }
}

function seedSaveValue(document) {
  if (document && typeof document === 'object' && !Array.isArray(document) && 'save' in document) {
    return document.save;
  }
  return document;
}

function entryCsp() {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "media-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const DEFAULT_PORT = 4321;
const DEFAULT_HOST = '127.0.0.1';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function errorPage(title, report) {
  const body = report ? formatReport(report) : title;
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Simulator build error</title>
  <style>
    body { background:#0a0b0d; color:#e8edf2; font:14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; padding:32px; }
    h1 { font-size:16px; color:#fb7185; }
    pre { white-space:pre-wrap; background:#121417; border:1px solid rgba(255,255,255,.1); border-radius:8px; padding:16px; }
  </style></head>
  <body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(body)}</pre>
  <p>Fix the error and reload this iframe.</p></body>
</html>`;
}

function send(res, status, contentType, body, method) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': buffer.length,
    'cache-control': 'no-store',
  });
  if (method === 'HEAD') res.end();
  else res.end(buffer);
}

function sendJson(res, status, value, method) {
  send(res, status, 'application/json; charset=utf-8', `${JSON.stringify(value, null, 2)}\n`, method);
}

/**
 * Start the simulator.
 *
 * @param {{projectDir: string, host?: string, port?: number, build?: boolean, sdk?: boolean, logger?: object}} options
 * @returns {Promise<{url: string, port: number, host: string, projectDir: string, manifest: object, close: () => Promise<void>}>}
 */
export async function startDevServer(options = {}) {
  const projectDir = options.projectDir || process.cwd();
  const build = options.build !== false;
  const host = options.host || DEFAULT_HOST;
  const port = Number.isInteger(options.port) && options.port >= 0 ? options.port : DEFAULT_PORT;

  const config = loadConfig(projectDir);
  const format = resolveFormat({ format: options.format }, config);
  const zipMode = isZipFormat(format);
  const resourceOrigin = { instanceId: randomHex(32), token: randomHex(32) };
  const resourcePrefix = `/res/${resourceOrigin.instanceId}/${resourceOrigin.token}`;
  const gameResourceUrl = `${resourcePrefix}/index.html`;

  function loggerError(message) {
    if (options.logger && typeof options.logger.error === 'function') options.logger.error(message);
  }

  async function buildZipPackage() {
    return buildPackageV2(projectDir, {
      format: ASSET_ZIP_V2,
      write: false,
      quiet: true,
      usePrebuilt: build === false,
    });
  }

  let initial;
  let zipPackage = null;
  try {
    if (zipMode) {
      zipPackage = await buildZipPackage();
      initial = { manifest: zipPackage.manifest };
    } else {
      initial = build
        ? await buildProject(projectDir, { write: false, sdk: options.sdk, quiet: true })
        : { manifest: loadProjectManifest(projectDir).manifest };
    }
  } catch (error) {
    if (error instanceof ValidationFailure) throw error;
    throw error;
  }

  function currentManifest() {
    try {
      return loadProjectManifest(projectDir).manifest;
    } catch (_error) {
      return initial.manifest;
    }
  }

  async function packageHtml() {
    if (!build) {
      const out = defaultOutFile(projectDir);
      if (!fileExists(out)) {
        throw new CliError(
          `No built package at ${out}`,
          EXIT_CODES.USAGE,
          { hint: 'Run `dsh-game build` first or omit --no-build.' }
        );
      }
      return fs.readFileSync(out);
    }
    const result = await buildProject(projectDir, { write: false, sdk: options.sdk, quiet: true });
    return Buffer.from(result.html, 'utf8');
  }

  // Dev-only save bridge (P1: upgrade-path testing). Never part of the package
  // format or the production Host: only this local simulator process sees it.
  const saveOutPath = options.saveOut ? path.resolve(options.saveOut) : null;
  let latestSave = null;
  if (options.seedSave) {
    const seedPath = path.resolve(options.seedSave);
    if (!fileExists(seedPath)) {
      throw usageError(`--seed-save file does not exist: ${seedPath}`, 'Export a save from a previous `dsh-game dev` session with --save-out first.');
    }
    try {
      latestSave = seedSaveValue(JSON.parse(fs.readFileSync(seedPath, 'utf8')));
    } catch (error) {
      throw usageError(`--seed-save is not valid JSON: ${error.message}`, 'Use the file produced by --save-out (or /dev/save/export).');
    }
  }

  function persistSave(save) {
    latestSave = save;
    if (!saveOutPath) return;
    try {
      const manifest = currentManifest();
      fs.mkdirSync(path.dirname(saveOutPath), { recursive: true });
      fs.writeFileSync(
        saveOutPath,
        `${JSON.stringify({ game: { id: manifest.id, version: manifest.version }, savedAt: nowIso(), save }, null, 2)}\n`
      );
    } catch (error) {
      loggerError(`cannot write --save-out ${saveOutPath}: ${error.message}`);
    }
  }

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const requestUrl = new URL(req.url || '/', `http://${host}`);
    if (!['GET', 'HEAD', 'POST'].includes(method)) {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, method);
      return;
    }
    if (method === 'POST' && !requestUrl.pathname.startsWith('/dev/save')) {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, method);
      return;
    }
    try {
      if (requestUrl.pathname === '/dev/save/export') {
        if (latestSave === null) {
          sendJson(res, 404, { ok: false, error: 'no_save', hint: 'The game has not saved yet; trigger before-save or import a save.' }, method);
          return;
        }
        const manifest = currentManifest();
        const body = JSON.stringify({ ok: true, game: { id: manifest.id, version: manifest.version }, savedAt: nowIso(), save: latestSave }, null, 2);
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'cache-control': 'no-store',
          'content-disposition': `attachment; filename="${manifest.id}-${manifest.version}.save.json"`,
        });
        if (method === 'HEAD') res.end();
        else res.end(body);
        return;
      }
      if (requestUrl.pathname === '/dev/save/import') {
        const body = await readJsonBody(req);
        const save = seedSaveValue(body);
        if (save === null || typeof save !== 'object') {
          sendJson(res, 400, { ok: false, error: 'invalid_save', hint: 'Expected { "save": <JSON object> }.' }, method);
          return;
        }
        persistSave(save);
        sendJson(res, 200, { ok: true, imported: true, bytes: Buffer.byteLength(JSON.stringify(save)) }, method);
        return;
      }
      if (requestUrl.pathname === '/dev/save') {
        const body = await readJsonBody(req);
        const save = seedSaveValue(body);
        if (save === null || typeof save !== 'object') {
          sendJson(res, 400, { ok: false, error: 'invalid_save' }, method);
          return;
        }
        persistSave(save);
        sendJson(res, 200, { ok: true, bytes: Buffer.byteLength(JSON.stringify(save)) }, method);
        return;
      }
      if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
        const manifest = currentManifest();
        const html = renderHarness({
          game: {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
            description: manifest.description,
          },
          theme: 'dark',
          locale: 'zh-CN',
          format,
          saveApi: true,
          initialSave: latestSave,
          ...(zipMode
            ? {
                wrapperUrl: `/wrapper?src=${encodeURIComponent(gameResourceUrl)}`,
                instanceId: resourceOrigin.instanceId,
                nonce: resourceOrigin.token,
              }
            : {}),
        });
        send(res, 200, 'text/html; charset=utf-8', html, method);
        return;
      }
      if (zipMode && requestUrl.pathname === '/wrapper') {
        const html = renderWrapper({
          src: requestUrl.searchParams.get('src') || gameResourceUrl,
          instanceId: resourceOrigin.instanceId,
          nonce: resourceOrigin.token,
        });
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': Buffer.byteLength(html),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        if (method === 'HEAD') res.end();
        else res.end(html);
        return;
      }
      if (zipMode && requestUrl.pathname.startsWith(`${resourcePrefix}/`)) {
        let relative;
        try {
          relative = decodeURIComponent(requestUrl.pathname.slice(resourcePrefix.length + 1));
        } catch (_error) {
          sendJson(res, 400, { ok: false, error: 'bad_path' }, method);
          return;
        }
        let built;
        try {
          built = await buildZipPackage();
        } catch (error) {
          if (error instanceof ValidationFailure) {
            options.logger?.error?.(formatReport(error.report));
            send(res, 500, 'text/html; charset=utf-8', errorPage('Game build failed', error.report), method);
            return;
          }
          throw error;
        }
        const data = built.entries.get(relative);
        if (!data) {
          sendJson(res, 404, { ok: false, error: 'not_found' }, method);
          return;
        }
        const headers = {
          'content-type': mimeFor(relative),
          'content-length': data.length,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        };
        if (relative === 'index.html') headers['content-security-policy'] = entryCsp();
        res.writeHead(200, headers);
        if (method === 'HEAD') res.end();
        else res.end(data);
        return;
      }
      if (!zipMode && requestUrl.pathname === '/game') {
        try {
          const html = await packageHtml();
          send(res, 200, 'text/html; charset=utf-8', html, method);
        } catch (error) {
          if (error instanceof ValidationFailure) {
            options.logger?.error?.(formatReport(error.report));
            send(res, 500, 'text/html; charset=utf-8', errorPage('Game build failed', error.report), method);
            return;
          }
          throw error;
        }
        return;
      }
      if (requestUrl.pathname === '/health') {
        const manifest = currentManifest();
        sendJson(
          res,
          200,
          {
            ok: true,
            simulator: true,
            build,
            format,
            saveApi: true,
            hasSeedSave: latestSave !== null,
            saveOut: saveOutPath,
            ...(zipMode ? { fileCount: zipPackage ? zipPackage.fileCount : 0 } : {}),
            game: { id: manifest.id, name: manifest.name, version: manifest.version },
          },
          method
        );
        return;
      }
      if (requestUrl.pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not_found' }, method);
    } catch (error) {
      if (error instanceof CliError) {
        // Bad dev-only request bodies are client errors (400); other CLI errors
        // (e.g. --no-build with no dist/) keep the existing 500 simulator page.
        const clientError = error.exitCode === EXIT_CODES.USAGE && requestUrl.pathname.startsWith('/dev/save');
        if (!clientError) options.logger?.error?.(error);
        sendJson(
          res,
          clientError ? 400 : 500,
          { ok: false, error: error.code || (clientError ? 'bad_request' : 'simulator_error'), message: error.message, hint: error.hint || null },
          method
        );
        return;
      }
      options.logger?.error?.(error);
      sendJson(res, 500, { ok: false, error: 'simulator_error', message: error.message }, method);
    }
  });

  await new Promise((resolve, reject) => {
    function onError(error) {
      server.removeListener('listening', onListening);
      if (error && error.code === 'EADDRINUSE') {
        reject(
          new CliError(`Port ${port} is already in use`, EXIT_CODES.USAGE, {
            hint: 'Pass --port <number> to use another port.',
          })
        );
        return;
      }
      reject(error);
    }
    function onListening() {
      server.removeListener('error', onError);
      resolve();
    }
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  const url = `http://${host}:${actualPort}/`;

  return {
    url,
    host,
    port: actualPort,
    projectDir,
    format,
    saveApi: true,
    saveOut: saveOutPath,
    hasSeedSave: latestSave !== null,
    ...(zipMode ? { resourcePrefix, wrapperUrl: `/wrapper?src=${encodeURIComponent(gameResourceUrl)}`, entryUrl: gameResourceUrl } : {}),
    manifest: initial.manifest,
    server,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export { DEFAULT_HOST, DEFAULT_PORT };
