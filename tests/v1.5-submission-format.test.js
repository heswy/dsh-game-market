/**
 * V1.5 submission format contract (M2).
 *
 * `validateSubmission` used to accept only `<id>-<version>.html`. M2 ships the
 * ZIP publish chain, so a submission must be able to declare
 * `package.format: 'asset-zip-v2'` and be held to that format's file name, size
 * ceiling and digest fields — while every existing HTML submission keeps
 * validating exactly as before.
 *
 * This lives outside the registry tooling on purpose: the validator is part of
 * `packages/shared/src/community.js`, which both the author CLI and the
 * maintainer tools import.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { LIMITS } from '../packages/shared/src/constants.js';
import { validateSubmission } from '../packages/shared/src/community.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.join(here, '..', 'templates/registry/examples/submission-zip.example.json');

function zipSubmission() {
  return JSON.parse(fs.readFileSync(examplePath, 'utf8'));
}

function htmlSubmission() {
  const submission = zipSubmission();
  const id = submission.game.id;
  const version = submission.game.version;
  submission.package = {
    url: submission.package.url.replace(`${id}-${version}.dshgame.zip`, `${id}-${version}.html`),
    sha256: submission.package.sha256,
    sha256Url: submission.package.sha256Url,
    size: submission.package.size,
  };
  return submission;
}

test('the shipped ZIP submission example validates', () => {
  const result = validateSubmission(zipSubmission());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('an HTML submission without a format field still validates (no regression)', () => {
  const submission = htmlSubmission();
  assert.equal('format' in submission.package, false);
  const result = validateSubmission(submission);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('the archive name must match the declared format', () => {
  const wrongZip = zipSubmission();
  wrongZip.package.url = wrongZip.package.url.replace('.dshgame.zip', '.html');
  const zipResult = validateSubmission(wrongZip);
  assert.equal(zipResult.ok, false);
  assert.ok(zipResult.errors.some((item) => item.field === 'package.url'));

  const wrongHtml = htmlSubmission();
  wrongHtml.package.format = 'asset-zip-v2';
  const htmlResult = validateSubmission(wrongHtml);
  assert.equal(htmlResult.ok, false);
  assert.ok(htmlResult.errors.some((item) => item.field === 'package.url'));
});

test('unknown formats are rejected instead of silently treated as HTML', () => {
  const submission = zipSubmission();
  submission.package.format = 'zip-v9';
  const result = validateSubmission(submission);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.field === 'package.format'));
});

test('filesDigest is optional for a resource package and invalid for html-v1', () => {
  const zip = zipSubmission();
  assert.equal(validateSubmission(zip).ok, true);

  const withoutDigest = zipSubmission();
  delete withoutDigest.package.filesDigest;
  assert.equal(validateSubmission(withoutDigest).ok, true, 'prepare measures the digest itself');

  const malformed = zipSubmission();
  malformed.package.filesDigest = 'not-a-digest';
  assert.equal(validateSubmission(malformed).ok, false);

  const htmlWithDigest = htmlSubmission();
  htmlWithDigest.package.filesDigest = 'a'.repeat(64);
  const result = validateSubmission(htmlWithDigest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.field === 'package.filesDigest'));
});

test('the size ceiling follows the declared format', () => {
  // Above the HTML single-file ceiling but below the archive ceiling: valid only
  // as a resource package.
  const between = LIMITS.packageBytes + 1;
  const zip = zipSubmission();
  zip.package.size = Math.min(between, LIMITS.zip.zipOuterBytes);
  if (zip.package.size > LIMITS.packageBytes) {
    assert.equal(validateSubmission(zip).ok, true);
    const html = htmlSubmission();
    html.package.size = zip.package.size;
    assert.equal(validateSubmission(html).ok, false);
  }
  const tooBig = zipSubmission();
  tooBig.package.size = LIMITS.zip.zipOuterBytes + 1;
  assert.equal(validateSubmission(tooBig).ok, false);
});
