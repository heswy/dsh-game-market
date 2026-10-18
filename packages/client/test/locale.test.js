import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN, ZH, LOCALE_KEYS, interpolate, makeT, translate } from '../src/locale.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');

const REQUIRED_KEYS = [
  'sidebar.label',
  'panel.title',
  'panel.backToConversation',
  'panel.tab.market',
  'panel.tab.mygames',
  'market.loading',
  'market.error.title',
  'market.empty.all',
  'market.waiting.banner',
  'mygames.empty.title',
  'mygames.action.continue',
  'entry.chip.running.resume',
  'entry.chip.running.choose',
  'entry.chip.resume',
  'entry.chip.waiting',
  'entry.menu.resume',
  'entry.menu.choose',
  'entry.menu.dismiss',
  'entry.toast.dismissed',
  'entry.waiting.title',
  'entry.waiting.action',
  'agent.state.running',
  'agent.state.waiting.approval',
  'agent.state.waiting.question',
  'agent.state.completed',
  'agent.state.error',
  'agent.action.results',
  'agent.action.returnWork',
  'runtime.loading',
  'runtime.loading.slow',
  'runtime.save.saved',
  'runtime.save.saving',
  'runtime.save.failed',
  'runtime.pause.title',
  'runtime.pause.resume',
  'runtime.pause.saveReturn',
  'runtime.pause.exitMarket',
  'runtime.leave.blocked.title',
  'runtime.leave.retry',
  'runtime.leave.stay',
  'runtime.leave.force',
  'runtime.resume.title',
  'runtime.resume.action',
  'runtime.error.noRuntime',
  'runtime.diagnostic',
  'a11y.live.waiting',
  'a11y.live.completed',
];

function sourceFiles() {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.js')) files.push(abs);
    }
  }
  walk(srcRoot);
  return files;
}

test('zh and en dictionaries have exactly the same keys and no empty values', function () {
  const zhKeys = Object.keys(ZH).sort();
  const enKeys = Object.keys(EN).sort();
  assert.deepEqual(zhKeys, enKeys);
  assert.deepEqual(zhKeys, [...LOCALE_KEYS]);
  for (const key of zhKeys) {
    assert.equal(typeof ZH[key], 'string', 'zh ' + key);
    assert.equal(typeof EN[key], 'string', 'en ' + key);
    assert.ok(ZH[key].length > 0, 'zh value for ' + key);
    assert.ok(EN[key].length > 0, 'en value for ' + key);
  }
});

test('required UI keys exist in both dictionaries', function () {
  for (const key of REQUIRED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(ZH, key), 'missing zh ' + key);
    assert.ok(Object.prototype.hasOwnProperty.call(EN, key), 'missing en ' + key);
  }
});

test('every static t() key used in source exists in the dictionary', function () {
  const used = new Set();
  for (const file of sourceFiles()) {
    if (file.endsWith('locale.js')) continue;
    const source = fs.readFileSync(file, 'utf8');
    const pattern = /(?:^|[^A-Za-z0-9_$])t\('([^']+)'/g;
    let match = pattern.exec(source);
    while (match) {
      used.add(match[1]);
      match = pattern.exec(source);
    }
  }
  assert.ok(used.size > 40, 'expected many localized keys, saw ' + used.size);
  for (const key of used) {
    assert.ok(Object.prototype.hasOwnProperty.call(ZH, key), 'source uses missing zh key ' + key);
    assert.ok(Object.prototype.hasOwnProperty.call(EN, key), 'source uses missing en key ' + key);
  }
});

const V1_MARKET_KEYS = [
  'market.title',
  'market.tab.market',
  'market.tab.mygames',
  'market.section.continue',
  'market.section.quick',
  'market.section.popular',
  'market.section.new',
  'market.section.all',
  'market.hero.empty.title',
  'market.hero.continue',
  'market.search.placeholder',
  'market.search.empty',
  'market.search.results',
  'market.filter.all',
  'market.category.arcade',
  'market.category.sandbox',
  'market.offline',
  'market.empty.all',
  'market.localInstall',
  'market.localInstall.title',
  'mygames.empty.title',
  'mygames.progress.score',
  'mygames.best',
  'mygames.update.available',
  'mygames.uninstall.title',
  'mygames.uninstall.deleteData',
  'mygames.uninstall.confirmDelete',
  'mygames.deleteData.title',
  'mygames.deleteData.confirm',
  'mygames.menu.restart',
  'detail.action.install',
  'detail.action.cancelInstall',
  'detail.action.continue',
  'detail.action.update',
  'detail.action.incompatible',
  'detail.action.reinstall',
  'detail.install.stage.downloading',
  'detail.install.stage.verifying',
  'detail.install.stage.installing',
  'detail.install.failed.download',
  'detail.permissions.storageScore',
  'detail.permissions.note',
  'detail.error.missing',
  'detail.leaderboard.title',
  'error.gm.installBusy',
  'error.gm.notSelfContained',
  'error.gm.integrity',
  'a11y.installed',
  'a11y.updateAvailable',
  'a11y.installProgress',
  'toast.installed',
  'toast.uninstalled',
];

