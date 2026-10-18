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

// Report
for (const message of checks) console.log(message);
if (problems.length) {
  console.error('\nCHECK FAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`\nCHECK OK (${checks.length} checks${allowMissing ? ', allow-missing' : ''})`);
