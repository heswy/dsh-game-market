import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createFixture, runCli, tempDir } from '../test-support/helpers.mjs';

test('--help, per-command help and --version exit 0', () => {
  const help = runCli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /dsh-game \d+\.\d+\.\d+/);
  assert.match(help.stdout, /build \[project\]/);

  const buildHelp = runCli(['build', '--help']);
  assert.equal(buildHelp.status, 0);
  assert.match(buildHelp.stdout, /Exit codes/);

  const version = runCli(['--version']);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
});

test('unknown commands and missing arguments exit 2', () => {
  const unknown = runCli(['frobnicate']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command/);

  const create = runCli(['create']);
  assert.equal(create.status, 2);
  assert.match(create.stderr, /requires a game id/);

  const validate = runCli(['validate']);
  assert.equal(validate.status, 2);
  assert.match(validate.stderr, /requires a path/);

  const dev = runCli(['dev', '--port', 'not-a-port']);
  assert.equal(dev.status, 2);
  assert.match(dev.stderr, /--port/);
});

test('build on a missing project exits 2', () => {
  const result = runCli(['build', path.join(tempDir(), 'missing')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /does not exist/);
});

test('pack on an invalid html file exits 1 with a report', () => {
  const dir = tempDir();
  const file = path.join(dir, 'broken.html');
  fs.writeFileSync(file, '<!doctype html><html><body>no manifest</body></html>', 'utf8');
  const result = runCli(['pack', file, '--json']);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((item) => item.code === 'E_PKG_MANIFEST_MISSING'));
});

test('validate on a project directory builds in memory and exits 0', () => {
  const dir = createFixture();
  const result = runCli(['validate', dir, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.match(report.source, /built in memory/);
  assert.equal(fs.existsSync(path.join(dir, 'dist')), false);
});

test('--json usage errors stay machine-readable', () => {
  const result = runCli(['validate', '/definitely/not/here.html', '--json']);
  assert.equal(result.status, 2);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, false);
  assert.match(json.error.message, /does not exist/);
});
