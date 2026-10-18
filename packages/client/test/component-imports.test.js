/**
 * Regression guard: component modules must import every `catalog.js` helper
 * they call. The M1 Market Hero shipped with `coverTone` used but not imported,
 * which crashed the whole panel (white screen) for any user with a
 * continue-able game. Components cannot be imported here (no `react` dependency
 * in the zero-dependency test environment), so this is a source-level check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = path.resolve(here, '..', 'src');
const componentsDir = path.join(clientSrc, 'components');

function read(file) {
  return readFileSync(file, 'utf8');
}

function catalogExports() {
  const source = read(path.join(clientSrc, 'catalog.js'));
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  return names;
}

function importedFromCatalog(source) {
  const names = new Set();
  const importRe = /import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/catalog\.js['"]/g;
  for (const match of source.matchAll(importRe)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

function locallyDefined(source, name) {
  const re = new RegExp(`(?:function\\s+|(?:const|let|var)\\s+)${name.replace(/[$]/g, '\\$')}\\b`);
  return re.test(source);
}

test('component modules import every catalog helper they call', () => {
  const exports = catalogExports();
  assert.ok(exports.has('coverTone'), 'catalog.js must export coverTone');
  const problems = [];
  for (const file of readdirSync(componentsDir)) {
    if (!file.endsWith('.js')) continue;
    const source = read(path.join(componentsDir, file));
    const imported = importedFromCatalog(source);
    for (const name of exports) {
      const used = new RegExp(`(?<![\\w$.])${name.replace(/[$]/g, '\\$')}\\s*\\(`).test(source);
      if (!used) continue;
      if (imported.has(name)) continue;
      if (locallyDefined(source, name)) continue;
      problems.push(`${file}: uses catalog helper "${name}" without importing it`);
    }
  }
  assert.deepEqual(problems, []);
});

test('Market Hero continue variant uses coverTone from the catalog import', () => {
  const source = read(path.join(componentsDir, 'market-home.js'));
  assert.match(source, /import\s*\{[^}]*\bcoverTone\b[^}]*\}\s*from\s*['"]\.\.\/catalog\.js['"]/);
});
