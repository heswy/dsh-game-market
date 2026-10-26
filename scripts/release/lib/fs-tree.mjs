/**
 * Deterministic filesystem inventory + digest for release artifacts.
 *
 * Release identity (docs/verification/v1.5/m3-decisions.md §5) pins the build
 * outputs under fixed roots:
 *
 *   client.js, games/**, registry/**
 *
 * The digest is defined here (and documented in the release.json it produces):
 *
 *   sha256-tree-v1 = sha256( for each file sorted by path:
 *                            `<path>\0<sha256(content)>\0<size>\n` )
 *
 * Paths are repo-relative, POSIX-separated and sorted byte-wise; the release
 * identity file itself is not part of the roots (so it can declare the digest
 * without a self-reference). Symlinks are rejected: a published plugin bundle
 * must be plain files.
 *
 * The same inventory is computed from the worktree (before commit) and from the
 * git tree of a release commit (during promote), so the digest commits the
 * installer-visible bytes, not the working directory.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ARTIFACT_DIGEST_ALGORITHM, ARTIFACT_ROOTS } from './constants.mjs';
import { fail } from './errors.mjs';

/** Filenames that are never release artifacts, even if they appear in a tree. */
const NOISE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function isNoiseName(name) {
  return NOISE_NAMES.has(name) || name.startsWith('.tmp-');
}

/**
 * Walk the artifact roots of a worktree and return the canonical inventory.
 *
 * @param {string} root absolute repository/worktree root
 * @returns {{files: Array<{path: string, sha256: string, size: number}>, bytes: number, digest: string, roots: string[]}}
 */
export function collectArtifacts(root) {
  const files = [];
  for (const relative of ARTIFACT_ROOTS) {
    const absolute = path.join(root, relative);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      fail('E_RELEASE_ARTIFACTS', `missing release artifact root: ${relative}`, {
        guidance: 'run `npm run build` (or `release:prepare --write`, which builds) before previewing a release',
        details: { code: error && error.code },
      });
    }
    if (stat.isSymbolicLink()) {
      fail('E_RELEASE_ARTIFACTS', `release artifact root is a symlink: ${relative}`, {
        guidance: 'release artifacts must be regular files committed to the repository',
      });
    }
    if (stat.isFile()) {
      addFile(root, absolute, files);
    } else if (stat.isDirectory()) {
      walkDirectory(root, absolute, files);
    } else {
      fail('E_RELEASE_ARTIFACTS', `release artifact root is not a file or directory: ${relative}`);
    }
  }
  files.sort((left, right) => compareText(left.path, right.path));
  const bytes = files.reduce((total, file) => total + file.size, 0);
  return { files, bytes, digest: digestInventory(files), roots: [...ARTIFACT_ROOTS] };
}

/** Digest over a canonical inventory (same bytes multiplexing as `collectArtifacts`). */
export function digestInventory(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${file.path}\0${file.sha256}\0${String(file.size)}\n`, 'utf8');
  }
  return hash.digest('hex');
}

/** Convert a git `ls-tree` listing + blob reader into the canonical inventory. */
export function inventoryFromGitTree(entries, readBlob) {
  const files = [];
  for (const entry of entries) {
    if (entry.type !== 'blob') continue;
    if (isNoiseName(path.posix.basename(entry.path))) continue;
    const bytes = readBlob(entry.oid);
    if (!bytes) fail('E_RELEASE_ARTIFACTS', `could not read blob ${entry.oid} for ${entry.path}`);
    files.push({ path: entry.path, sha256: sha256Hex(bytes), size: bytes.length });
  }
  files.sort((left, right) => compareText(left.path, right.path));
  const bytes = files.reduce((total, file) => total + file.size, 0);
  return { files, bytes, digest: digestInventory(files), roots: [...ARTIFACT_ROOTS] };
}

/** Structured differences between two inventories (used for actionable failures). */
export function compareInventories(expected, actual, limit = 10) {
  const expectedByPath = new Map(expected.files.map((file) => [file.path, file]));
  const actualByPath = new Map(actual.files.map((file) => [file.path, file]));
  const missing = [...expectedByPath.keys()].filter((key) => !actualByPath.has(key));
  const extra = [...actualByPath.keys()].filter((key) => !expectedByPath.has(key));
  const changed = [];
  for (const [key, file] of expectedByPath) {
    const other = actualByPath.get(key);
    if (other && (other.sha256 !== file.sha256 || other.size !== file.size)) {
      changed.push({ path: key, expected: file.sha256, actual: other.sha256 });
    }
  }
  const all = { missing: missing.slice(0, limit), extra: extra.slice(0, limit), changed: changed.slice(0, limit) };
  return { equal: missing.length === 0 && extra.length === 0 && changed.length === 0, ...all };
}

/** Size of a UTF-8 buffer in bytes (small helper shared by the CLIs). */
export function utf8Bytes(text) {
  return Buffer.byteLength(text, 'utf8');
}

function walkDirectory(root, directory, out) {
  const names = fs.readdirSync(directory, { withFileTypes: true });
  names.sort((left, right) => compareText(left.name, right.name));
  for (const entry of names) {
    if (isNoiseName(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      fail('E_RELEASE_ARTIFACTS', `release artifacts must not contain symlinks: ${relativePath(root, absolute)}`, {
        guidance: 'replace the symlink with the real built file',
      });
    } else if (entry.isDirectory()) {
      walkDirectory(root, absolute, out);
    } else if (entry.isFile()) {
      addFile(root, absolute, out);
    }
  }
}

function addFile(root, absolute, out) {
  const bytes = fs.readFileSync(absolute);
  out.push({ path: relativePath(root, absolute), sha256: sha256Hex(bytes), size: bytes.length });
}

function relativePath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

export function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export const ARTIFACT_ROOTS_LIST = ARTIFACT_ROOTS;
export const DIGEST_ALGORITHM = ARTIFACT_DIGEST_ALGORITHM;
