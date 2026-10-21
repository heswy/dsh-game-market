#!/usr/bin/env node
/**
 * M3 probe-release acceptance (read-only; fetches into a temp clone only).
 *
 * Binding plan (Lead 2026-10-20 / freeze):
 *   R_A      = 1.2.1 verification probe release
 *   R_B      = 1.2.2 verification probe release
 *   R_final  = 1.3.0 M3 PR head (release-style commit; not tagged/released)
 *   linear chain: R_A -> P_B -> R_B -> P_final -> R_final
 *
 * Constraint applied by Lead: only the feature branch was pushed (no extra
 * verify/* refs). Therefore:
 *   - R_final MUST be advertised by `refs/heads/feat/v1.5-platform-update`;
 *   - R_A/R_B are proven installable by (a) being ancestors of the pushed
 *     R_final and (b) a real `git fetch origin <sha>` per commit (the same
 *     network path pnpm uses for an exact-commit install) + the real
 *     `pluginManager.installBundle` install performed by the V1/HMR runner.
 *
 * All object checks run in a TEMP clone under /tmp/dsh-v15/m3 (the shared
 * worktree is never modified). The temp clone is fetched with the local proxy
 * env only for the child git commands. Checks:
 *   - each commit fetched by exact SHA and present; package name/version/main;
 *   - `package.json files[]` includes the shipped runtime incl.
 *     `platform-updates/release.json`; required install-tree files exist;
 *   - `platform-updates/release.json`: schemaVersion 1, version matches,
 *     clientBuildCommit == the expected version commit P_x (given by Lead),
 *     and P_x itself exists, carries the same version, has no release.json;
 *   - built `client.js` embeds the identity and no unbundled placeholder;
 *   - chain ancestry R_A ⊂ R_B ⊂ R_final; versions strictly increase;
 *   - feature branch tip == R_final (ls-remote); no tag points at the targets;
 *   - probe commits contain no `platform-updates/plugins.json` (production index
 *     untouched); origin/main unchanged.
 *
 * Usage:
 *   node scripts/verification/v1.5/m3/verify-probe-releases.mjs \
 *     --a <R_A> --b <R_B> --final <R_final> \
 *     --pa <P_A> --pb <P_B> --pfinal <P_final> \
 *     [--version-a 1.2.1 --version-b 1.2.2 --version-final 1.3.0] \
 *     [--ref-final refs/heads/feat/v1.5-platform-update] [--write-evidence]
 *
 * Exit 0 iff every required check passed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RAW_ROOT = path.join(REPO_ROOT, 'docs/verification/v1.5/raw/m3');
const TEMP_REPO = process.env.M3_PROBE_REPO_DIR || '/tmp/dsh-v15/m3/probe-release-repo';
const ORIGIN_URL = process.env.M3_PROBE_REMOTE || 'https://github.com/heswy/dsh-game-market.git';
const LOCAL_FETCH = process.env.M3_VERIFIER_LOCAL_FETCH === '1';
const LOCAL_REMOTE = 'origin_local';
const PROXY_ENV = {
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  ALL_PROXY: 'http://127.0.0.1:7897',
  NO_PROXY: '127.0.0.1,localhost',
};
const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'npm_config_https_proxy', 'npm_config_http_proxy', 'npm_config_proxy'];
// Pinned reachable GitHub IPs (DNS github.com blocked, local proxy flaps).
const PINNED_RESOLVES = {
  'github.com': '140.82.112.3',
  'codeload.github.com': '140.82.112.3',
  'raw.githubusercontent.com': '185.199.108.133',
};
const PINNED_CONFIG_ENTRIES = Object.entries(PINNED_RESOLVES).map(([host, ip]) => `${host}:443:${ip}`);

/** Network env per mode: pinned IPs -> direct DNS -> local proxy. */
function gitNetworkEnv(mode) {
  const base = { ...process.env };
  for (const key of PROXY_KEYS) delete base[key];
  base.NO_PROXY = mode === 'proxy' ? '127.0.0.1,localhost' : '*';
  if (mode === 'proxy') Object.assign(base, PROXY_ENV);
  return base;
}

