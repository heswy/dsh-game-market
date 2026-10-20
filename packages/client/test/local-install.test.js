/**
 * Local package picker policy (V1.5-CONTRACTS §1.8): HTML and .dshgame.zip are
 * both accepted; format comes from the file name/extension, never from sniffing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCAL_INSTALL_ACCEPT,
  MAX_LOCAL_INSTALL_BYTES,
  detectLocalInstallFormat,
  findLocalOverwriteTarget,
  parseLocalPackageFileName,
  validateLocalInstallSelection,
} from '../src/local-install.js';

test('file picker accepts both carriers by extension and MIME', function () {
  assert.ok(LOCAL_INSTALL_ACCEPT.includes('.html'));
  assert.ok(LOCAL_INSTALL_ACCEPT.includes('.dshgame.zip'));
  assert.ok(LOCAL_INSTALL_ACCEPT.includes('text/html'));
  assert.ok(LOCAL_INSTALL_ACCEPT.includes('application/zip'));
  assert.ok(LOCAL_INSTALL_ACCEPT.includes('application/x-zip-compressed'));
});

test('format is decided by file name extension first (host filename rule)', function () {
  assert.equal(detectLocalInstallFormat({ fileName: 'orbit-1.0.0.dshgame.zip' }), 'asset-zip-v2');
  assert.equal(detectLocalInstallFormat({ fileName: 'ORBIT-1.0.0.DSHGAME.ZIP' }), 'asset-zip-v2');
  assert.equal(detectLocalInstallFormat({ fileName: 'snake-1.0.0.html' }), 'html-v1');
  assert.equal(detectLocalInstallFormat({ fileName: 'snake.htm' }), 'html-v1');
  // Extension wins over a wrong/empty browser MIME.
  assert.equal(
    detectLocalInstallFormat({ fileName: 'orbit-1.0.0.dshgame.zip', type: 'text/html' }),
    'asset-zip-v2'
  );
  assert.equal(detectLocalInstallFormat({ fileName: 'snake-1.0.0.html', type: 'application/octet-stream' }), 'html-v1');
});

test('MIME type is a fallback only when the name has no known extension', function () {
  assert.equal(detectLocalInstallFormat({ fileName: 'download', type: 'application/zip' }), 'asset-zip-v2');
  assert.equal(detectLocalInstallFormat({ fileName: 'download', type: 'application/x-zip-compressed' }), 'asset-zip-v2');
  assert.equal(detectLocalInstallFormat({ fileName: 'download', type: 'text/html; charset=utf-8' }), 'html-v1');
  assert.equal(detectLocalInstallFormat({ fileName: 'download', type: 'application/octet-stream' }), null);
  assert.equal(detectLocalInstallFormat({}), null);
});

test('selection validation rejects unsupported and oversized files', function () {
  assert.deepEqual(validateLocalInstallSelection({ fileName: 'orbit-1.0.0.dshgame.zip', size: 2384 }), {
    ok: true,
    format: 'asset-zip-v2',
  });
  assert.deepEqual(validateLocalInstallSelection({ fileName: 'snake-1.0.0.html', size: 100 }), {
    ok: true,
    format: 'html-v1',
  });
  assert.deepEqual(validateLocalInstallSelection({ fileName: 'notes.txt', size: 10 }), {
    ok: false,
    reason: 'unsupported',
  });
  assert.deepEqual(validateLocalInstallSelection({ fileName: 'orbit-1.0.0.dshgame.zip', size: MAX_LOCAL_INSTALL_BYTES + 1 }), {
    ok: false,
    reason: 'tooLarge',
  });
  // .html above the same limit is rejected too (no per-format relaxation).
  assert.equal(
    validateLocalInstallSelection({ fileName: 'snake-1.0.0.html', size: MAX_LOCAL_INSTALL_BYTES + 1 }).ok,
    false
  );
});

test('package file names parse to id/version/format for the confirmation dialog', function () {
  assert.deepEqual(parseLocalPackageFileName('orbit-courier-1.2.3.dshgame.zip'), {
    gameId: 'orbit-courier',
    version: '1.2.3',
    format: 'asset-zip-v2',
  });
  assert.deepEqual(parseLocalPackageFileName('snake-1.0.0.html'), {
    gameId: 'snake',
    version: '1.0.0',
    format: 'html-v1',
  });
  assert.equal(parseLocalPackageFileName('game.html'), null);
  assert.equal(parseLocalPackageFileName('Bad_ID-1.0.0.html'), null);
  assert.equal(parseLocalPackageFileName('mine-1.0.zip'), null);
  assert.equal(parseLocalPackageFileName(''), null);
});

test('overwrite target only names installed, non-builtin games', function () {
  const games = [
    { id: 'snake', name: 'Snake', version: '1.0.0', installed: true, builtin: true },
    { id: 'orbit-courier', name: 'Orbit Courier', version: '1.1.0', installed: true, builtin: false },
    { id: 'jump', name: 'Jump', version: '1.0.0', installed: false },
  ];
  assert.deepEqual(findLocalOverwriteTarget(games, 'orbit-courier-1.2.3.dshgame.zip'), {
    gameId: 'orbit-courier',
    gameName: 'Orbit Courier',
    currentVersion: '1.1.0',
    version: '1.2.3',
  });
  // Builtin games are not replaced by a local install.
  assert.equal(findLocalOverwriteTarget(games, 'snake-1.0.0.html'), null);
  // Not installed -> nothing is replaced.
  assert.equal(findLocalOverwriteTarget(games, 'jump-1.1.0.dshgame.zip'), null);
  // Unknown / unparseable names carry no overwrite hint.
  assert.equal(findLocalOverwriteTarget(games, 'mystery-file.zip'), null);
  assert.equal(findLocalOverwriteTarget(null, 'orbit-courier-1.2.3.dshgame.zip'), null);
});
