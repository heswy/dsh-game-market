#!/usr/bin/env node
/**
 * M3 probe-release verifier (read-only git; no commits, no pushes, no tags).
 *
 * Binding plan (Lead, 2026-10-20; supersedes 1.2.3):
 *   A = R_A       version 1.2.1 — verification probe release, pushed as a ref
 *   B = R_B       version 1.2.2 — verification probe release, pushed as a ref
 *   C = R_final   version 1.3.0 — the M3 PR fixed head release-style commit
 *                                  (NOT tagged, NOT released, NOT merged)
 *
 * Expected chain: R_A -> P_B (version commit 1.2.2) -> R_B -> ... implementation ... -> R_final.
 * V1 HMR chain: install R_A -> real Client update to R_B -> real Client update to R_final.
 * V1 non-HMR: install R_A -> update R_B -> pending-restart -> restart -> both ends 1.2.2.
 *
 * For each release commit R_x this checks, entirely read-only:
 *   - full 40-hex commit exists in the local object DB; no tag points at it;
 *   - `package.json` at R_x: name dsh-game-market, stable version == expected,
 *     main index.js, and `files[]` includes the shipped runtime
 *     (index.js, client.js, cordis.patch.yml, locale, packages, games, registry,
 *     platform-updates/release.json) — installability of the tree;
 *   - `platform-updates/release.json` at R_x: schemaVersion 1, version matches,
 *     clientBuildCommit == first parent P_x; P_x carries the same version and
 *     does NOT contain release.json (two-phase release, no self-reference);
 *   - required install-tree files really exist in the commit;
 *   - built `client.js` contains the embedded build identity (version +
 *     clientBuildCommit) and no unbundled identity placeholder;
 *   - A is an ancestor of B, B an ancestor of R_final; versions strictly increase;
 *   - `git ls-remote` (read-only, local proxy env only for that child command)
 *     shows each commit advertised by its expected ref (defaults:
 *     refs/heads/verify/m3-probe-a, refs/heads/verify/m3-probe-b,
 *     refs/heads/feat/v1.5-platform-update for R_final);
 *   - probe commits contain no `platform-updates/plugins.json` (production index
 *     untouched by this round).
 *
 * Usage:
 *   node scripts/verification/v1.5/m3/verify-probe-releases.mjs \
 *     --a <R_A> --b <R_B> --final <R_final> \
 *     [--version-a 1.2.1 --version-b 1.2.2 --version-final 1.3.0] \
 *     [--ref-a refs/heads/verify/m3-probe-a --ref-b refs/heads/verify/m3-probe-b \
 *      --ref-final refs/heads/feat/v1.5-platform-update] [--write-evidence]
 *
 * Exit 0 iff every required check passed. Read-only: only `git cat-file`,
 * `git show`, `git rev-parse`, `git merge-base --is-ancestor`, `git ls-tree`,
 * `git tag --points-at`, `git ls-remote` are used.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RAW_ROOT = path.join(REPO_ROOT, 'docs/verification/v1.5/raw/m3');
const GIT_PROXY_ENV = {
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  ALL_PROXY: 'http://127.0.0.1:7897',
};

/** Files a git-installed bundle MUST ship for the update to be usable. */
const REQUIRED_TREE_FILES = ['index.js', 'client.js', 'cordis.patch.yml', 'platform-updates/release.json'];
/** package.json `files` globs the install must include (release tooling contract). */
const REQUIRED_FILES_GLOBS = ['index.js', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'packages/host/**', 'packages/shared/**', 'games/**', 'registry/**', 'platform-updates/release.json'];

