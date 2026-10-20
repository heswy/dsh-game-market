import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { buildSkillArchive } from '../pack-skill.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SKILL = path.join(ROOT, 'skills', 'dsh-game-developer');

// The Skill ships to outside authors and is versioned independently of the
// platform, so this test pins the *shape* of the version (semver) and the
// consistency between VERSION, the archive name and the tar header — not one
// literal, which would only force a test edit on every Skill release.
async function readSkillVersion() {
  const version = (await fs.readFile(path.join(SKILL, 'VERSION'), 'utf8')).trim();
  assert.match(version, /^\d+\.\d+\.\d+$/, 'skill VERSION must be semver');
  return version;
}

test('skill has valid frontmatter, version and no placeholder paths', async () => {
  const source = await fs.readFile(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(source, /^---\nname: dsh-game-developer\ndescription: /);
  assert.match(source, /DSH Game Market/);
  const version = await readSkillVersion();
  // M2: the Skill gained dual-format coverage and must advertise at least 1.1.0.
  assert.ok(
    Number(version.split('.')[0]) > 1 || Number(version.split('.')[1]) >= 1,
    `skill VERSION must be >= 1.1.0 after the M2 dual-format update (found ${version})`,
  );
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
  const version = await readSkillVersion();
  const escaped = version.replace(/\./g, '\\.');
  assert.match(first.manifest.archive.file, new RegExp(`^dsh-game-developer-${escaped}\\.tar\\.gz$`));
  const tar = gunzipSync(first.archive);
  assert.ok(tar.length > 512);
  const headerName = tar.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  assert.match(headerName, new RegExp(`^dsh-game-developer-${escaped}/`));
  assert.ok(first.manifest.files.some((file) => file.path.endsWith('SKILL.md')));
});