test('V1 Market, detail and error copy exists in both dictionaries', function () {
  for (const key of V1_MARKET_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(ZH, key), 'missing zh ' + key);
    assert.ok(Object.prototype.hasOwnProperty.call(EN, key), 'missing en ' + key);
  }
  assert.equal(ZH['market.title'], 'Game Market', 'brand name stays untranslated');
  assert.equal(EN['market.title'], 'Game Market', 'brand name stays untranslated');
});

test('locale switching returns the matching Market copy', function () {
  assert.equal(translate('zh', 'market.section.quick'), '快速一局');
  assert.equal(translate('en', 'market.section.quick'), 'Quick play');
  assert.equal(translate('zh', 'mygames.uninstall.confirm'), '卸载');
  assert.equal(translate('en', 'mygames.uninstall.confirm'), 'Uninstall');
  assert.equal(translate('zh', 'detail.install.stage.downloading', { percent: 42 }), '下载中 42%');
  assert.equal(translate('en', 'detail.install.stage.downloading', { percent: 42 }), 'Downloading 42%');
  assert.equal(translate('zh', 'error.gm.installBusy').length > 0, true);
  assert.equal(translate('en', 'error.gm.installBusy').length > 0, true);
});

test('interpolation and translate fallbacks are safe', function () {
  assert.equal(interpolate('Hello {name}!', { name: 'DSH' }), 'Hello DSH!');
  assert.equal(interpolate('Hello {name}!', {}), 'Hello {name}!');
  assert.equal(translate('zh', 'agent.state.completed'), '任务完成啦');
  assert.equal(translate('en', 'agent.state.completed'), 'Task complete');
  assert.equal(translate('zh', 'missing.key'), 'missing.key');
  assert.equal(
    makeT(function broken() {
      throw new Error('locale seat unavailable');
    }, 'zh')('entry.chip.waiting'),
    'Agent 在等你 · 去看看'
  );
  assert.equal(
    makeT(function rawKey(key) {
      return key;
    }, 'en')('entry.chip.waiting'),
    'Agent needs you · Take a look'
  );
});

test('user-facing Chinese exists only in the locale module', function () {
  const offenders = [];
  for (const file of sourceFiles()) {
    if (file.endsWith('/locale.js')) continue;
    const source = fs.readFileSync(file, 'utf8');
    source.split('\n').forEach(function check(line, index) {
      if (/[\u4e00-\u9fff]/.test(line)) offenders.push(path.relative(srcRoot, file) + ':' + (index + 1));
    });
  }
  assert.deepEqual(offenders, []);
});

test('browser source keeps the zero-dependency import rules', function () {
  const files = sourceFiles();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/\bimport\s*\(/.test(source), false, 'dynamic import in ' + file);
    assert.equal(source.includes('document.body.appendChild'), false, 'body append in ' + file);
    assert.equal(source.includes('@deepseek-ai/'), false, 'host package import in ' + file);
    const lines = source.split('\n');
    for (const line of lines) {
      if (!line.startsWith('import ')) continue;
      const match = /^import\s+.+?\s+from\s+['"]([^'"]+)['"];?$/.exec(line.trim());
      assert.ok(match, 'single-line import in ' + file + ': ' + line);
      const specifier = match[1];
      if (specifier === 'react') continue;
      assert.ok(specifier.startsWith('.'), 'bare import ' + specifier + ' in ' + file);
      assert.ok(specifier.endsWith('.js'), 'missing .js in ' + specifier + ' in ' + file);
      const resolved = path.resolve(path.dirname(file), specifier);
      assert.ok(fs.existsSync(resolved), 'unresolved import ' + specifier + ' in ' + file);
    }
  }
});
