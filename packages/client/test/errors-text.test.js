import test from 'node:test';
import assert from 'node:assert/strict';
import { GM } from '../../shared/src/errors.js';
import {
  errorTextKey,
  installFailureReasonKey,
  installFailureStage,
  installStageTextKey,
  isBusyError,
  isInstallRetryable,
  isOfflineError,
  updateActionErrorKey,
} from '../src/errors-text.js';
import { EN, ZH } from '../src/locale.js';

test('every GM code maps to an existing bilingual message key', function () {
  const codes = Object.values(GM);
  assert.ok(codes.length > 40);
  for (const code of codes) {
    const key = errorTextKey(code);
    assert.ok(Object.prototype.hasOwnProperty.call(ZH, key), 'missing zh ' + key + ' for ' + code);
    assert.ok(Object.prototype.hasOwnProperty.call(EN, key), 'missing en ' + key + ' for ' + code);
    assert.notEqual(ZH[key], key, 'untranslated zh ' + code);
  }
});

test('unknown and field-level manifest codes degrade safely', function () {
  assert.equal(errorTextKey('GM-9999'), 'error.gm.unknown');
  assert.equal(errorTextKey('not-a-code'), 'error.gm.badRequest');
  assert.equal(errorTextKey(undefined), 'error.gm.unknown');
  assert.equal(errorTextKey('GM-4231'), 'error.gm.manifest');
  assert.equal(errorTextKey('GM-4248'), 'error.gm.manifest');
  assert.equal(errorTextKey('GM-4228'), 'error.gm.manifest');
});

test('install failure stages group the PRD copy correctly', function () {
  assert.equal(installFailureStage(GM.INSTALL_DOWNLOAD_FAILED), 'download');
  assert.equal(installFailureStage(GM.INSTALL_DOWNLOAD_TIMEOUT), 'download');
  assert.equal(installFailureStage(GM.HOST_UNAVAILABLE), 'download');
  assert.equal(installFailureStage(GM.INSTALL_HASH_MISMATCH), 'verify');
  assert.equal(installFailureStage(GM.INSTALL_CORRUPT), 'verify');
  assert.equal(installFailureStage(GM.MANIFEST_INVALID), 'verify');
  assert.equal(installFailureStage(GM.INSTALL_IO), 'write');
  assert.equal(installFailureStage(GM.INSTALL_DISK_FULL), 'write');
  assert.equal(installFailureStage(GM.INVALID_PARAM), 'unknown');
  assert.equal(installFailureReasonKey(GM.INSTALL_DOWNLOAD_FAILED), 'detail.install.failed.download');
  assert.equal(installFailureReasonKey(GM.INSTALL_CORRUPT), 'detail.install.failed.verify');
  assert.equal(installFailureReasonKey(GM.INSTALL_IO), 'detail.install.failed.write');
  assert.equal(installFailureReasonKey(GM.INVALID_PARAM), 'detail.install.failed.unknown');
});

test('stage labels cover every visible install stage', function () {
  assert.equal(installStageTextKey('queued'), 'detail.install.stage.queued');
  assert.equal(installStageTextKey('downloading', 42), 'detail.install.stage.downloading');
  assert.equal(installStageTextKey('downloading', null), 'detail.install.stage.downloadingUnknown');
  assert.equal(installStageTextKey('verifying'), 'detail.install.stage.verifying');
  assert.equal(installStageTextKey('installing'), 'detail.install.stage.installing');
  assert.equal(installStageTextKey('installed'), 'detail.install.stage.installed');
  assert.equal(installStageTextKey('failed'), 'detail.install.stage.failed');
  assert.equal(installStageTextKey('cancelled'), 'detail.install.stage.cancelled');
  assert.equal(installStageTextKey('unknown-ish'), 'detail.install.stage.preparing');
});

test('offline, busy and retryable classifications', function () {
  assert.equal(isOfflineError(GM.HOST_UNAVAILABLE), true);
  assert.equal(isOfflineError(GM.REGISTRY_UNAVAILABLE), true);
  assert.equal(isOfflineError(GM.INSTALL_IO), false);
  assert.equal(isBusyError(GM.INSTALL_IN_PROGRESS), true);
  assert.equal(isBusyError(GM.UNINSTALL_BUSY), true);
  assert.equal(isBusyError(GM.BACKPRESSURE), true);
  assert.equal(isBusyError(GM.INSTALL_DOWNLOAD_FAILED), false);
  assert.equal(isInstallRetryable(GM.INSTALL_IN_PROGRESS), true);
  assert.equal(isInstallRetryable(GM.INSTALL_DOWNLOAD_FAILED), false);
});

test('the GM mapping table never leaks the raw diagnostic message', function () {
  for (const code of Object.values(GM)) {
    const key = errorTextKey(code);
    assert.equal(typeof ZH[key], 'string');
    assert.equal(/GM-\d{4}/.test(ZH[key]), false, 'raw code in zh copy for ' + code);
    assert.equal(/GM-\d{4}/.test(EN[key]), false, 'raw code in en copy for ' + code);
  }
});


test('GM-4091 copy is context-aware: plugin update vs ordinary game-install busy', function () {
  // Game install/uninstall/launch-adjacent toast surfaces use the generic key.
  assert.equal(errorTextKey(GM.INSTALL_IN_PROGRESS), 'error.gm.installBusy');
  // Platform-update surfaces (begin/observe/cancel action errors) must not
  // reuse the game-install sentence.
  assert.equal(updateActionErrorKey(GM.INSTALL_IN_PROGRESS), 'update.error.inProgress');
  assert.notEqual(updateActionErrorKey(GM.INSTALL_IN_PROGRESS), errorTextKey(GM.INSTALL_IN_PROGRESS));

  const installZh = ZH['error.gm.installBusy'];
  const updateZh = ZH['update.error.inProgress'];
  assert.match(installZh, /游戏安装/);
  assert.match(updateZh, /插件更新/);
  assert.notEqual(installZh, updateZh);

  const installEn = EN['error.gm.installBusy'];
  const updateEn = EN['update.error.inProgress'];
  assert.match(installEn, /game install/i);
  assert.match(updateEn, /plugin update/i);
  assert.notEqual(installEn, updateEn);
});
