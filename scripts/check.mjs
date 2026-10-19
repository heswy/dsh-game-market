#!/usr/bin/env node
/**
 * Repository checks for V0 (PRD §10.2 / §10.6, D-023):
 *   - required files exist and JSON/YAML snippets are sane
 *   - every JavaScript file parses
 *   - built client bundle is a DSH module-loader bundle
 *   - snake entry is a single self-contained HTML file within limits
 *
 * Usage: node scripts/check.mjs [--allow-missing]
 *   --allow-missing: feature branches may run this before all modules exist.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BUNDLE_ID, LIMITS } from '../packages/shared/src/constants.js';
import { validatePackageHtml } from '../packages/shared/src/manifest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const allowMissing = process.argv.includes('--allow-missing');
const problems = [];
const checks = [];

function ok(message) {
  checks.push(`PASS  ${message}`);
}

function fail(message) {
  problems.push(message);
}

function requiredFile(relPath, { allow = allowMissing } = {}) {
  const abs = path.join(root, relPath);
  if (fs.existsSync(abs)) {
    ok(relPath);
    return abs;
  }
  if (allow) return null;
  fail(`missing required file: ${relPath}`);
  return null;
}

// 1. Bundle metadata
const pkgPath = requiredFile('package.json');
if (pkgPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.name !== BUNDLE_ID) fail(`package.json name must be "${BUNDLE_ID}"`);
    if (!pkg.dsh?.bundle?.patch) fail('package.json missing dsh.bundle.patch');
    if (pkg.dsh?.client?.platform !== 'web') fail('package.json missing dsh.client.platform="web"');
    if (pkg.dsh?.bundle?.patch && !fs.existsSync(path.join(root, pkg.dsh.bundle.patch))) {
      fail(`bundle patch not found: ${pkg.dsh.bundle.patch}`);
    }
    if (pkg.exports?.['./client'] !== './client.js') fail('package.json must export "./client" -> "./client.js"');
    ok('package.json bundle manifest');
  } catch (error) {
    fail(`package.json is invalid JSON: ${error.message}`);
  }
}

const patchPath = requiredFile('cordis.patch.yml');
if (patchPath) {
  const patch = fs.readFileSync(patchPath, 'utf8');
  if (!patch.includes('- insert:') || !patch.includes('id: dsh-game-market')) {
    fail('cordis.patch.yml does not insert the dsh-game-market row');
  } else {
    ok('cordis.patch.yml inserts dsh-game-market');
  }
}

// 2. JS syntax
const jsFiles = [];
for (const dir of ['packages', 'scripts', 'tests']) {
  const abs = path.join(root, dir);
  if (fs.existsSync(abs)) collectJs(abs, jsFiles);
}
for (const rel of ['index.js', 'client.js']) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) jsFiles.push(abs);
}
for (const abs of jsFiles) {
  const rel = path.relative(root, abs);
  const result = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`syntax error in ${rel}: ${(result.stderr || '').split('\n').slice(0, 3).join(' ')}`);
  }
}
if (!problems.length) ok(`${jsFiles.length} JavaScript files parse`);

// 3. Client bundle
const clientAbs = path.join(root, 'client.js');
if (fs.existsSync(clientAbs)) {
  const code = fs.readFileSync(clientAbs, 'utf8');
  if (!code.includes('__ModuleLoader__.load')) fail('client.js is not a DSH module-loader bundle');
  if (!code.includes(`id: "${BUNDLE_ID}"`)) fail(`client.js module id must be "${BUNDLE_ID}"`);
  const bytes = fs.statSync(clientAbs).size;
  if (bytes <= 0) fail('client.js is empty');
  ok(`client.js bundle (${bytes} bytes)`);
} else {
  requiredFile('client.js');
}

// 4. V1 single-file game packages (games/<id>/game.json + dist/index.html)
const gamesDir = path.join(root, 'games');
if (!fs.existsSync(gamesDir)) {
  fail('missing games/ directory');
} else {
  for (const entry of fs.readdirSync(gamesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(gamesDir, entry.name);
    const manifestPath = path.join(dir, 'game.json');
    const distPath = path.join(dir, 'dist/index.html');
    const relManifest = `games/${entry.name}/game.json`;
    if (!fs.existsSync(manifestPath)) {
      fail(`missing ${relManifest}`);
      continue;
    }
    let source;
    try {
      source = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      fail(`${relManifest} invalid: ${error.message}`);
      continue;
    }
    for (const field of ['manifestVersion', 'id', 'name', 'version', 'sdkVersion', 'runtimeVersion']) {
      if (source[field] === undefined) fail(`${relManifest} missing field: ${field}`);
    }
    if (source.id !== entry.name) fail(`${relManifest} id must match directory name "${entry.name}"`);
    if (!fs.existsSync(distPath)) {
      fail(`missing games/${entry.name}/dist/index.html (run npm run build)`);
      continue;
    }
    const html = fs.readFileSync(distPath, 'utf8');
    const bytes = Buffer.byteLength(html, 'utf8');
    const result = validatePackageHtml(html);
    if (!result.ok) {
      for (const error of result.errors.slice(0, 5)) {
        fail(`games/${entry.name}/dist/index.html invalid: ${error.code} ${error.message}`);
      }
      continue;
    }
    if (result.manifest.id !== source.id) {
      fail(`games/${entry.name}/dist manifest id "${result.manifest.id}" != source "${source.id}"`);
    }
    if (result.manifest.version !== source.version) {
      fail(
        `games/${entry.name}/dist manifest version "${result.manifest.version}" != source "${source.version}"`,
      );
    }
    if (bytes > LIMITS.packageBytes) {
      fail(`games/${entry.name}/dist/index.html too large: ${bytes} > ${LIMITS.packageBytes}`);
    }
    ok(`games/${entry.name}/dist/index.html (${bytes} bytes, V1 single-file package)`);
  }
}

// 5. Required module entry points (strict mode only)
if (!allowMissing) {
  requiredFile('packages/host/src/plugin.js');
  requiredFile('packages/client/src/main.js');
  requiredFile('packages/runtime/src/index.js');
  requiredFile('packages/sdk/src/sdk.js');
  requiredFile('packages/sdk/src/index.d.ts');
  requiredFile('scripts/cli/dsh-game.mjs');
  requiredFile('scripts/cli/create-dsh-game.mjs');
  requiredFile('templates/vanilla/manifest.json');
  requiredFile('templates/registry/README.md');
  requiredFile('templates/registry/toolchain.lock.json');
  requiredFile('templates/registry/.github/ISSUE_TEMPLATE/submit-game.yml');
  requiredFile('templates/registry/.github/workflows/validate-catalog.yml');
  requiredFile('scripts/registry/generate-catalog.mjs');
  requiredFile('scripts/registry/validate-catalog.mjs');
  requiredFile('scripts/registry/validate-assets.mjs');
  requiredFile('scripts/registry/prepare.mjs');
  requiredFile('scripts/registry/init-content-repo.mjs');
  requiredFile('scripts/registry/pack-skill.mjs');
  requiredFile('skills/dsh-game-developer/SKILL.md');
  requiredFile('skills/dsh-game-developer/VERSION');
  requiredFile('docs/community-publishing-contracts.md');
  // V1 contract modules (M0): manifest/single-file package, Registry, install layout.
  requiredFile('packages/shared/src/manifest.js');
  requiredFile('packages/shared/src/registry.js');
  requiredFile('packages/shared/src/installation.js');
}

function collectJs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJs(abs, out);
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) out.push(abs);
  }
}

// Default bundled Registry (CR-01): the index and every package must match,
// and the npm `files` whitelist must ship them.
(function checkBundledRegistry() {
  const registryPath = path.join(root, 'registry', 'games.json');
  const packagesDir = path.join(root, 'registry', 'packages');
  if (!fs.existsSync(registryPath)) {
    fail('missing bundled default registry: registry/games.json');
    return;
  }
  let index;
  try {
    index = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    fail(`registry/games.json is invalid JSON: ${error.message}`);
    return;
  }
  if (index.registryVersion !== 1) fail('registry/games.json registryVersion must be 1');
  if (!Array.isArray(index.games) || index.games.length !== 3) {
    fail('registry/games.json must contain the three installable first-party games');
    return;
  }
  if (Number.isNaN(Date.parse(index.generatedAt))) fail('registry/games.json generatedAt must be ISO');
  const seen = new Set();
  for (const game of index.games) {
    if (!game || typeof game.id !== 'string' || seen.has(game.id)) {
      fail('registry/games.json has a duplicate or invalid game id');
      continue;
    }
    seen.add(game.id);
    const fileName = `${game.id}-${game.version}.html`;
    const packagePath = path.join(packagesDir, fileName);
    if (!fs.existsSync(packagePath)) {
      fail(`bundled registry package missing: registry/packages/${fileName}`);
      continue;
    }
    const bytes = fs.readFileSync(packagePath);
    if (game.package?.size !== bytes.length) fail(`registry package size mismatch: ${fileName}`);
    const actualSha = createHash('sha256').update(bytes).digest('hex');
    if (game.package?.sha256 !== actualSha) fail(`registry package sha256 mismatch: ${fileName}`);
    if (typeof game.cover !== 'string' || !/^https:\/\//.test(game.cover)) {
      fail(`registry package cover must be https: ${game.id}`);
    }
    const validation = validatePackageHtml(bytes.toString('utf8'), { packageBytes: LIMITS.packageBytes });
    if (!validation.ok || !validation.manifest) fail(`bundled registry package is invalid: ${fileName}`);
    else if (validation.manifest.id !== game.id || validation.manifest.version !== game.version) {
      fail(`bundled registry manifest mismatch: ${fileName}`);
    }
    if (!/^packages\/[a-z0-9-]+-\d+\.\d+\.\d+\.html$/.test(game.package?.url || '')) {
      fail(`bundled registry package url is unsupported: ${game.id}`);
    }
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch (_error) {
    pkg = null;
  }
  const files = Array.isArray(pkg?.files) ? pkg.files : [];
  if (!files.some((entry) => entry === 'registry/**' || entry === 'registry')) {
    fail('package.json files must include "registry/**" so the default registry ships');
  }
  ok('bundled default registry');
})();

// CR-07: verification evidence referenced by the report must exist in Git and
// must not be swallowed by the global `*.log` ignore rule.
(function checkVerificationLogs() {
  const evidenceDoc = path.join(root, 'docs/verification/v1/AUTOMATED-EVIDENCE.md');
  if (fs.existsSync(evidenceDoc)) {
    const text = fs.readFileSync(evidenceDoc, 'utf8');
    const refs = [...text.matchAll(/`((?:docs\/)?verification\/v1\/logs\/[^`]+?\.log)`/g)].map((match) => match[1]);
    for (const ref of refs) {
      const abs = path.join(root, 'docs', ref.replace(/^docs\//, ''));
      if (!fs.existsSync(abs)) fail(`verification log referenced but missing: ${ref}`);
    }
  }
  const ignored = spawnSync('git', ['check-ignore', '-q', 'docs/verification/v1/logs/AE-01-run.log'], { cwd: root });
  if (ignored.status === 0) fail('verification logs are ignored by Git (CR-07)');
  const tracked = spawnSync('git', ['ls-files', 'docs/verification/v1/logs'], { cwd: root, encoding: 'utf8' });
  if (tracked.status === 0 && tracked.stdout.trim().length === 0) {
    fail('verification logs are not tracked by Git (CR-07)');
  }
  ok('verification logs tracked');
})();

// Community publishing artifacts (V1.2): Skill metadata, content-repo template
// placeholders and shared validators must stay in sync with the contracts doc.
(function checkCommunityPublishing() {
  const skillPath = path.join(root, 'skills/dsh-game-developer/SKILL.md');
  if (fs.existsSync(skillPath)) {
    const skill = fs.readFileSync(skillPath, 'utf8');
    if (!/^---\nname: dsh-game-developer\ndescription: /m.test(skill)) {
      fail('skills/dsh-game-developer/SKILL.md frontmatter must declare name: dsh-game-developer');
    }
    const versionFile = path.join(root, 'skills/dsh-game-developer/VERSION');
    if (!fs.existsSync(versionFile) || !/^\d+\.\d+\.\d+\s*$/.test(fs.readFileSync(versionFile, 'utf8'))) {
      fail('skills/dsh-game-developer/VERSION must be semver');
    }
    for (const file of fs.readdirSync(path.join(root, 'skills/dsh-game-developer')).filter((name) => name.endsWith('.md') || name === 'VERSION')) {
      const text = fs.readFileSync(path.join(root, 'skills/dsh-game-developer', file), 'utf8');
      if (text.includes('/Users/')) fail(`skill file leaks a machine-specific path: ${file}`);
    }
  }
  const lockPath = path.join(root, 'templates/registry/toolchain.lock.json');
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      for (const key of ['platformRepo', 'commit', 'platformVersion', 'generatedAt']) {
        if (typeof lock[key] !== 'string' || lock[key].length === 0) fail(`content registry template toolchain.lock.json missing ${key}`);
      }
      const lockText = fs.readFileSync(lockPath, 'utf8');
      if (!lockText.includes('__PLATFORM_COMMIT__')) fail('content registry template must keep __PLATFORM_COMMIT__ placeholder');
    } catch (error) {
      fail(`content registry template toolchain.lock.json is invalid: ${error.message}`);
    }
  }
  const communityPath = path.join(root, 'packages/shared/src/community.js');
  if (fs.existsSync(communityPath)) {
    const source = fs.readFileSync(communityPath, 'utf8');
    for (const name of ['validateSubmission', 'validateReview', 'validateOwner', 'validateCatalogEntry', 'generateRegistryIndex']) {
      if (!source.includes(`export function ${name}`)) fail(`shared community validator missing ${name}`);
    }
  }
  ok('community publishing artifacts');
})();

// Report
for (const message of checks) console.log(message);
if (problems.length) {
  console.error('\nCHECK FAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`\nCHECK OK (${checks.length} checks${allowMissing ? ', allow-missing' : ''})`);
