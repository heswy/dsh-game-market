import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLocale, ZH, EN } from '../src/locale.js';
import { formatRelativeTime } from '../src/format.js';

const NOW = Date.parse('2026-10-19T06:00:00Z');
test('the host UI language takes precedence over the browser language for metadata', () => {
  assert.equal(detectLocale((key) => ZH[key]), 'zh');
  assert.equal(detectLocale((key) => EN[key]), 'en');
});
test('fresh metadata uses a quiet just-now label in the selected language', () => {
  assert.equal(formatRelativeTime('2026-10-19T05:59:37Z', NOW, 'zh'), '刚刚');
  assert.equal(formatRelativeTime('2026-10-19T05:59:37Z', NOW, 'en'), 'just now');
  assert.match(formatRelativeTime('2026-10-19T04:00:00Z', NOW, 'zh'), /2.*小时/);
  assert.equal(formatRelativeTime('invalid', NOW, 'zh'), '');
});