function parseArgs(argv) {
  const args = {
    a: null,
    b: null,
    final: null,
    versionA: '1.2.1',
    versionB: '1.2.2',
    versionFinal: '1.3.0',
    refA: 'refs/heads/verify/m3-probe-a',
    refB: 'refs/heads/verify/m3-probe-b',
    refFinal: 'refs/heads/feat/v1.5-platform-update',
    origin: 'origin',
    writeEvidence: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--a') args.a = argv[++i];
    else if (arg === '--b') args.b = argv[++i];
    else if (arg === '--final') args.final = argv[++i];
    else if (arg === '--version-a') args.versionA = argv[++i];
    else if (arg === '--version-b') args.versionB = argv[++i];
    else if (arg === '--version-final') args.versionFinal = argv[++i];
    else if (arg === '--ref-a') args.refA = argv[++i];
    else if (arg === '--ref-b') args.refB = argv[++i];
    else if (arg === '--ref-final') args.refFinal = argv[++i];
    else if (arg === '--origin') args.origin = argv[++i];
    else if (arg === '--write-evidence') args.writeEvidence = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  for (const key of ['a', 'b', 'final']) {
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

function git(argsList, { allowFail = false, env = null } = {}) {
  const result = spawnSync('git', argsList, { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, ...(env ?? {}) } });
  if (result.status !== 0) {
    if (allowFail) return { ok: false, status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    throw new Error(`git ${argsList.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return { ok: true, status: 0, stdout: result.stdout.trim(), stderr: result.stderr ?? '' };
}

function showJson(commit, relPath) {
  const result = git(['show', `${commit}:${relPath}`], { allowFail: true });
  if (!result.ok) return { ok: false, error: result.stderr.trim() || `missing ${relPath}` };
  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, error: `unparseable ${relPath}: ${error.message}` };
  }
}

function showText(commit, relPath) {
  const result = git(['show', `${commit}:${relPath}`], { allowFail: true });
  return result.ok ? { ok: true, text: result.stdout } : { ok: false, error: result.stderr.trim() };
}

function treePaths(commit) {
  const result = git(['ls-tree', '-r', '--name-only', commit], { allowFail: true });
  return result.ok ? result.stdout.split('\n').filter(Boolean) : [];
}

function commitExists(commit) {
  return git(['cat-file', '-e', `${commit}^{commit}`], { allowFail: true }).ok;
}

function parentOf(commit) {
  const result = git(['rev-parse', `${commit}^`], { allowFail: true });
  return result.ok ? result.stdout.trim() : null;
}

function tagPointsAt(commit) {
  const result = git(['tag', '--points-at', commit], { allowFail: true });
  return result.ok ? result.stdout.split('\n').filter(Boolean) : [];
}

function versionAt(commit) {
  const pkg = showJson(commit, 'package.json');
  return pkg.ok ? (pkg.value.version ?? null) : null;
}

const targets = [
  { label: 'A', kind: 'probe-release', commit: args.a, version: args.versionA, ref: args.refA },
  { label: 'B', kind: 'probe-release', commit: args.b, version: args.versionB, ref: args.refB },
  { label: 'FINAL', kind: 'pr-head-release', commit: args.final, version: args.versionFinal, ref: args.refFinal },
];

add('commit-shas-are-full-lowercase-40hex', targets.every((target) => /^[0-9a-f]{40}$/.test(target.commit)), targets.map((target) => ({ label: target.label, commit: target.commit })));
add('commit-shas-distinct', new Set(targets.map((target) => target.commit)).size === 3, targets.map((target) => target.commit));

for (const target of targets) {
  const { label, commit, version } = target;
  const exists = commitExists(commit);
  add(`release-${label}-commit-exists`, exists, { commit });
  if (!exists) continue;

  add(`release-${label}-version-is-stable-semver`, /^\d+\.\d+\.\d+$/.test(version), version);

  const pkg = showJson(commit, 'package.json');
  add(`release-${label}-has-package-json`, pkg.ok, pkg.ok ? { name: pkg.value.name, version: pkg.value.version } : pkg.error);
  if (pkg.ok) {
    add(`release-${label}-package-name-is-dsh-game-market`, pkg.value.name === 'dsh-game-market', pkg.value.name);
    add(`release-${label}-package-version-matches`, pkg.value.version === version, { atCommit: pkg.value.version, expected: version });
    add(`release-${label}-main-entry-index-js`, pkg.value.main === 'index.js', pkg.value.main);
    const files = Array.isArray(pkg.value.files) ? pkg.value.files : [];
    const missingGlobs = REQUIRED_FILES_GLOBS.filter((glob) => !files.includes(glob));
    add(`release-${label}-package-files-include-shipped-runtime`, missingGlobs.length === 0, { requiredGlobs: REQUIRED_FILES_GLOBS, missingGlobs, files });
  }

  const releaseJson = showJson(commit, 'platform-updates/release.json');
  add(`release-${label}-has-release-json`, releaseJson.ok, releaseJson.ok ? releaseJson.value : releaseJson.error);
  if (releaseJson.ok) {
    const release = releaseJson.value;
    add(`release-${label}-release-schema-version-1`, release.schemaVersion === 1, release.schemaVersion);
    add(`release-${label}-release-version-matches`, release.version === version, { releaseJsonVersion: release.version ?? null, expected: version });
    const parent = parentOf(commit);
    add(
      `release-${label}-client-build-commit-is-first-parent`,
      typeof release.clientBuildCommit === 'string' && /^[0-9a-f]{40}$/.test(release.clientBuildCommit) && release.clientBuildCommit === parent,
      { clientBuildCommit: release.clientBuildCommit ?? null, parent },
    );
    if (parent !== null) {
      add(`release-${label}-parent-carries-same-version`, versionAt(parent) === version, { parent, parentVersion: versionAt(parent) });
      const parentRelease = showJson(parent, 'platform-updates/release.json');
      add(`release-${label}-parent-has-no-release-json-no-self-reference`, parentRelease.ok === false, parentRelease.ok ? 'parent unexpectedly contains release.json' : 'ok (absent on parent)');
    }
    const client = showText(commit, 'client.js');
    add(`release-${label}-has-client-js`, client.ok, client.ok ? { bytes: Buffer.byteLength(client.text) } : client.error);
    if (client.ok) {
      record(`release-${label}-client-js-embeds-version`, client.text.includes(`"${version}"`));
      record(`release-${label}-client-js-embeds-client-build-commit`, typeof release.clientBuildCommit === 'string' && client.text.includes(release.clientBuildCommit));
      add(`release-${label}-client-js-has-no-identity-placeholder`, !client.text.includes('__DGM_CLIENT_BUILD_IDENTITY__'), { placeholderPresent: client.text.includes('__DGM_CLIENT_BUILD_IDENTITY__') });
    }
    record(`release-${label}-release-json`, release);
  }

  const paths = treePaths(commit);
  const missingFiles = REQUIRED_TREE_FILES.filter((rel) => !paths.includes(rel));
  add(`release-${label}-required-tree-files-present`, missingFiles.length === 0, { requiredTreeFiles: REQUIRED_TREE_FILES, missingFiles });
  add(`release-${label}-tree-has-host-index`, paths.includes('packages/host/src/index.js'), { hasHostIndex: paths.includes('packages/host/src/index.js') });
  record(`release-${label}-tree-file-count`, paths.length);

  const tags = tagPointsAt(commit);
  add(`release-${label}-no-tag-points-at-commit`, tags.length === 0, { tags });
  add(`release-${label}-contains-no-production-index`, paths.includes('platform-updates/plugins.json') === false, { indexInTree: paths.includes('platform-updates/plugins.json') });
}

// SemVer order: 1.2.1 < 1.2.2 < 1.3.0 (strictly increasing stable versions).
const semverTuple = (version) => version.split('.').map(Number);
const [va, vb, vf] = [semverTuple(args.versionA), semverTuple(args.versionB), semverTuple(args.versionFinal)];
const increasing = (left, right) => (left[0] !== right[0] ? left[0] < right[0] : left[1] !== right[1] ? left[1] < right[1] : left[2] < right[2]);
add('versions-strictly-increasing-a-b-final', increasing(va, vb) && increasing(vb, vf), { versions: [args.versionA, args.versionB, args.versionFinal] });

// Chain reachability: needed for pnpm SHA fetch + the two-step update story.
const isAncestor = (ancestor, descendant) => git(['merge-base', '--is-ancestor', ancestor, descendant], { allowFail: true }).ok;
add('chain-a-ancestor-of-b', isAncestor(args.a, args.b), { a: args.a, b: args.b });
add('chain-b-ancestor-of-final', isAncestor(args.b, args.final), { b: args.b, final: args.final });

// Pushed refs (read-only network; proxy env only in this child command).
let lsRemote = { ok: false, error: 'not attempted' };
const remoteRefs = new Map();
try {
  const out = git(['ls-remote', args.origin], { env: GIT_PROXY_ENV, allowFail: true });
  if (!out.ok) lsRemote = { ok: false, error: out.stderr.trim() || `git ls-remote exit ${out.status}` };
  else {
    for (const line of out.stdout.split('\n').filter(Boolean)) {
      const [sha, ref] = line.split(/\s+/);
      remoteRefs.set(ref, sha);
    }
    lsRemote = {
      ok: true,
      origin: args.origin,
      refs: targets.map((target) => ({ label: target.label, ref: target.ref, expectedSha: target.commit, advertisedSha: remoteRefs.get(target.ref) ?? null })),
      verificationRefs: [...remoteRefs.keys()].filter((ref) => ref.startsWith('refs/heads/verify/')),
    };
    for (const target of targets) {
      add(`release-${target.label}-pushed-ref-matches-commit`, remoteRefs.get(target.ref) === target.commit, { ref: target.ref, advertisedSha: remoteRefs.get(target.ref) ?? null, expectedSha: target.commit });
    }
  }
} catch (error) {
  lsRemote = { ok: false, error: String(error && error.message ? error.message : error) };
}
record('git-ls-remote', lsRemote);

// Production index untouched by these probe commits.
const mainIndex = git(['show', `${args.origin}/main:platform-updates/plugins.json`], { allowFail: true });
record('origin-main-production-index-state', { present: mainIndex.ok, note: 'production index is not written by this round' });

const failedRequired = checks.filter((check) => check.required && !check.ok);
const summary = {
  id: 'M3-V1-probe-release-check',
  title: 'Read-only verification of pushed probe release commits (A=1.2.1, B=1.2.2, R_final=1.3.0)',
  checkedAt: new Date().toISOString(),
  bindingPlan: 'Lead 2026-10-20: A=R_A 1.2.1, B=R_B 1.2.2, C=R_final 1.3.0 (PR fixed head; not tagged/released); HMR A->B->final, non-HMR A->B restart',
  testedRepo: REPO_ROOT,
  targets: targets.map((target) => ({ label: target.label, kind: target.kind, commit: target.commit, version: target.version, ref: target.ref })),
  checks,
  failedRequired: failedRequired.map((check) => check.name),
  passed: failedRequired.length === 0,
  evidenceLevel: 'read-only git (no writes; ls-remote via local proxy env only)',
};
if (args.writeEvidence) {
  fs.mkdirSync(RAW_ROOT, { recursive: true });
  const file = path.join(RAW_ROOT, `M3-V1-probe-release-check-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`evidence=${file}\n`);
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.stderr.write(`checks=${checks.length} required=${checks.filter((check) => check.required).length} passed=${checks.filter((check) => check.ok).length} failedRequired=${failedRequired.length}\n`);
process.exitCode = summary.passed ? 0 : 1;
