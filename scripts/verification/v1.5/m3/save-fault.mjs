/** Real filesystem fault for isolated M3 save-coordination verification. */
import fs from 'node:fs';
import path from 'node:path';

export function blockGameSaveWrites(home, gameIds) {
  const root = path.join(home, 'storages', 'dsh-game-market', 'saves');
  const modes = [];
  try {
    for (const gameId of gameIds) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(gameId)) throw new Error('invalid test game id');
      const dir = path.join(root, gameId);
      fs.mkdirSync(dir, { recursive: true });
      const mode = fs.statSync(dir).mode & 0o777;
      modes.push({ dir, mode });
      fs.chmodSync(dir, 0o555);
      // Verify the real write boundary, rather than assuming chmod worked.
      const probe = path.join(dir, '.m3-write-probe');
      try {
        fs.writeFileSync(probe, 'probe', { flag: 'wx' });
        fs.unlinkSync(probe);
        throw new Error('save fault is ineffective: game directory remains writable');
      } catch (error) {
        if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
      }
    }
    return { modes, blocked: true };
  } catch (error) {
    restoreGameSaveWrites({ modes });
    throw error;
  }
}

export function restoreGameSaveWrites(fault) {
  for (const { dir, mode } of fault?.modes ?? []) fs.chmodSync(dir, mode);
  return { restored: true };
}
