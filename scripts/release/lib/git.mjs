/**
 * Non-destructive git helpers for the maintainer release tooling.
 *
 * Design rules (docs/verification/v1.5/m3-decisions.md §5):
 *   - read-only by default; the only mutating calls are `add`/`commit` used by
 *     `release:prepare --write` on an explicitly authorised run, plus the
 *     index reset used to roll a failed `--write` back;
 *   - never fetch, pull, push, tag, or contact a remote: only local plumbing
 *     and porcelain commands (the test suite asserts this from a git shim);
 *   - failures fail closed with the command and its stderr, but sanitised
 *     (no credentials are ever printed or added by this module).
 *
 * Implemented with `node:child_process` only (zero dependencies).
 */
import { spawnSync } from 'node:child_process';

import { REPO_URL } from './constants.mjs';
import { ReleaseError, fail } from './errors.mjs';

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
  GIT_CONFIG_NOSYSTEM: '1',
  LC_ALL: 'C',
};

/** Normalise the many GitHub remote spellings to one canonical HTTPS URL. */
export function normalizeRepoUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/u.exec(text);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;
  const https = /^(?:https?:\/\/)?(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/u.exec(text);
  if (https) return `https://github.com/${https[1]}/${https[2]}`;
  return null;
}

export function expectedRepoUrl() {
  return REPO_URL;
}

/**
 * @param {{cwd: string, runner?: (args: string[], options: object) => {status: number|null, stdout: string|Buffer, stderr: string|Buffer}}} options
 */