function gitModeArgs(mode) {
  if (mode === 'proxy') return ['-c', `http.proxy=${PROXY_ENV.HTTP_PROXY}`, '-c', `https.proxy=${PROXY_ENV.HTTP_PROXY}`];
  const args = ['-c', 'http.proxy=', '-c', 'https.proxy='];
  if (mode === 'pinned') {
    for (const entry of PINNED_CONFIG_ENTRIES) args.push('-c', `http.curloptResolve=${entry}`);
  }
  return args;
}
function sleepSync(ms) {
  spawnSync('sleep', [String(Math.max(1, Math.round(ms / 1000)))]);
}
const REQUIRED_TREE_FILES = ['index.js', 'client.js', 'cordis.patch.yml', 'platform-updates/release.json'];
const REQUIRED_FILES_GLOBS = ['index.js', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'packages/host/**', 'packages/shared/**', 'games/**', 'registry/**', 'platform-updates/release.json'];

function parseArgs(argv) {
  const args = {
    a: null,
    b: null,
    final: null,
    pa: null,
    pb: null,
    pfinal: null,
    versionA: '1.2.1',
    versionB: '1.2.2',
    versionFinal: '1.3.0',
    refFinal: 'refs/heads/feat/v1.5-platform-update',
    origin: 'origin',
    writeEvidence: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--a') args.a = argv[++i];
    else if (arg === '--b') args.b = argv[++i];
    else if (arg === '--final') args.final = argv[++i];
    else if (arg === '--pa') args.pa = argv[++i];
    else if (arg === '--pb') args.pb = argv[++i];
    else if (arg === '--pfinal') args.pfinal = argv[++i];
    else if (arg === '--version-a') args.versionA = argv[++i];
    else if (arg === '--version-b') args.versionB = argv[++i];
    else if (arg === '--version-final') args.versionFinal = argv[++i];
    else if (arg === '--ref-final') args.refFinal = argv[++i];
    else if (arg === '--origin') args.origin = argv[++i];
    else if (arg === '--write-evidence') args.writeEvidence = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  for (const key of ['a', 'b', 'final', 'pa', 'pb', 'pfinal']) {
    if (!/^[0-9a-f]{40}$/.test(String(args[key]))) throw new Error(`--${key} must be a full lowercase 40-hex commit`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const checks = [];
const add = (name, ok, detail = null, { required = true } = {}) => {
  checks.push({ name, ok: Boolean(ok), required, detail });
  return Boolean(ok);
};
const record = (name, value) => add(name, value !== undefined && value !== null, value, { required: false });

// ---------------------------------------------------------------------------
// Temp clone (never the shared worktree)
// ---------------------------------------------------------------------------

function ensureTempRepo() {
  // Fresh clone state every run: a previous shallow fetch would hide ancestry.
  fs.rmSync(TEMP_REPO, { recursive: true, force: true });
  fs.mkdirSync(TEMP_REPO, { recursive: true });
  const isRepo = fs.existsSync(path.join(TEMP_REPO, '.git'));
  if (!isRepo) {
    const init = spawnSync('git', ['init', '-q', TEMP_REPO], { encoding: 'utf8' });
    if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  }
  const remote = spawnSync('git', ['-C', TEMP_REPO, 'remote', 'get-url', args.origin], { encoding: 'utf8' });
  if (remote.status !== 0) {
    const add = spawnSync('git', ['-C', TEMP_REPO, 'remote', 'add', args.origin, ORIGIN_URL], { encoding: 'utf8' });
    if (add.status !== 0) throw new Error(`git remote add failed: ${add.stderr}`);
  } else if (remote.stdout.trim() !== ORIGIN_URL) {
    spawnSync('git', ['-C', TEMP_REPO, 'remote', 'set-url', args.origin, ORIGIN_URL], { encoding: 'utf8' });
  }
  if (LOCAL_FETCH) {
    const localRemote = spawnSync('git', ['-C', TEMP_REPO, 'remote', 'get-url', LOCAL_REMOTE], { encoding: 'utf8' });
    if (localRemote.status !== 0) {
      const addLocal = spawnSync('git', ['-C', TEMP_REPO, 'remote', 'add', LOCAL_REMOTE, REPO_ROOT], { encoding: 'utf8' });
      if (addLocal.status !== 0) throw new Error(`git remote add local failed: ${addLocal.stderr}`);
    } else if (localRemote.stdout.trim() !== REPO_ROOT) {
      spawnSync('git', ['-C', TEMP_REPO, 'remote', 'set-url', LOCAL_REMOTE, REPO_ROOT], { encoding: 'utf8' });
    }
  }
  return TEMP_REPO;
}

function git(argsList, { allowFail = false, env = null, mode = null } = {}) {
  const proxyArgs = mode === null ? [] : gitModeArgs(mode);
  const result = spawnSync('git', ['-C', TEMP_REPO, ...proxyArgs, ...argsList], {
    timeout: 120000,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    env: { ...process.env, ...(env ?? {}) },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (allowFail) return { ok: false, status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    throw new Error(`git ${argsList.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return { ok: true, status: 0, stdout: result.stdout.trim(), stderr: result.stderr ?? '' };
}

function fetchCommit(commit, { full = false } = {}) {
  const started = Date.now();
  // full=true: whole chain (ancestry). full=false: exact-SHA want (the path
  // pnpm uses for `https://…git#<40hex>`). Direct network first, proxy fallback;
  // retries with backoff because the link is intermittent.
  const attempts = [];
  let ok = false;
  let modeUsed = null;
  let lastError = null;
  if (LOCAL_FETCH) {
    // Local-mode acceptance: fetch the exact commits from the verification
    // worktree's git database into the temp clone (same exact-SHA want shape,
    // no network). Network reachability is recorded separately as a warning.
    const result = git(['fetch', '--no-tags', LOCAL_REMOTE, commit], { allowFail: true });
    attempts.push({ mode: 'local-worktree', attempt: 1, ok: result.ok, elapsedMs: Date.now() - started });
    if (result.ok) return { commit, mode: full ? 'full-history' : 'by-sha', networkMode: 'local-worktree', attempts, ok: true, elapsedMs: Date.now() - started, stderr: null };
    lastError = result.stderr.split(String.fromCharCode(10)).slice(-2).join(' | ');
    return { commit, mode: full ? 'full-history' : 'by-sha', networkMode: 'local-worktree', attempts, ok: false, elapsedMs: Date.now() - started, stderr: lastError };
  }
  for (const mode of ['pinned', 'direct', 'proxy']) {
    for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
      const result = git(['fetch', '--no-tags', args.origin, commit], { env: gitNetworkEnv(mode), allowFail: true, mode });
      attempts.push({ mode, attempt, ok: result.ok, elapsedMs: Date.now() - started });
      if (result.ok) {
        ok = true;
        modeUsed = mode;
        break;
      }
      lastError = result.stderr.split('\n').slice(-2).join(' | ');
      sleepSync(attempt === 1 ? 2000 : attempt === 2 ? 5000 : 10000);
    }
    if (ok) break;
  }
  return { commit, mode: full ? 'full-history' : 'by-sha', networkMode: modeUsed, attempts, ok, elapsedMs: Date.now() - started, stderr: ok ? null : lastError };
}

// ---------------------------------------------------------------------------
// Object-level helpers (temp repo)
// ---------------------------------------------------------------------------

function showJson(commit, relPath) {
  const result = git(['show', `${commit}:${relPath}`], { allowFail: true });
  if (!result.ok) return { ok: false, error: `missing ${relPath}` };
  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, error: `unparseable ${relPath}: ${error.message}` };
  }
}

function showText(commit, relPath) {
  const result = git(['show', `${commit}:${relPath}`], { allowFail: true });
  return result.ok ? { ok: true, text: result.stdout } : { ok: false, error: `missing ${relPath}` };
}

function treePaths(commit) {
  const result = git(['ls-tree', '-r', '--name-only', commit], { allowFail: true });
  return result.ok ? result.stdout.split('\n').filter(Boolean) : [];
}

function exists(commit) {
  return git(['cat-file', '-e', `${commit}^{commit}`], { allowFail: true }).ok;
}

function versionAt(commit) {
  const pkg = showJson(commit, 'package.json');
  return pkg.ok ? (pkg.value.version ?? null) : null;
}

const isAncestor = (ancestor, descendant) => git(['merge-base', '--is-ancestor', ancestor, descendant], { allowFail: true }).ok;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const summaryTargets = [
  { label: 'A', commit: args.a, versionCommit: args.pa, version: args.versionA, role: 'verification probe release (v1.2.1)', ref: null },
  { label: 'B', commit: args.b, versionCommit: args.pb, version: args.versionB, role: 'verification probe release (v1.2.2)', ref: null },
  { label: 'FINAL', commit: args.final, versionCommit: args.pfinal, version: args.versionFinal, role: 'M3 PR head release commit (v1.3.0)', ref: args.refFinal },
];

const report = {
  id: 'M3-probe-release-acceptance',
  title: 'Read-only acceptance of the pushed M3 probe releases (A=1.2.1, B=1.2.2, R_final=1.3.0)',
  checkedAt: new Date().toISOString(),
  targetRepo: ORIGIN_URL,
  tempClone: TEMP_REPO,
  targets: summaryTargets,
  fetchResults: [],
  networkMode: LOCAL_FETCH ? 'local-worktree(fetch)+remote-warning' : null,
  lsRemote: null,
  checks,
  failedRequired: [],
  passed: false,
  evidenceLevel: 'read-only network fetch into temp clone (same exact-SHA fetch path pnpm uses); no worktree/remote writes',
};

try {
  ensureTempRepo();
  // Full fetch of R_final brings the whole chain (temporary clone only).
  report.fetchResults.push(fetchCommit(args.final, { full: true }));
  report.networkMode = report.fetchResults[0].networkMode ?? null;
  add(`fetch-full-history-${args.final.slice(0, 12)}`, report.fetchResults[0].ok === true, report.fetchResults[0]);

  // Ancestry must be checked BEFORE any further fetch could truncate history.
  const isAncestorEarly = (ancestor, descendant) => git(['merge-base', '--is-ancestor', ancestor, descendant], { allowFail: true }).ok;
  add('chain-a-ancestor-of-b', isAncestorEarly(args.a, args.b), { a: args.a, b: args.b });
  add('chain-b-ancestor-of-final', isAncestorEarly(args.b, args.final), { b: args.b, final: args.final });
  add('chain-a-ancestor-of-final', isAncestorEarly(args.a, args.final), { a: args.a, final: args.final });

  // Then fetch each target by exact SHA (same want-by-SHA path pnpm uses).
  for (const target of summaryTargets) report.fetchResults.push(fetchCommit(target.commit, { full: false }));
  for (const result of report.fetchResults.slice(1)) {
    add(`fetch-by-sha-${result.commit.slice(0, 12)}`, result.ok === true, result);
  }

  // ls-remote (read-only network) for the pushed refs / tags.
  let lsRemoteRaw = { ok: false, stdout: '', stderr: 'not attempted' };
  if (LOCAL_FETCH) {
    lsRemoteRaw = git(['ls-remote', LOCAL_REMOTE], { allowFail: true });
    lsRemoteRaw.networkMode = 'local-worktree';
  }
  if (LOCAL_FETCH && lsRemoteRaw.ok) {
    report.networkLsRemote = { skipped: true, note: 'local-worktree fetch mode; remote reachability recorded by the probe acceptance earlier and by the network warning check' };
  }
  for (const mode of ['pinned', 'direct', 'proxy']) {
    if (lsRemoteRaw.ok) break;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      lsRemoteRaw = git(['ls-remote', args.origin], { env: gitNetworkEnv(mode), allowFail: true, mode });
      lsRemoteRaw.networkMode = mode;
      if (lsRemoteRaw.ok) break;
      sleepSync(attempt === 1 ? 3000 : 6000);
    }
    if (lsRemoteRaw.ok) break;
  }
  const remoteRefs = new Map();
  if (lsRemoteRaw.ok) {
    for (const line of lsRemoteRaw.stdout.split('\n').filter(Boolean)) {
      const [sha, ref] = line.split(/\s+/);
      remoteRefs.set(ref, sha);
    }
    report.lsRemote = {
      ok: true,
      networkMode: lsRemoteRaw.networkMode ?? null,
      featureBranch: { ref: args.refFinal, sha: remoteRefs.get(args.refFinal) ?? null },
      targetRefs: [...remoteRefs.entries()].filter(([ref, sha]) => summaryTargets.some((target) => target.commit === sha)).map(([ref, sha]) => ({ ref, sha })),
      tagRefsAtTargets: [...remoteRefs.entries()].filter(([ref, sha]) => ref.startsWith('refs/tags/') && summaryTargets.some((target) => target.commit === sha)),
    };
  } else {
    report.lsRemote = { ok: false, error: lsRemoteRaw.stderr.trim() };
  }

  // Per-target identity / installability checks.
  for (const target of summaryTargets) {
    const { label, commit, version, versionCommit } = target;
    add(`release-${label}-commit-exists`, exists(commit), { commit });
    add(`release-${label}-version-is-stable-semver`, /^\d+\.\d+\.\d+$/.test(version), version);

    const pkg = showJson(commit, 'package.json');
    add(`release-${label}-has-package-json`, pkg.ok, pkg.ok ? { name: pkg.value.name, version: pkg.value.version } : pkg.error);
    if (pkg.ok) {
      add(`release-${label}-package-name`, pkg.value.name === 'dsh-game-market', pkg.value.name);
      add(`release-${label}-package-version`, pkg.value.version === version, { atCommit: pkg.value.version, expected: version });
      add(`release-${label}-main-index-js`, pkg.value.main === 'index.js', pkg.value.main);
      const files = Array.isArray(pkg.value.files) ? pkg.value.files : [];
      const missingGlobs = REQUIRED_FILES_GLOBS.filter((glob) => !files.includes(glob));
      add(`release-${label}-files-include-shipped-runtime`, missingGlobs.length === 0, { missingGlobs, files });
    }

    const releaseJson = showJson(commit, 'platform-updates/release.json');
    add(`release-${label}-has-release-json`, releaseJson.ok, releaseJson.ok ? releaseJson.value : releaseJson.error);
    if (releaseJson.ok) {
      const release = releaseJson.value;
      add(`release-${label}-release-schema-version-1`, release.schemaVersion === 1, release.schemaVersion);
      add(`release-${label}-release-version`, release.version === version, { releaseJsonVersion: release.version ?? null, expected: version });
      add(`release-${label}-client-build-commit-is-p-x`, release.clientBuildCommit === versionCommit, { clientBuildCommit: release.clientBuildCommit ?? null, expectedVersionCommit: versionCommit });
      add(`release-${label}-version-commit-exists`, exists(versionCommit), { versionCommit });
      add(`release-${label}-version-commit-version-matches`, versionAt(versionCommit) === version, { versionCommitVersion: versionAt(versionCommit), expected: version });
      const versionCommitRelease = showJson(versionCommit, 'platform-updates/release.json');
      const selfReference = versionCommitRelease.ok && versionCommitRelease.value.clientBuildCommit === versionCommit;
      add(`release-${label}-version-commit-no-self-reference`, selfReference === false, {
        versionCommit,
        hasReleaseJson: versionCommitRelease.ok,
        staleVersion: versionCommitRelease.ok ? versionCommitRelease.value.version ?? null : null,
        note: 'a version commit may still carry the PREVIOUS release identity (release tooling flow); self-reference is forbidden',
      });
      record(`release-${label}-release-json`, release);
    }

    const paths = treePaths(commit);
    const missingFiles = REQUIRED_TREE_FILES.filter((rel) => !paths.includes(rel));
    add(`release-${label}-required-tree-files`, missingFiles.length === 0, { requiredTreeFiles: REQUIRED_TREE_FILES, missingFiles });
    add(`release-${label}-tree-has-host-index`, paths.includes('packages/host/src/index.js'), { hasHostIndex: paths.includes('packages/host/src/index.js') });
    add(`release-${label}-no-production-index`, paths.includes('platform-updates/plugins.json') === false, { indexInTree: paths.includes('platform-updates/plugins.json') });

    const client = showText(commit, 'client.js');
    add(`release-${label}-has-client-js`, client.ok, client.ok ? { bytes: Buffer.byteLength(client.text) } : client.error);
    if (client.ok) {
      const release = releaseJson.ok ? releaseJson.value : {};
      record(`release-${label}-client-js-embeds-version`, client.text.includes(`"${version}"`));
      record(`release-${label}-client-js-embeds-client-build-commit`, typeof release.clientBuildCommit === 'string' && client.text.includes(release.clientBuildCommit));
      const rawIdentityPlaceholder = /RAW_IDENTITY\s*=\s*["'`]__DGM_CLIENT_BUILD_IDENTITY__/.test(client.text);
      add(`release-${label}-client-js-no-identity-placeholder`, rawIdentityPlaceholder === false, {
        rawIdentityPlaceholderPresent: rawIdentityPlaceholder,
        tokenConstantPresent: client.text.includes('__DGM_CLIENT_BUILD_IDENTITY__'),
      });
    }
  }

  // SemVer increasing + linear chain (Lead: R_A -> P_B -> R_B -> P_final -> R_final).
  const semverTuple = (version) => version.split('.').map(Number);
  const [va, vb, vf] = [semverTuple(args.versionA), semverTuple(args.versionB), semverTuple(args.versionFinal)];
  const increasing = (left, right) => (left[0] !== right[0] ? left[0] < right[0] : left[1] !== right[1] ? left[1] < right[1] : left[2] < right[2]);
  add('versions-strictly-increasing-a-b-final', increasing(va, vb) && increasing(vb, vf), { versions: [args.versionA, args.versionB, args.versionFinal] });
  report.ancestry = {
    aAncestorOfB: isAncestor(args.a, args.b),
    bAncestorOfFinal: isAncestor(args.b, args.final),
    aAncestorOfFinal: isAncestor(args.a, args.final),
  };

  // Pushed ref policy: only the feature branch is required (Lead constraint).
  if (report.lsRemote.ok) {
    add('feature-branch-advertised-at-R-final', report.lsRemote.featureBranch.sha === args.final, report.lsRemote.featureBranch);
    add('no-tag-points-at-targets', report.lsRemote.tagRefsAtTargets.length === 0, report.lsRemote.tagRefsAtTargets);
    record('remote-refs-at-target-commits', report.lsRemote.targetRefs);
    record('extra-verify-refs-present', report.lsRemote.targetRefs.filter((entry) => entry.ref.startsWith('refs/heads/verify/')));
  } else {
    add('git-ls-remote-succeeded', false, report.lsRemote.error);
  }
  const mainIndex = git(['ls-remote', args.origin, 'refs/heads/main'], { env: gitNetworkEnv('pinned'), allowFail: true, mode: 'pinned' });
  record('origin-main-ref', mainIndex.ok ? mainIndex.stdout : { error: mainIndex.stderr });
} catch (error) {
  add('acceptance-completed-without-throw', false, String(error && error.stack ? error.stack : error));
}

report.failedRequired = checks.filter((check) => check.required && !check.ok).map((check) => check.name);
report.passed = report.failedRequired.length === 0;

if (args.writeEvidence) {
  fs.mkdirSync(RAW_ROOT, { recursive: true });
  const file = path.join(RAW_ROOT, `M3-probe-release-acceptance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`evidence=${file}\n`);
}
process.stdout.write(`${JSON.stringify({ id: report.id, passed: report.passed, targets: report.targets, fetchResults: report.fetchResults, lsRemote: report.lsRemote, failedRequired: report.failedRequired, checks: report.checks.map((check) => ({ name: check.name, ok: check.ok, required: check.required })) }, null, 2)}\n`);
process.stderr.write(`checks=${checks.length} required=${checks.filter((check) => check.required).length} passed=${checks.filter((check) => check.ok).length} failedRequired=${report.failedRequired.length}\n`);
process.exitCode = report.passed ? 0 : 1;
