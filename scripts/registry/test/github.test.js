import assert from 'node:assert/strict';
import test from 'node:test';

import { createGithub } from '../lib/github.mjs';

function pageRunner(pages) {
  return (args) => {
    const target = args.find((arg) => typeof arg === 'string' && arg.includes('/releases?'));
    if (!target) return { status: 1, stdout: '', stderr: 'unexpected command' };
    const page = Number(new URL(`https://example.com/${target}`).searchParams.get('page') || '1');
    const body = pages[page - 1] || [];
    return { status: 0, stdout: JSON.stringify(body), stderr: '' };
  };
}

test('inspectDraftAsset paginates until the target draft release is found', () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ tag_name: `other-${index}`, assets: [] }));
  const secondPage = [{ tag_name: 'target-tag', draft: true, assets: [{ id: 987654, name: 'game-1.0.0.html', size: 123, state: 'uploaded' }] }];
  const github = createGithub({ repo: 'example/registry', runner: pageRunner([firstPage, secondPage]) });
  const asset = github.inspectDraftAsset('target-tag', 'game-1.0.0.html');
  assert.ok(asset);
  assert.equal(asset.id, 987654);
  assert.equal(asset.name, 'game-1.0.0.html');
  assert.equal(asset.size, 123);
});

test('inspectDraftAsset returns null after a short final page', () => {
  let calls = 0;
  const github = createGithub({
    repo: 'example/registry',
    runner: () => { calls += 1; return { status: 0, stdout: JSON.stringify([{ tag_name: 'other', assets: [] }]), stderr: '' }; },
  });
  assert.equal(github.inspectDraftAsset('missing', 'x.html'), null);
  assert.equal(calls, 1);
});
