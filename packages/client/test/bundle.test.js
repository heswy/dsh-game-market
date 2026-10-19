import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.resolve(here, '..', '..', '..', 'client.js');

function loadBundle() {
  const code = fs.readFileSync(bundlePath, 'utf8');
  let spec = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: function load(value) {
          spec = value;
        },
      },
    },
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    URLSearchParams: URLSearchParams,
    AbortSignal: AbortSignal,
    TextEncoder: TextEncoder,
    crypto: globalThis.crypto,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'client.js' });
  return spec;
}

function fakeReact() {
  return {
    createElement: function createElement(type) {
      return { type: type, children: Array.prototype.slice.call(arguments, 2) };
    },
    Fragment: 'fragment',
  };
}

test('built client.js is a DSH module-loader bundle with the right id', function () {
  assert.ok(fs.existsSync(bundlePath), 'run node scripts/build-client.mjs first');
  const code = fs.readFileSync(bundlePath, 'utf8');
  assert.ok(code.includes('window.__ModuleLoader__.load'));
  assert.ok(code.includes('id: "dsh-game-market"'));
  assert.ok(code.includes('factory: function (require)'));
  assert.equal(code.includes('export default'), false);
});

test('bundle materializes with only react and exports inject/apply', function () {
  const spec = loadBundle();
  assert.equal(spec.id, 'dsh-game-market');
  const exportsObject = spec.factory(function requireModule(name) {
    if (name === 'react') return fakeReact();
    throw new Error('unexpected require: ' + name);
  });
  assert.equal(JSON.stringify(exportsObject.inject), JSON.stringify(['slots', 'layout', 'locale']));
  assert.equal(typeof exportsObject.apply, 'function');
});

test('apply registers locale, main panel, sidebar row and header chip inside effects', function () {
  const spec = loadBundle();
  const exportsObject = spec.factory(function requireModule(name) {
    if (name === 'react') return fakeReact();
    throw new Error('unexpected require: ' + name);
  });

  const effects = [];
  const registered = [];
  const injected = [];
  let localeCall = null;
  const layoutCalls = [];
  const ctx = {
    locale: {
      register: function register(ns, dictionaries) {
        localeCall = { ns: ns, zh: dictionaries.zh, en: dictionaries.en };
        return function disposeLocale() {};
      },
      bind: function bind(ns) {
        return function translate(key) {
          return ns === 'dshGameMarket' && key === 'sidebar.label' ? 'Game Market' : key;
        };
      },
    },
    layout: {
      selectPanel: function selectPanel(id) {
        layoutCalls.push(id);
      },
    },
    slots: {
      inject: function inject(slotName, callback) {
        injected.push(slotName);
        return callback();
      },
      register: function register(options, component) {
        registered.push({ options: options, component: component });
        return function dispose() {};
      },
    },
    effect: function effect(callback) {
      const disposer = callback();
      effects.push(disposer);
      return disposer;
    },
  };
  exportsObject.apply(ctx);
  assert.equal(localeCall.ns, 'dshGameMarket');
  assert.ok(localeCall.zh['entry.chip.waiting']);
  assert.ok(localeCall.en['entry.chip.waiting']);
  assert.deepEqual(injected, ['main', 'sidebar.panellist', 'conversation.view']);
  assert.equal(registered.length, 3);
  assert.equal(registered[0].options.name, 'main');
  assert.equal(registered[0].options.key, 'dsh-game-market');
  assert.equal(registered[0].options.locale, 'dshGameMarket');
  assert.equal(registered[1].options.name, 'sidebar.panellist');
  assert.equal(registered[1].options.id, 'dsh-game-market');
  assert.equal(registered[1].options.order, 40);
  assert.equal(registered[2].options.name, 'conversation.view');
  assert.equal(registered[2].options.id, 'game');
  assert.equal(registered[2].options.order, 100);
  // The Game tab owns the runtime-status badge now; its label is a component
  // element, not a static string (sidebar carries no state).
  assert.equal(typeof registered[2].options.label, 'function');
  const tabLabel = registered[2].options.label();
  assert.equal(typeof tabLabel, 'object');
  assert.equal(typeof tabLabel.type, 'function');
  assert.equal(typeof registered[1].options.label, 'function');
  assert.equal(registered[1].options.label(), 'Game Market');
  assert.ok(effects.length >= 3);
});