export function createGit({ cwd, runner } = {}) {
  function execute(args, options = {}) {
    const result = runner
      ? runner(args, options)
      : spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...GIT_ENV },
        maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
        timeout: options.timeout || 120_000,
        ...options.spawn,
      });
    return {
      status: result.status,
      stdout: options.binary ? Buffer.from(result.stdout || new Uint8Array(0)) : String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      signal: result.signal || null,
      error: result.error || null,
    };
  }

  function call(args, { allowFailure = false, binary = false, maxBuffer = undefined } = {}) {
    const result = execute(args, { allowFailure, binary, maxBuffer });
    if (result.error) {
      fail('E_RELEASE_GIT', `git ${args[0]} could not be executed: ${result.error.message}`.slice(0, 600), {
        guidance: 'ensure `git` is installed and on PATH',
      });
    }
    if (!allowFailure && result.status !== 0) {
      throw new ReleaseError(
        'E_RELEASE_GIT',
        `git ${args[0]} failed with exit ${String(result.status)}: ${tail(result.stderr || result.stdout, 4)}`,
        { details: { args: args.map((value) => (typeof value === 'string' ? value : '<buffer>')) } },
      );
    }
    return result;
  }

  const api = {
    cwd,
    run(args, options) {
      return call(args, options);
    },
    isRepo() {
      return call(['rev-parse', '--is-inside-work-tree'], { allowFailure: true }).status === 0;
    },
    head() {
      return call(['rev-parse', 'HEAD']).stdout.trim();
    },
    branch() {
      const result = call(['symbolic-ref', '--short', '-q', 'HEAD'], { allowFailure: true });
      return result.status === 0 ? result.stdout.trim() : null;
    },
    remoteUrl(remote = 'origin') {
      const result = call(['remote', 'get-url', remote], { allowFailure: true });
      return result.status === 0 ? result.stdout.trim() : null;
    },
    statusPorcelain() {
      return call(['status', '--porcelain', '--untracked-files=all']).stdout;
    },
    asyncStatusPaths() {
      return api
        .statusPorcelain()
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          // porcelain v1 is exactly `XY <path>`; keep the two-column prefix so
          // ` M client.js` is parsed as an existing file, not as an untracked one.
          const raw = line.slice(3);
          const renamed = raw.split(' -> ');
          return renamed[renamed.length - 1];
        });
    },
    commitMessage(ref) {
      return call(['show', '-s', '--format=%B', '--no-show-signature', ref]).stdout.trim();
    },
    commitSubject(ref) {
      return call(['show', '-s', '--format=%s', '--no-show-signature', ref]).stdout.trim();
    },
    commitEpoch(ref) {
      const value = Number.parseInt(call(['show', '-s', '--format=%ct', ref]).stdout.trim(), 10);
      if (!Number.isSafeInteger(value) || value < 0) {
        fail('E_RELEASE_BAD_COMMIT', `commit ${ref} has no usable committer timestamp`);
      }
      return value;
    },
    parents(ref) {
      const line = call(['show', '-s', '--format=%P', '--no-show-signature', ref]).stdout.trim();
      return line === '' ? [] : line.split(/\s+/u);
    },
    revParseCommit(ref) {
      const result = call(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFailure: true });
      return result.status === 0 ? result.stdout.trim() : null;
    },
    commitExists(ref) {
      return call(['cat-file', '-e', `${ref}^{commit}`], { allowFailure: true }).status === 0;
    },
    isAncestor(ancestor, descendant) {
      const result = call(['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true });
      if (result.status === 0) return true;
      if (result.status === 1) return false;
      fail('E_RELEASE_GIT', `git merge-base --is-ancestor failed for ${ancestor}..${descendant}`);
    },
    refsContaining(ref) {
      const result = call(['for-each-ref', `--contains=${ref}`, '--format=%(refname)', 'refs/heads', 'refs/remotes'], {
        allowFailure: true,
      });
      return result.status === 0
        ? result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
        : [];
    },
    objectExists(ref, file) {
      return call(['cat-file', '-e', `${ref}:${file}`], { allowFailure: true }).status === 0;
    },
    readFile(ref, file) {
      const result = call(['cat-file', 'blob', `${ref}:${file}`], { allowFailure: true, binary: true });
      return result.status === 0 ? result.stdout : null;
    },
    readTextFile(ref, file) {
      const bytes = api.readFile(ref, file);
      return bytes === null ? null : bytes.toString('utf8');
    },
    /** Recursive blob listing under the given paths: [{ path, mode, type, size, oid }]. */
    listTree(ref, paths) {
      const result = call(['ls-tree', '-r', '-z', '--long', ref, '--', ...paths]);
      return parseLsTreeZ(result.stdout);
    },
    /**
     * Read blobs by object id in one `cat-file --batch` process.
     * @param {string[]} oids
     * @returns {Map<string, Buffer>}
     */
    readBlobs(oids) {
      const unique = [...new Set(oids)];
      const map = new Map();
      if (unique.length === 0) return map;
      // The generic `call` helper does not feed stdin, so this plumbing call is explicit.
      const spawned = spawnSync('git', ['cat-file', '--batch'], {
        cwd,
        encoding: null,
        input: unique.map((oid) => `${oid}\n`).join(''),
        env: { ...process.env, ...GIT_ENV },
        maxBuffer: 128 * 1024 * 1024,
        timeout: 120_000,
      });
      if (spawned.error || spawned.status !== 0) {
        fail('E_RELEASE_GIT', `git cat-file --batch failed: ${String(spawned.stderr || '')}`.slice(0, 600));
      }
      const buffer = Buffer.from(spawned.stdout || new Uint8Array(0));
      let offset = 0;
      while (offset < buffer.length) {
        const newline = buffer.indexOf(0x0a, offset);
        if (newline < 0) break;
        const header = buffer.subarray(offset, newline).toString('utf8').trim();
        offset = newline + 1;
        const [oid, type, sizeText] = header.split(' ');
        const size = Number.parseInt(sizeText, 10);
        if (!Number.isSafeInteger(size)) break;
        map.set(oid, buffer.subarray(offset, offset + size));
        offset += size + 1; // trailing newline
      }
      return map;
    },
    /** Files that exist on disk and would be committed by `git add`: tracked OR untracked non-ignored. */
    listCommittableFiles(paths) {
      const result = call(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...paths]);
      return parseNul(result.stdout)
        .map((entry) => entry.replace(/\\/gu, '/'))
        .sort(compareText);
    },
    add(paths) {
      call(['add', '-A', '--', ...paths]);
    },
    commit(message) {
      const result = call(['commit', '--no-verify', '-m', message]);
      return result.stdout.trim();
    },
    resetPaths(paths) {
      call(['reset', '-q', 'HEAD', '--', ...paths], { allowFailure: true });
    },
    treeHash(ref) {
      return call(['rev-parse', `${ref}^{tree}`]).stdout.trim();
    },
    /** True when the current branch is behind a same-named remote branch: not used for network; local refs only. */
    localRefs() {
      return call(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'], { allowFailure: true })
        .stdout.split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    },
  };

  return api;
}

function parseNul(text) {
  return text.split('\0').filter((value) => value.length > 0);
}

export function parseLsTreeZ(text) {
  const entries = [];
  for (const record of parseNul(text)) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const meta = record.slice(0, tab);
    const path = record.slice(tab + 1).replace(/\\/gu, '/');
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\s+(\d+)$/u.exec(meta);
    if (!match) continue;
    entries.push({ mode: match[1], type: match[2], oid: match[3], size: Number.parseInt(match[4], 10), path });
  }
  entries.sort((left, right) => compareText(left.path, right.path));
  return entries;
}

export function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function tail(text, lines) {
  const list = String(text).trim().split('\n');
  return list.slice(-lines).join(' | ').slice(0, 600);
}
