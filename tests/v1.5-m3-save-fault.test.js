import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { blockGameSaveWrites, restoreGameSaveWrites } from '../scripts/verification/v1.5/m3/save-fault.mjs';

test('M3 save fault blocks atomic writes inside existing game directories and restores their modes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dgm-save-fault-'));
  const dir = path.join(home, 'storages/dsh-game-market/saves/snake');
  let fault;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    fs.writeFileSync(path.join(dir, 'current.json'), 'old');
    fault = blockGameSaveWrites(home, ['snake', 'orbit-courier']);
    assert.throws(() => fs.writeFileSync(path.join(dir, 'current.json.tmp'), 'new'), error => ['EACCES', 'EPERM'].includes(error.code));
    assert.equal(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'), 'old');
    restoreGameSaveWrites(fault);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o750);
    fs.writeFileSync(path.join(dir, 'current.json.tmp'), 'new');
    fs.renameSync(path.join(dir, 'current.json.tmp'), path.join(dir, 'current.json'));
    assert.equal(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'), 'new');
  } finally {
    if (fault) restoreGameSaveWrites(fault);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
