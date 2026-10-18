/**
 * Small filesystem/hash helpers. Node built-ins only; deterministic output
 * (UTF-8, LF newlines, no BOM, no timestamps) is the default.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { internalError } from './cli-error.mjs';

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function fileExists(abs) {
  try {
    return fs.statSync(abs).isFile();
  } catch (_error) {
    return false;
  }
}

export function dirExists(abs) {
  try {
    return fs.statSync(abs).isDirectory();
  } catch (_error) {
    return false;
  }
}

export function readBuffer(abs, code = 'E_CLI_IO') {
  try {
    return fs.readFileSync(abs);
  } catch (error) {
    const wrapped = internalError(`Cannot read ${abs}: ${error.message}`, error);
    wrapped.code = code;
    throw wrapped;
  }
}

export function readText(abs, code = 'E_CLI_IO') {
  const buffer = readBuffer(abs, code);
  return stripBom(buffer.toString('utf8'));
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Decode UTF-8 strictly. Returns `{ok:true,text}` or `{ok:false,message}`.
 * Invalid byte sequences must be rejected (PRD §8.2.2).
 */
export function decodeUtf8(buffer) {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return { ok: true, text: decoder.decode(buffer) };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : 'invalid UTF-8' };
  }
}

export function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

/** Deterministic text write: UTF-8, LF, one trailing newline. */
export function writeText(abs, text) {
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, normalizeNewlines(text), 'utf8');
  } catch (error) {
    throw internalError(`Cannot write ${abs}: ${error.message}`, error);
  }
}

export function writeBuffer(abs, buffer) {
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
  } catch (error) {
    throw internalError(`Cannot write ${abs}: ${error.message}`, error);
  }
}

export function listFilesRecursive(dir, options = {}) {
  const skip = new Set(options.skip || ['node_modules', '.git', 'dist']);
  const out = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  if (dirExists(dir)) walk(dir);
  return out.sort();
}

export function toPosix(value) {
  return value.split(path.sep).join('/');
}
