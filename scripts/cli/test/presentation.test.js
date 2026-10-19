import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '../../../templates/vanilla/src/render.js';

function renderAt(width, height) {
  const text = [];
  const context = new Proxy({
    measureText: (value) => ({ width: String(value).length * 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillText: (value, x, y) => text.push({ value, x, y }),
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const canvas = { getContext: () => context, getBoundingClientRect: () => ({ width, height }) };
  const renderer = createRenderer(canvas);
  renderer.resize();
  renderer.draw({
    state: { score: 0, lives: 3, elapsed: 0, stars: [], basket: 0.5 },
    phase: 'playing', best: null, i18n: { t: (key) => key },
  });
  return { size: renderer.getSize(), text };
}

test('reference HUD stays below the platform top safety band at every viewport size', () => {
  for (const [width, height] of [[960, 540], [640, 480], [375, 360]]) {
    const { text } = renderAt(width, height);
    assert.equal(text.length, 8);
    assert.ok(text.every((item) => item.y - 12 >= 112), `HUD must clear top 112px at ${width}x${height}`);
    assert.ok(text.every((item) => item.x >= 0 && item.x < width));
  }
});

test('reference canvas uses measured size instead of stretching a minimum logical viewport', () => {
  const { size } = renderAt(280, 220);
  assert.equal(size.width, 280);
  assert.equal(size.height, 220);
});
