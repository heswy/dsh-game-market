/**
 * `scripts/bundle-lib.mjs` external allowlist tests (V1.5-CONTRACTS §12.4).
 *
 * The bundler may emit `require("<specifier>")` for a small, reviewed set of
 * host platform modules only. These tests are deliberately strict: the exact
 * allowlist is pinned (a future widening fails here and must go through the
 * contract-change process) and every other bare import must still throw.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { EXTERNAL_MODULES, bundleExpression, bundleModuleLoader, collectModules } from '../../../scripts/bundle-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const clientBundlePath = path.join(root, 'client.js');

/** Exact reviewed set from docs/V1.5-CONTRACTS.md §12.4 (must not grow silently). */
const REVIEWED_ALLOWLIST = Object.freeze([
  'react',
  'react-dom/client',
  '@deepseek-ai/dsh-client-ui-primitives',
]);

function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bundle-lib-'));
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, 'utf8');
  }
  return dir;
}

const EXTERNAL_FIXTURE = {
  'entry.js': [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';",
    "import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives';",
    "import { helper } from './helper.js';",
    '',
    'export function main() {',
    '  return [React, createRoot, primitives, FishLogo, helper];',
    '}',
  ].join('\n'),
  'helper.js': "export const helper = 'ok';",
};

function requireCalls(code) {
  const found = [];
  // Accept both quote styles: bundles built before the allowlist refactor used
  // single quotes, and the reproducibility check treats that as a stale build.
  const re = /require\((['"])([^'"]+)\1\)/g;
  let match = re.exec(code);
  while (match !== null) {
    found.push(match[2]);
    match = re.exec(code);
  }
  return found;
}

test('external allowlist is exactly the reviewed minimal set', function () {
  assert.deepEqual([...EXTERNAL_MODULES], REVIEWED_ALLOWLIST);
});

test('allowlisted bare imports bundle as require("<specifier>") and alias correctly', function () {
  const dir = makeFixture(EXTERNAL_FIXTURE);
  try {
    const code = bundleModuleLoader({ entry: 'entry.js', root: dir, id: 'fixture' });
    assert.match(code, /const __external_0 = require\("react"\);/);
    assert.match(code, /const __external_1 = require\("react-dom\/client"\);/);
    assert.match(code, /const __external_2 = require\("@deepseek-ai\/dsh-client-ui-primitives"\);/);
    assert.match(code, /const createRoot = __external_1\.createRoot;/);
    assert.match(code, /const FishLogo = __external_2\.FishLogo;/);
    assert.match(code, /const primitives = __external_2;/);
    assert.match(code, /const React = __external_0;/);
    // One require per distinct specifier per module (the two primitives imports
    // share a single binding), and never any other bare specifier.
    assert.deepEqual(requireCalls(code), REVIEWED_ALLOWLIST);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the bundled external fixture materializes with a require() module loader', function () {
  const dir = makeFixture(EXTERNAL_FIXTURE);
  try {
    const code = bundleModuleLoader({ entry: 'entry.js', root: dir, id: 'fixture' });
    let spec = null;
    const sandbox = {
      window: {
        __ModuleLoader__: {
          load: function load(value) {
            spec = value;
          },
        },
      },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'fixture.js' });
    assert.ok(spec, 'module loader was called');
    assert.equal(spec.id, 'fixture');
    const seen = [];
    const exportsObject = spec.factory(function requireModule(name) {
      seen.push(name);
      return { name: name, createRoot: function createRoot() {}, FishLogo: function FishLogo() {} };
    });
    assert.deepEqual(seen, REVIEWED_ALLOWLIST);
    const values = exportsObject.main();
    assert.equal(values[4], 'ok');
    assert.equal(values[0].name, 'react');
    assert.equal(values[2].name, '@deepseek-ai/dsh-client-ui-primitives');
    assert.equal(typeof values[1], 'function');
    assert.equal(typeof values[3], 'function');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every other bare import still throws (no arbitrary bare imports)', function () {
  for (const specifier of ['left-pad', 'react-dom/server', '@deepseek-ai/dsh-client-ui-dockkit', '@deepseek-ai/dsh-client-store']) {
    const dir = makeFixture({
      'entry.js': [
        `import thing from '${specifier}';`,
        '',
        'export const value = thing;',
      ].join('\n'),
    });
    try {
      assert.throws(
        function bundle() {
          bundleModuleLoader({ entry: 'entry.js', root: dir, id: 'fixture' });
        },
        function matches(error) {
          assert.match(String(error && error.message), new RegExp(`Unsupported bare import "${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
          assert.match(String(error && error.message), /reviewed external allowlist/);
          assert.match(String(error && error.message), /react-dom\/client/);
          assert.match(String(error && error.message), /@deepseek-ai\/dsh-client-ui-primitives/);
          return true;
        }
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('unknown external specifiers cannot be injected through collectModules', function () {
  const dir = makeFixture({
    'entry.js': ["import { x } from 'react';", '', 'export const value = x;'].join('\n'),
  });
  try {
    const collected = collectModules({ entry: 'entry.js', root: dir });
    const entry = collected.modules.get(path.join(dir, 'entry.js'));
    assert.equal(entry.imports[0].target.kind, 'external');
    assert.equal(entry.imports[0].target.specifier, 'react');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('multi-line imports are joined instead of being mis-bundled', function () {
  const dir = makeFixture({
    'entry.js': [
      'import {',
      '  createRoot,',
      '  hydrateRoot',
      "} from 'react-dom/client';",
      "import {",
      "  FishLogo",
      "} from '@deepseek-ai/dsh-client-ui-primitives';",
      '',
      'export function main() {',
      '  return [createRoot, hydrateRoot, FishLogo];',
      '}',
    ].join('\n'),
  });
  try {
    const code = bundleModuleLoader({ entry: 'entry.js', root: dir, id: 'fixture' });
    assert.match(code, /require\("react-dom\/client"\)/);
    assert.match(code, /require\("@deepseek-ai\/dsh-client-ui-primitives"\)/);
    assert.match(code, /const hydrateRoot = __external_0\.hydrateRoot;/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bundleExpression still rejects external imports (games get no host modules)', function () {
  const dir = makeFixture({
    'entry.js': [
      "import { createRoot } from 'react-dom/client';",
      '',
      'export const value = createRoot;',
    ].join('\n'),
  });
  try {
    assert.throws(function bundle() {
      bundleExpression({ entry: 'entry.js', root: dir });
    }, /cannot be used with external imports/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('comment text that looks like an inline manifest script cannot pollute game HTML', function () {
  const dir = makeFixture({
    'entry.js': [
      '/**',
      ' * Reject a second authoritative manifest declaration.',
      ' * An inline <script id="dsh-game-manifest"> is the V1 declaration.',
      ' */',
      'export function check() {',
      "  return 'ok';",
      '}',
    ].join('\n'),
  });
  try {
    const code = bundleExpression({ entry: 'entry.js', root: dir });
    assert.equal(code.includes('<script'), false, 'inlined bundles must not contain a literal <script tag');
    assert.match(code, /&lt;script id="dsh-game-manifest">/);
    // Executable code is unchanged by comment sanitation.
    const value = vm.runInNewContext(code);
    assert.equal(value.check(), 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed client.js only requires allowlisted platform modules', function () {
  assert.ok(fs.existsSync(clientBundlePath), 'client.js is a committed build artifact');
  const code = fs.readFileSync(clientBundlePath, 'utf8');
  assert.ok(code.includes('window.__ModuleLoader__.load'));
  for (const specifier of requireCalls(code)) {
    assert.ok(
      REVIEWED_ALLOWLIST.includes(specifier),
      `client.js requires "${specifier}", which is not in the reviewed allowlist`
    );
  }
  // The Client still gets React from the platform seed table.
  assert.ok(requireCalls(code).includes('react'));
});
