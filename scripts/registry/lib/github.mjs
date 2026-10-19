/** Thin, injection-friendly GitHub CLI adapter for the publishing tool. */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fetchBytes } from '../../../packages/host/src/download.js';
import { sha256 } from './assets.mjs';

function ghError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createGithub({ repo, runner } = {}) {
  const run = runner || function runGh(args) {
    return spawnSync('gh', args, {
      encoding: 'utf8',
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
    });
  };
  function call(args, { allowFailure = false } = {}) {
    const result = run(args);
    const output = { status: result.status, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
    if (!allowFailure && output.status !== 0) {
      throw ghError('E_PUBLISH_GH', `gh ${args[0]} failed: ${output.stderr || output.stdout}`.slice(0, 500));
    }
    return output;
  }
  return {
    repo,
    checkAuth() {
      const version = call(['--version'], { allowFailure: true });
      if (version.status !== 0) throw ghError('E_PUBLISH_GH_MISSING', 'GitHub CLI (gh) is not installed');
      const auth = call(['auth', 'status'], { allowFailure: true });
      if (auth.status !== 0) throw ghError('E_PUBLISH_GH_AUTH', 'GitHub CLI is not authenticated; run `gh auth login`');
      return true;
    },
    repoInfo() {
      return JSON.parse(call(['repo', 'view', repo, '--json', 'nameWithOwner,visibility,defaultBranchRef,isPrivate']).stdout);
    },
    releaseView(tag) {
      const result = call(['release', 'view', tag, '--repo', repo, '--json', 'tagName,isDraft,isPrerelease,url,assets'], { allowFailure: true });
      if (result.status !== 0) {
        if (/not found|release not found/i.test(result.stderr)) return null;
        throw ghError('E_PUBLISH_GH', `gh release view failed: ${result.stderr || result.stdout}`);
      }
      return JSON.parse(result.stdout);
    },
    /**
     * Authenticated view of one draft asset: GitHub's release API exposes the
     * asset id/name/size/digest, while the download URL requires auth. This is
     * used before publishing a resumed draft so a same-name but different-byte
     * asset can never be silently accepted.
     */
    inspectDraftAsset(tag, name) {
      const release = call(['api', `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`], { allowFailure: true });
      if (release.status !== 0) return null;
      let parsed;
      try { parsed = JSON.parse(release.stdout); } catch (_error) { return null; }
      const asset = (parsed.assets || []).find((item) => item && item.name === name);
      if (!asset) return null;
      return { id: asset.id, name: asset.name, size: asset.size, digest: asset.digest || null, state: asset.state, url: asset.url };
    },
    downloadAsset(asset) {
      if (!asset || asset.id === undefined) throw ghError('E_PUBLISH_GH', 'draft asset has no id');
      const result = spawnSync('gh', ['api', `repos/${repo}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'], {
        encoding: null,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
      });
      if (result.status !== 0) throw ghError('E_PUBLISH_GH', `gh api asset download failed for ${asset.name}`);
      return Buffer.from(result.stdout || new Uint8Array(0));
    },
    async createDraftRelease({ tag, title, notes }) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-release-notes-'));
      const file = path.join(directory, 'notes.md');
      await fs.writeFile(file, notes || title || tag);
      try {
        call(['release', 'create', tag, '--repo', repo, '--draft', '--title', title || tag, '--notes-file', file]);
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
      return tag;
    },
    uploadAssets(tag, files) {
      if (files.length === 0) return;
      call(['release', 'upload', tag, '--repo', repo, ...files]);
    },
    publishRelease(tag) {
      call(['release', 'edit', tag, '--repo', repo, '--draft=false']);
    },
    listOpenPullRequests(head) {
      const result = call(['pr', 'list', '--repo', repo, '--head', head, '--state', 'open', '--json', 'number,url,headRefName,isCrossRepository'], { allowFailure: true });
      if (result.status !== 0) throw ghError('E_PUBLISH_GH', `gh pr list failed: ${result.stderr || result.stdout}`);
      return JSON.parse(result.stdout);
    },
    async createPullRequest({ base, head, title, body }) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-pr-body-'));
      const file = path.join(directory, 'body.md');
      await fs.writeFile(file, body || '');
      try {
        const result = call(['pr', 'create', '--repo', repo, '--base', base, '--head', head, '--title', title, '--body-file', file]);
        return result.stdout.split('\n').filter(Boolean).pop() || '';
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
    async verifyPublicAsset(url, expected, http = {}) {
      let response;
      try {
        response = await fetchBytes(url, {
          fetchImpl: http.fetch,
          resolveHost: http.resolveHost,
          retries: 1,
          maxRedirects: 5,
          connectMs: http.connectMs || 15000,
          idleMs: http.idleMs || 30000,
          totalMs: http.totalMs || 180000,
          maxBytes: expected.size + 1,
          errorCodes: { rejected: 'E_PUBLISH_URL_REJECTED', fetch: 'E_PUBLISH_DOWNLOAD_FAILED', timeout: 'E_PUBLISH_DOWNLOAD_TIMEOUT', tooLarge: 'E_PUBLISH_TOO_LARGE' },
        });
      } catch (_error) {
        throw ghError('E_PUBLISH_PUBLIC_ASSET', `public asset is not reachable: ${url}`);
      }
      const bytes = Buffer.from(response.bytes || new Uint8Array(0));
      if (bytes.length !== expected.size || sha256(bytes) !== expected.sha256) {
        throw ghError('E_PUBLISH_PUBLIC_ASSET', `public asset bytes/hash mismatch: ${url}`);
      }
      return { finalUrl: response.url, sha256: expected.sha256, size: expected.size };
    },
  };
}

export function parseGitHubRepo(url) {
  if (typeof url !== 'string') return null;
  const match = url.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}
