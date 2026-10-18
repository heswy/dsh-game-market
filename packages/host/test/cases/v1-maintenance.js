import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createHostHarness } from '../support/harness.js';
import { buildManifest } from '../support/packages.js';

const DAY = 24 * 60 * 60 * 1000;

function stamp(msAgo) {
  return new Date(Date.now() - msAgo).toISOString().replace(/[-:.]/g, '');
}

function makeRecord(id, version, { previousVersion = null, sizeBytes = 10 } = {}) {
  const at = new Date().toISOString();
  return {
    id,
    version,
    source: 'local',
    packagePath: `${id}/${version}`,
    sha256: null,
    sizeBytes,
    previousVersion,
    compatibility: { status: 'ok', checkedAt: at, reasons: [] },
    update: { available: false, latestVersion: version, checkedAt: at, reason: null },
    lastPlayedAt: null,
    playCount: 0,
    totalPlayMinutes: 0,
    installedAt: at,
    updatedAt: at,
    manifest: buildManifest({ id, version }),
  };
}

async function seedInstalledPackages(dataRoot, versions) {
  for (const [id, version] of versions) {
    const directory = path.join(dataRoot, 'packages', id, version);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'entry.html'), '<!doctype html><html><body>seed</body></html>');
  }
}

export function register() {
  test('startup clears staging job dirs and trash older than 7 days', async (t) => {
    const oldTrash = `old-game-${stamp(15 * DAY)}`;
    const newTrash = `new-game-${stamp(0)}`;
    const host = await createHostHarness(t, {
      prepareDataRoot: async (dataRoot) => {
        await fs.mkdir(path.join(dataRoot, 'staging', 'job_0123456789abcdef'), { recursive: true });
        await fs.writeFile(path.join(dataRoot, 'staging', 'job_0123456789abcdef', 'entry.html.part'), 'partial');
        await fs.mkdir(path.join(dataRoot, 'trash', oldTrash), { recursive: true });
        await fs.writeFile(path.join(dataRoot, 'trash', oldTrash, 'entry.html'), 'old');
        await fs.mkdir(path.join(dataRoot, 'trash', newTrash), { recursive: true });
        await fs.writeFile(path.join(dataRoot, 'trash', newTrash, 'entry.html'), 'new');
      },
    });
    await host.host.maintenance.ready();
    assert.deepEqual(await host.listDataFiles('staging'), []);
    assert.deepEqual(await host.listDataFiles('trash'), [newTrash]);
  });

  test('startup removes package directories with no installation record', async (t) => {
    const host = await createHostHarness(t, {
      prepareDataRoot: (dataRoot) => seedInstalledPackages(dataRoot, [['orphan', '1.0.0']]),
    });
    await host.host.maintenance.ready();
    assert.equal(await host.pathExists('packages/orphan'), false);
    // Orphans are soft-deleted into trash and removed after the 7-day window.
    const trash = await host.listDataFiles('trash');
    assert.equal(trash.length, 1);
    assert.ok(trash[0].startsWith('orphan-'));
    assert.equal(await host.pathExists(`trash/${trash[0]}/1.0.0/entry.html`), true);
    assert.equal(await host.pathExists('installations.json'), false);
  });

  test('startup prunes versions outside current+previous and repairs records', async (t) => {
    const host = await createHostHarness(t, {
      prepareDataRoot: async (dataRoot) => {
        await seedInstalledPackages(dataRoot, [
          ['jump', '0.9.0'],
          ['jump', '1.0.0'],
          ['jump', '1.1.0'],
          ['ghost', '1.0.0'],
          ['broken-game', '1.0.0'],
        ]);
        await fs.writeFile(
          path.join(dataRoot, 'installations.json'),
          JSON.stringify(
            {
              schemaVersion: 1,
              updatedAt: new Date().toISOString(),
              games: {
                jump: makeRecord('jump', '1.1.0', { previousVersion: '1.0.0' }),
                ghost: makeRecord('ghost', '1.0.0', { previousVersion: '0.8.0' }),
                'broken-game': makeRecord('broken-game', '1.0.0'),
              },
            },
            null,
            2
          )
        );
        await fs.rm(path.join(dataRoot, 'packages', 'broken-game'), { recursive: true, force: true });
      },
    });
    await host.host.maintenance.ready();
    assert.equal(await host.pathExists('packages/jump/0.9.0'), false);
    assert.equal(await host.pathExists('packages/jump/1.0.0/entry.html'), true);
    assert.equal(await host.pathExists('packages/jump/1.1.0/entry.html'), true);
    assert.equal(await host.pathExists('packages/ghost/1.0.0/entry.html'), true);

    const installations = await host.readDataJson('installations.json');
    assert.equal(installations.games.jump.previousVersion, '1.0.0');
    assert.equal(installations.games.ghost.previousVersion, null);
    assert.equal(installations.games['broken-game'].compatibility.status, 'broken');
    assert.deepEqual(installations.games['broken-game'].compatibility.reasons, ['entry-missing']);
    assert.equal(installations.games.jump.compatibility.status, 'ok');
  });

  test('a fresh storage root is not populated by startup maintenance', async (t) => {
    const host = await createHostHarness(t);
    await host.host.maintenance.ready();
    assert.deepEqual(await host.listDataFiles('.'), []);
  });

  test('startup cleanup is skipped while another install holds the lock', async (t) => {
    const host = await createHostHarness(t, {
      prepareDataRoot: async (dataRoot) => {
        await seedInstalledPackages(dataRoot, [['orphan', '1.0.0']]);
        await fs.mkdir(path.join(dataRoot, 'staging'), { recursive: true });
        await fs.writeFile(
          path.join(dataRoot, 'staging', '.install.lock'),
          JSON.stringify({ pid: process.pid, token: 'held', startedAt: new Date().toISOString() })
        );
      },
    });
    await host.host.maintenance.ready();
    // The lock was fresh, so maintenance left the orphan in place.
    assert.equal(await host.pathExists('packages/orphan/1.0.0'), true);
    assert.ok(
      host.logs.some((entry) => entry.some((part) => String(part).includes('maintenance-skipped')))
    );
  });
}
