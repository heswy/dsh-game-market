import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { buildSkillArchive } from '../pack-skill.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SKILL = path.join(ROOT, 'skills', 'dsh-game-developer');

test('skill has valid frontmatter, version and no placeholder paths', async () => {
  const source = await fs.readFile(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(source, /^---\nname: dsh-game-developer\ndescription: /);
  assert.match(source, /DSH Game Market/);
  assert.equal((await fs.readFile(path.join(SKILL, 'VERSION'), 'utf8')).trim(), '1.0.0');
  const files = ['package-and-sdk.md', 'presentation.md', 'submission.md', 'verification.md'];
  for (const file of files) {
    const body = await fs.readFile(path.join(SKILL, 'references', file), 'utf8');
    assert.ok(body.length > 100, file);
  }
  for (const file of [path.join(SKILL, 'SKILL.md'), ...files.map((f) => path.join(SKILL, 'references', f))]) {
    const body = await fs.readFile(file, 'utf8');
    assert.equal(body.includes('/Users/'), false, `machine-specific path in ${file}`);
    assert.equal(body.includes('TODO'), false, `placeholder in ${file}`);
  }
});

test('skill archive is deterministic and manifest hashes match the archive', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-skill-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const first = await buildSkillArchive();
  const second = await buildSkillArchive();
  assert.equal(first.archive.equals(second.archive), true, 'two archives must be byte-identical');
  assert.match(first.manifest.archive.file, /^dsh-game-developer-1\.0\.0\.tar\.gz$/);
  const tar = gunzipSync(first.archive);
  assert.ok(tar.length > 512);
  const headerName = tar.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  assert.match(headerName, /^dsh-game-developer-1\.0\.0\//);
  assert.ok(first.manifest.files.some((file) => file.path.endsWith('SKILL.md')));
});
