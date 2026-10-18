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
import { checkSelfContained } from '../packages/shared/src/manifest.js';

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

// 4. Snake entry
const gameManifestPath = requiredFile('games/snake/game.json');
if (gameManifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(gameManifestPath, 'utf8'));
    for (const field of ['manifestVersion', 'id', 'name', 'version', 'entry']) {
      if (manifest[field] === undefined) fail(`games/snake/game.json missing field: ${field}`);
    }
    if (manifest.id !== 'snake') fail('games/snake/game.json id must be "snake"');
    if (manifest.entry !== 'dist/index.html') fail('games/snake/game.json entry must be "dist/index.html"');
    ok('games/snake/game.json');
  } catch (error) {
    fail(`games/snake/game.json invalid: ${error.message}`);
  }
}

const entryAbs = path.join(root, 'games/snake/dist/index.html');
if (fs.existsSync(entryAbs)) {
  const html = fs.readFileSync(entryAbs, 'utf8');
  for (const violation of checkSelfContained(html)) {
    fail(`snake entry is not self-contained: ${violation.message}`);
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > LIMITS.entryBytes) fail(`snake entry too large: ${bytes} > ${LIMITS.entryBytes}`);
  ok(`games/snake/dist/index.html (${bytes} bytes, self-contained)`);
} else {
  requiredFile('games/snake/dist/index.html');
}

// 5. Required module entry points (strict mode only)
if (!allowMissing) {
  requiredFile('packages/host/src/plugin.js');
  requiredFile('packages/client/src/main.js');
  requiredFile('packages/runtime/src/index.js');
  requiredFile('packages/sdk/src/sdk.js');
  // V1 contract modules (M0): manifest/single-file package, Registry, install layout.
  requiredFile('packages/shared/src/manifest.js');
  requiredFile('packages/shared/src/registry.js');
  requiredFile('packages/shared/src/installation.js');
}

function manifestVersionSafe() {
  try {
    return JSON.parse(fs.readFileSync(gameManifestPath, 'utf8')).version || '';
  } catch (_error) {
    return '';
  }
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
