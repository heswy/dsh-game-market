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
import { BUNDLE_ID, DESCRIPTOR_FILE, LIMITS } from '../packages/shared/src/constants.js';
import { validateManifest, validatePackageHtml } from '../packages/shared/src/manifest.js';
import {
  checkCssContent,
  checkHtmlContent,
  checkManifestConflict,
  checkPathConflicts,
  fileManifestDigest,
  validateDescriptor,
} from '../packages/shared/src/package-v2.js';

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

// 4. Game packages: `games/<id>/game.json` + a dist tree
//
// Two shapes ship side by side since V1.5 M2:
//   - `html-v1`     : one self-contained `dist/index.html` carrying the inline
//                     manifest (V1 rules, validated exactly as before);
//   - `asset-zip-v2`: a `dist/` *package directory* — `dsh-package.json` with a
//                     sorted file manifest, an external `game.json`, and
//                     external scripts/styles/assets. The directory is what the
//                     Host serves for a builtin asset package, so validating it
//                     here is the same gate an install would apply.
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gamesDir = path.join(root, 'games');
if (!fs.existsSync(gamesDir)) {
  fail('missing games/ directory');
} else {
  for (const entry of fs.readdirSync(gamesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(gamesDir, entry.name);
    const manifestPath = path.join(dir, 'game.json');
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

    const distDir = path.join(dir, 'dist');
    const descriptorPath = path.join(distDir, DESCRIPTOR_FILE);

    if (fs.existsSync(descriptorPath)) {
      // ---------------- asset-zip-v2 package directory ----------------
      const manifestResult = validateManifest(source);
      if (!manifestResult.ok) {
        for (const error of manifestResult.errors.slice(0, 5)) {
          fail(`${relManifest} invalid: ${error.code} ${error.message}`);
        }
        continue;
      }
      let descriptorRaw;
      try {
        descriptorRaw = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
      } catch (error) {
        fail(`games/${entry.name}/dist/${DESCRIPTOR_FILE} invalid JSON: ${error.message}`);
        continue;
      }
      const descriptor = validateDescriptor(descriptorRaw);
      if (!descriptor.ok) {
        fail(`games/${entry.name}/dist/${DESCRIPTOR_FILE} invalid: ${descriptor.code}`);
        continue;
      }
      const distPaths = descriptor.value.files.map((file) => file.path);
      const conflicts = checkPathConflicts(distPaths);
      if (!conflicts.ok) fail(`games/${entry.name}/dist path conflict: ${conflicts.code}`);
      // Every declared file must be on disk with the declared size and hash, and
      // nothing else may be in the tree (the manifest is the whole package).
      let unpacked = 0;
      let treeOk = true;
      for (const file of descriptor.value.files) {
        const filePath = path.join(distDir, file.path);
        if (!fs.existsSync(filePath)) {
          fail(`games/${entry.name}/dist missing declared file: ${file.path}`);
          treeOk = false;
          continue;
        }
        const bytes = fs.readFileSync(filePath);
        unpacked += bytes.length;
        if (bytes.length !== file.size) {
          fail(`games/${entry.name}/dist size mismatch: ${file.path}`);
        }
        if (sha256Hex(bytes) !== file.sha256) {
          fail(`games/${entry.name}/dist sha256 mismatch: ${file.path}`);
        }
      }
      if (!treeOk) continue;
      if (unpacked > LIMITS.zip.zipUnpackedBytes) {
        fail(`games/${entry.name}/dist unpacked size ${unpacked} exceeds limit`);
      }
      // The packaged manifest is authoritative for install/launch: it must agree
      // with the build source, or the game would advertise a different version
      // than the one the Host serves.
      const packagedManifestPath = path.join(distDir, descriptor.value.gameManifest);
      let packaged;
      try {
        packaged = JSON.parse(fs.readFileSync(packagedManifestPath, 'utf8'));
      } catch (error) {
        fail(`games/${entry.name}/dist packaged manifest unreadable: ${error.message}`);
        continue;
      }
      for (const field of ['id', 'version', 'name']) {
        if (packaged[field] !== source[field]) {
          fail(`games/${entry.name}/dist packaged manifest ${field} mismatch`);
        }
      }
      // Static content policy for resource packages: no inline script/style,
      // no event handlers, no javascript: URLs, no external references.
      for (const file of descriptor.value.files) {
        const ext = path.extname(file.path).toLowerCase();
        if (ext !== '.html' && ext !== '.svg' && ext !== '.css') continue;
        const text = fs.readFileSync(path.join(distDir, file.path), 'utf8');
        if (ext === '.css') {
          const css = checkCssContent(text);
          if (!css.ok) fail(`games/${entry.name}/dist/${file.path}: ${css.code}`);
          continue;
        }
        const html = checkHtmlContent(text, { inlineForbidden: true });
        if (!html.ok) fail(`games/${entry.name}/dist/${file.path}: ${html.code}`);
        const conflict = checkManifestConflict(text);
        if (!conflict.ok) fail(`games/${entry.name}/dist/${file.path}: ${conflict.code}`);
      }
      const digest = fileManifestDigest(descriptor.value.files, sha256Hex);
      ok(
        `games/${entry.name}/dist (${descriptor.value.files.length} files, ${unpacked} bytes, `
        + `asset-zip-v2, filesDigest ${digest.slice(0, 12)}…)`,
      );
      continue;
    }

    // ---------------- html-v1 single-file package (unchanged V1 rules) ----------------
    const distPath = path.join(distDir, 'index.html');
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

// V1.5 M0 evidence (CR-P2 follow-up): every evidence file cited from
// docs/verification/v1.5/*.md must exist in a fresh clone, must not be
// swallowed by the global `*.log` ignore rule, and must be tracked by Git.
// A doc that cites a log nobody can open is not evidence.
(function checkV15Evidence() {
  const base = path.join(root, 'docs/verification/v1.5');
  const evidenceRoot = path.join(base, 'raw');
  if (!fs.existsSync(base)) return;
  const docs = fs.readdirSync(base).filter((name) => name.endsWith('.md'));
  const refs = new Set();
  for (const name of docs) {
    const text = fs.readFileSync(path.join(base, name), 'utf8');
    const candidates = [
      ...text.matchAll(/\]\(([^)\s]+)\)/g),
      ...text.matchAll(/`([A-Za-z0-9_./-]+\/[A-Za-z0-9_./-]*\.(?:log|png|json))`/g),
    ].map((match) => match[1]);
    for (const raw of candidates) {
      const cleaned = raw.split('#')[0];
      if (cleaned === '' || /^[a-z]+:/i.test(cleaned)) continue;
      const abs = cleaned.startsWith('docs/') ? path.join(root, cleaned) : path.resolve(base, cleaned);
      // Only evidence artifacts count: prose in these docs also mentions
      // package-relative paths (levels/…, saves/…) that are not evidence files.
      if (!abs.startsWith(`${evidenceRoot}${path.sep}`)) continue;
      if (/\.(log|png|json)$/.test(abs)) refs.add(path.relative(root, abs));
    }
  }
  for (const rel of [...refs].sort()) {
    if (!fs.existsSync(path.join(root, rel))) {
      fail(`V1.5 evidence referenced but missing: ${rel}`);
      continue;
    }
    if (spawnSync('git', ['check-ignore', '-q', rel], { cwd: root }).status === 0) {
      fail(`V1.5 evidence is ignored by Git: ${rel}`);
    }
    if (spawnSync('git', ['ls-files', '--error-unmatch', rel], { cwd: root }).status !== 0) {
      fail(`V1.5 evidence is not tracked by Git: ${rel}`);
    }
  }
  if (refs.size > 0) ok(`V1.5 evidence referenced and tracked (${refs.size} files)`);
})();

// M4 evidence logs referenced by the controlled public-loop report must exist,
// be tracked, and not be swallowed by the global `*.log` ignore rule.
(function checkCommunityM4Evidence() {
  const evidenceDoc = path.join(root, 'docs/verification/community-publishing/m4-public-loop.md');
  if (!fs.existsSync(evidenceDoc)) return;
  const text = fs.readFileSync(evidenceDoc, 'utf8');
  const refs = [...text.matchAll(/`(artifacts\/m4\/[^`]+?\.log)`/g)].map((match) => match[1]);
  const base = path.join(root, 'docs/verification/community-publishing');
  for (const ref of refs) {
    const abs = path.join(base, ref);
    if (!fs.existsSync(abs)) fail(`M4 evidence missing: ${ref}`);
    const rel = path.join('docs/verification/community-publishing', ref);
    const ignored = spawnSync('git', ['check-ignore', '-q', rel], { cwd: root });
    if (ignored.status === 0) fail(`M4 evidence is ignored by Git: ${ref}`);
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', rel], { cwd: root });
    if (tracked.status !== 0) fail(`M4 evidence is not tracked by Git: ${ref}`);
  }
  if (refs.length > 0) ok('community M4 evidence logs tracked');
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

// V1.5 two-generation bundled registry (docs/V1.5-CONTRACTS.md §5).
//
// The seed index now exists twice. They must describe the same three HTML
// releases: if the generations drift, a V1.5 client and a V1 client would
// install different bytes under the same version, which §5.4 forbids.
(function checkBundledRegistryV2() {
  const v1Path = path.join(root, 'registry/games.json');
  const v2Path = path.join(root, 'registry/v2/games.json');
  if (!fs.existsSync(v2Path)) {
    fail('missing bundled v2 registry: registry/v2/games.json (V1.5 ships both generations)');
    return;
  }
  let v1;
  let v2;
  try {
    v1 = JSON.parse(fs.readFileSync(v1Path, 'utf8'));
    v2 = JSON.parse(fs.readFileSync(v2Path, 'utf8'));
  } catch (error) {
    fail(`bundled registry is not valid JSON: ${error.message}`);
    return;
  }
  if (v2.registryVersion !== 2) fail('registry/v2/games.json registryVersion must be 2');
  if (Number.isNaN(Date.parse(v2.generatedAt))) fail('registry/v2/games.json generatedAt must be ISO');
  if (!Array.isArray(v2.games) || v2.games.length !== 3) {
    fail('registry/v2/games.json must contain the three installable first-party games');
    return;
  }
  const v1ById = new Map((v1.games || []).map((game) => [game.id, game]));
  for (const game of v2.games) {
    // The seed only ships HTML: a v2 seed entry without a format is a bug, and a
    // ZIP entry here would need a real registry/packages/<id>-<version>.dshgame.zip.
    if (!game || !game.package || game.package.format !== 'html-v1') {
      fail(`registry/v2/games.json entry must declare package.format html-v1: ${game && game.id}`);
      continue;
    }
    const twin = v1ById.get(game.id);
    if (!twin) {
      fail(`registry/v2/games.json game is missing from the v1 projection: ${game.id}`);
      continue;
    }
    for (const field of ['version', 'sha256', 'size', 'url']) {
      const left = field === 'url' ? twin.package?.url : (field === 'version' ? twin.version : twin.package?.[field]);
      const right = field === 'url' ? game.package?.url : (field === 'version' ? game.version : game.package?.[field]);
      if (left !== right) {
        fail(`bundled registry generations drifted on ${game.id}.${field}`);
      }
    }
    const fileName = `${game.id}-${game.version}.html`;
    if (!String(game.package.url || '').endsWith(fileName)) {
      fail(`registry/v2/games.json package.url must point at ${fileName}`);
    }
    if (game.package.filesDigest !== undefined) {
      fail(`registry/v2/games.json must not declare filesDigest for an html-v1 release: ${game.id}`);
    }
  }
  ok('bundled v2 registry present and consistent with the v1 projection');
})();

// V1.5 runtime dependency governance (docs/V1.5-CONTRACTS.md §2.5).
//
// The archive reader is the project's first runtime dependency, so the
// supply-chain properties asserted here are load-bearing: exact version, no
// install scripts, one import site, and a notices file. They fail with an
// actionable message when dependencies were never installed, because from M1
// on `npm run verify` needs `node_modules`.
(function checkZipDependency() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const declared = pkg.dependencies && pkg.dependencies.yauzl;
  if (declared !== '3.4.0') {
    fail(`package.json must pin dependencies.yauzl to the exact version "3.4.0" (found ${JSON.stringify(declared)})`);
  }
  const modules = path.join(root, 'node_modules');
  const yauzlDir = path.join(modules, 'yauzl');
  if (!fs.existsSync(yauzlDir)) {
    fail(
      'runtime dependencies are not installed: run `npm install` first. '
      + 'asset-zip-v2 needs yauzl@3.4.0 (+ pend@1.2.0), so from V1.5 M1 on '
      + '`npm run verify` requires a node_modules directory.',
    );
    return;
  }
  const expect = { yauzl: '3.4.0', pend: '1.2.0' };
  for (const [name, version] of Object.entries(expect)) {
    const dir = path.join(modules, name);
    const manifestPath = path.join(dir, 'package.json');
    if (!fs.existsSync(manifestPath)) {
      fail(`installed dependency ${name} is missing (expected ${version}); re-run npm install`);
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.version !== version) fail(`dependency ${name} must be exactly ${version} (found ${manifest.version})`);
    for (const script of ['install', 'preinstall', 'postinstall']) {
      if (manifest.scripts && manifest.scripts[script]) fail(`dependency ${name} must not declare a ${script} script`);
    }
    if (manifest.license !== 'MIT') fail(`dependency ${name} must stay MIT licensed`);
  }
  const yauzlManifest = JSON.parse(fs.readFileSync(path.join(modules, 'yauzl/package.json'), 'utf8'));
  const deps = Object.keys(yauzlManifest.dependencies || {});
  if (deps.length !== 1 || deps[0] !== 'pend') {
    fail(`yauzl dependency closure changed (expected only pend, found ${JSON.stringify(deps)})`);
  }

  // Exactly one import site: packages/host/src/zip.js plus its tests.
  const allowed = new Set([
    path.join('packages', 'host', 'src', 'zip.js'),
    path.join('packages', 'host', 'test', 'support', 'zip-fixtures.js'),
    path.join('tests', 'v1.5-zip-policy.test.js'),
  ]);
  const importPattern = /(?:from\s+|require\()\s*['"]yauzl['"]/;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'worktrees'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(?:js|mjs|cjs)$/.test(entry.name)) continue;
      const rel = path.relative(root, full);
      if (allowed.has(rel)) continue;
      if (importPattern.test(fs.readFileSync(full, 'utf8'))) offenders.push(rel);
    }
  };
  walk(root);
  if (offenders.length > 0) {
    fail(`yauzl must only be imported by packages/host/src/zip.js (and its tests); found: ${offenders.join(', ')}`);
  }

  const notices = path.join(root, 'THIRD-PARTY-NOTICES.md');
  if (!fs.existsSync(notices)) {
    fail('THIRD-PARTY-NOTICES.md is required: it must carry the MIT text and copyright line for yauzl and pend');
  } else {
    const text = fs.readFileSync(notices, 'utf8');
    for (const name of ['yauzl', 'pend']) {
      if (!text.includes(name)) fail(`THIRD-PARTY-NOTICES.md must name ${name}`);
    }
    if (!/MIT License/i.test(text)) fail('THIRD-PARTY-NOTICES.md must contain the MIT license text');
  }
  ok('V1.5 archive dependency pinned, auditable and single-site');
})();

// Report
for (const message of checks) console.log(message);
if (problems.length) {
  console.error('\nCHECK FAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`\nCHECK OK (${checks.length} checks${allowMissing ? ', allow-missing' : ''})`);
