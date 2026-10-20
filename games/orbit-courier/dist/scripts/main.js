/**
 * Orbit Courier bootstrap.
 *
 * Loads the level document from the package (`levels/shift-01.json`, relative
 * same-origin fetch), picks the platform SDK when embedded in the DSH Runtime or
 * the offline adapter when opened standalone (local preview/screenshots), then
 * hands control to the game shell.
 */

import { game as platformSdk } from './vendor/dsh-sdk.js';
import { createOfflineAdapter } from './offline.js';
import { boot } from './game.js';

export const LEVEL_URL = 'levels/shift-01.json';

async function loadLevel() {
  const response = await fetch(LEVEL_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`level request failed: ${response.status}`);
  const level = await response.json();
  if (!level || level.schemaVersion !== 1) throw new Error('level schema mismatch');
  return level;
}

function createPlatformAdapter(sdk) {
  return {
    mode: 'platform',
    runtime: sdk.runtime,
    async ready() {
      await sdk.ready();
      return sdk.runtime;
    },
    storage: sdk.storage,
    score: sdk.score,
    session: sdk.session,
    lifecycle: sdk.lifecycle,
    onFatal(handler) {
      return sdk.onError(handler);
    },
  };
}

function showBootError(documentRef, error) {
  const overlay = documentRef.getElementById('overlay');
  const title = documentRef.getElementById('overlay-title');
  const body = documentRef.getElementById('overlay-body');
  if (!overlay) return;
  overlay.hidden = false;
  if (title) title.textContent = '无法开始这一班';
  if (body) {
    body.textContent = '';
    const paragraph = documentRef.createElement('p');
    paragraph.className = 'lead';
    paragraph.textContent = `关卡数据加载失败：${error && error.message ? error.message : 'unknown error'}`;
    body.appendChild(paragraph);
  }
}

export async function main(documentRef = document) {
  const embedded = Boolean(window.parent && window.parent !== window);
  const canvas = documentRef.getElementById('stage');
  if (!canvas) return null;
  const level = await loadLevel();
  const adapter = embedded ? createPlatformAdapter(platformSdk) : createOfflineAdapter();
  if (embedded) await adapter.ready();
  const instance = boot({ adapter, level, canvas, document: documentRef });
  await instance.start();
  window.__orbitCourier = instance;
  return instance;
}

main().catch((error) => {
  showBootError(document, error);
});
