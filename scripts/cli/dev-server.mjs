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

import { EXIT_CODES, CliError, ValidationFailure } from './lib/cli-error.mjs';
import { renderHarness } from './lib/dev-harness.mjs';
import { fileExists } from './lib/fs-utils.mjs';
import { formatReport } from './lib/issues.mjs';
import { buildProject, defaultOutFile, loadProjectManifest } from './lib/project.mjs';

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

  let initial;
  try {
    initial = build
      ? await buildProject(projectDir, { write: false, sdk: options.sdk, quiet: true })
      : { manifest: loadProjectManifest(projectDir).manifest };
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

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const requestUrl = new URL(req.url || '/', `http://${host}`);
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, method);
      return;
    }
    try {
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
        });
        send(res, 200, 'text/html; charset=utf-8', html, method);
        return;
      }
      if (requestUrl.pathname === '/game') {
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
          { ok: true, simulator: true, build, game: { id: manifest.id, name: manifest.name, version: manifest.version } },
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
