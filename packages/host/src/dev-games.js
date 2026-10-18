/**
 * Developer game roots (`config.devGameRoots`, V1-CONTRACTS §6.7).
 *
 * Dev games are never copied into `packages/` and never written to
 * `installations.json`; every listing/launch re-reads and re-validates the
 * single HTML file so edits show up without reinstalling.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { LIMITS } from '../../shared/src/constants.js';
import { validatePackageHtml } from '../../shared/src/manifest.js';
import { compatibilityFor } from './semver.js';
import { isInside } from './validation.js';

const MAX_DEV_BYTES = LIMITS.packageBytes;

function decodeUtf8(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) return null;
    return text;
  } catch (_error) {
    return null;
  }
}

export function createDevCatalog({ settings = {}, logger = null, now = () => new Date() }) {
  const devMode = settings.devMode === true;
  const roots = Array.isArray(settings.devGameRoots) ? settings.devGameRoots : [];

  async function readEntry(root, directoryName) {
    const directory = path.join(root, directoryName);
    let realDirectory;
    try {
      realDirectory = await fs.realpath(directory);
    } catch (_error) {
      return null;
    }
    if (!isInside(root, realDirectory)) return null;
    let entries;
    try {
      entries = await fs.readdir(realDirectory, { withFileTypes: true });
    } catch (_error) {
      return null;
    }
    const htmlFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
      .map((entry) => entry.name)
      .sort();
    if (htmlFiles.length !== 1) {
      return {
        id: directoryName,
        version: null,
        manifest: null,
        entryPath: null,
        compatibility: { status: 'broken', reasons: ['entry'], checkedAt: now().toISOString() },
        issue: htmlFiles.length === 0 ? 'entry-missing' : 'entry-ambiguous',
      };
    }
    const entryPath = path.join(realDirectory, htmlFiles[0]);
    let stats;
    try {
      stats = await fs.lstat(entryPath);
    } catch (_error) {
      return null;
    }
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_DEV_BYTES) {
      return {
        id: directoryName,
        version: null,
        manifest: null,
        entryPath: null,
        compatibility: { status: 'broken', reasons: ['entry'], checkedAt: now().toISOString() },
        issue: 'entry-invalid',
      };
    }
    let bytes;
    try {
      bytes = await fs.readFile(entryPath);
    } catch (_error) {
      return null;
    }
    const text = decodeUtf8(bytes);
    if (text === null) {
      return {
        id: directoryName,
        version: null,
        manifest: null,
        entryPath: null,
        compatibility: { status: 'broken', reasons: ['encoding'], checkedAt: now().toISOString() },
        issue: 'html-invalid',
      };
    }
    const validation = validatePackageHtml(text, { packageBytes: MAX_DEV_BYTES });
    if (!validation.ok || !validation.manifest) {
      const first = validation.errors[0] || {};
      return {
        id: directoryName,
        version: null,
        manifest: null,
        entryPath: null,
        compatibility: { status: 'broken', reasons: [first.code || 'manifest'], checkedAt: now().toISOString() },
        issue: 'manifest-invalid',
      };
    }
    const manifest = validation.manifest;
    if (manifest.id !== directoryName) {
      return {
        id: directoryName,
        version: manifest.version,
        manifest,
        entryPath: null,
        compatibility: { status: 'broken', reasons: ['id-mismatch'], checkedAt: now().toISOString() },
        issue: 'id-mismatch',
      };
    }
    return {
      id: manifest.id,
      version: manifest.version,
      manifest,
      entryPath,
      sizeBytes: stats.size,
      sha256: null,
      compatibility: compatibilityFor(manifest, now().toISOString()),
      issue: null,
    };
  }

  async function list() {
    if (!devMode || roots.length === 0) return [];
    const items = [];
    const seen = new Set();
    for (const configuredRoot of roots) {
      let root;
      try {
        root = await fs.realpath(configuredRoot);
        const stats = await fs.stat(root);
        if (!stats.isDirectory()) continue;
      } catch (_error) {
        logger?.warn?.('[game-market/host] dev-root-unavailable', `root=${path.basename(configuredRoot)}`);
        continue;
      }
      let entries;
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch (_error) {
        continue;
      }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        if (seen.has(entry.name)) continue;
        const item = await readEntry(root, entry.name);
        if (item && item.issue === null && !seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
    }
    return items;
  }

  async function get(gameId) {
    if (!devMode || roots.length === 0 || typeof gameId !== 'string') return null;
    for (const configuredRoot of roots) {
      let root;
      try {
        root = await fs.realpath(configuredRoot);
        const stats = await fs.stat(root);
        if (!stats.isDirectory()) continue;
      } catch (_error) {
        continue;
      }
      let directoryExists = false;
      try {
        const stats = await fs.stat(path.join(root, gameId));
        directoryExists = stats.isDirectory();
      } catch (_error) {
        directoryExists = false;
      }
      if (!directoryExists) continue;
      const item = await readEntry(root, gameId);
      if (item && item.issue === null) return item;
    }
    return null;
  }

  return { enabled: devMode && roots.length > 0, roots, list, get };
}
