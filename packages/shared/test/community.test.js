import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CATALOG_SCHEMA_VERSION,
  OWNER_SCHEMA_VERSION,
  REVIEW_SCHEMA_VERSION,
  SUBMISSION_SCHEMA_VERSION,
  catalogEntryFromSubmission,
  generateRegistryIndex,
  validateCatalogEntry,
  validateOwner,
  validateReview,
  validateSubmission,
} from '../src/community.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

export function validSubmission(overrides = {}) {
  return {
    schemaVersion: SUBMISSION_SCHEMA_VERSION,
    submissionType: 'new',
    game: {
      id: 'orbit-catch',
      name: 'Orbit Catch',
      version: '1.0.0',
      description: 'A tiny arcade game.',
      categories: ['arcade'],
      tags: ['space'],
      capabilities: ['storage', 'score'],
      sdkVersion: '^1.0.0',
      runtimeVersion: '^1.0.0',
      repository: 'https://github.com/example/orbit-catch',
      license: 'MIT',
    },
    author: {
      login: 'example',
      githubUserId: 123456,
      contact: 'dev@example.com',
      sourceRepo: 'https://github.com/example/orbit-catch',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      buildInstructions: 'npm run build',
    },
    package: {
      url: 'https://github.com/example/orbit-catch/releases/download/orbit-catch-v1.0.0/orbit-catch-1.0.0.html',
      sha256: SHA_A,
      sha256Url: 'https://github.com/example/orbit-catch/releases/download/orbit-catch-v1.0.0/orbit-catch-1.0.0.html.sha256',
      size: 120000,
    },
    media: {
      cover: { url: 'https://example.com/cover.png', sha256: SHA_B, size: 50000, type: 'png' },
      screenshots: [{ url: 'https://example.com/shot.png', sha256: SHA_C, size: 40000, type: 'png' }],
    },
    licensing: {
      codeLicense: 'MIT',
      assetLicense: 'CC-BY-4.0',
      archivePermission: true,
    },
    selfTest: {
      ready: true,
      pauseResume: true,
      beforeSave: true,
      continuePlay: true,
      keyboard: true,
      narrowWindow: true,
      theme: true,
      fullBleed: true,
      safeArea: true,
      noNetwork: true,
    },
    ...overrides,
  };
}

export function validReview(overrides = {}) {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    gameId: 'orbit-catch',
    version: '1.0.0',
    decision: 'approved',
    reviewer: { login: 'maintainer', githubUserId: 654321 },
    reviewedAt: '2026-10-19T12:00:00.000Z',
    source: { issueUrl: 'https://github.com/heswy/dsh-game-registry/issues/1' },
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    package: { sha256: SHA_A, size: 120000 },
    media: { coverSha256: SHA_B, screenshotSha256s: [SHA_C] },
    testEvidence: [{ kind: 'manual', note: 'played 5 minutes', url: 'https://example.com/evidence' }],
    ...overrides,
  };
}

test('valid submission/review/owner round-trips', () => {
  const submission = validSubmission();
  const submissionResult = validateSubmission(submission);
  assert.equal(submissionResult.ok, true, JSON.stringify(submissionResult.errors));

  const review = validReview();
  const reviewResult = validateReview(review, { submission });
  assert.equal(reviewResult.ok, true, JSON.stringify(reviewResult.errors));

  const ownerResult = validateOwner(
    {
      schemaVersion: OWNER_SCHEMA_VERSION,
      gameId: 'orbit-catch',
      owner: { login: 'example', githubUserId: 123456 },
      createdAt: '2026-10-19T12:00:00.000Z',
    },
    { gameId: 'orbit-catch' }
  );
  assert.equal(ownerResult.ok, true, JSON.stringify(ownerResult.errors));
});

test('submission reports field-level missing/invalid data', () => {
  const missing = validSubmission();
  delete missing.package.sha256Url;
  missing.selfTest.noNetwork = false;
  missing.author.sourceCommit = 'main';
  const result = validateSubmission(missing);
  assert.equal(result.ok, false);
  const fields = new Set(result.errors.map((item) => item.field));
  assert.ok(fields.has('package.sha256Url'));
  assert.ok(fields.has('selfTest.noNetwork'));
  assert.ok(fields.has('author.sourceCommit'));

  const badName = validSubmission();
  badName.package.url = 'https://example.com/not-the-game.html';
  assert.equal(validateSubmission(badName).ok, false);
});

test('review cannot bind a changed package or media', () => {
  const submission = validSubmission();
  const changedPackage = validReview({ package: { sha256: SHA_D, size: 120000 } });
  const result = validateReview(changedPackage, { submission });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.field === 'package.sha256'));

  const changedMedia = validReview({ media: { coverSha256: SHA_D, screenshotSha256s: [SHA_C] } });
  assert.equal(validateReview(changedMedia, { submission }).ok, false);
});

test('rejected review cannot publish', () => {
  const result = validateReview(validReview({ decision: 'rejected' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'E_REVIEW_NOT_APPROVED'));
});

test('catalog generation produces a strict registry index sorted by id', () => {
  const submission = validSubmission();
  const review = validReview();
  const entry = catalogEntryFromSubmission({
    submission,
    review,
    release: {
      tag: 'orbit-catch-v1.0.0',
      releasedAt: '2026-10-19T12:00:00.000Z',
      packageUrl: submission.package.url,
      packageSha256: SHA_A,
      packageSize: 120000,
      cover: { url: submission.media.cover.url },
      screenshots: [{ url: submission.media.screenshots[0].url }],
    },
  });
  assert.equal(validateCatalogEntry(entry).ok, true, JSON.stringify(validateCatalogEntry(entry).errors));
  const generated = generateRegistryIndex([entry], { generatedAt: '2026-10-19T12:00:00.000Z' });
  assert.equal(generated.ok, true, JSON.stringify(generated.errors));
  assert.equal(generated.index.registryVersion, 1);
  assert.equal(generated.index.games[0].id, 'orbit-catch');
  assert.equal(generated.index.games[0].package.sha256, SHA_A);
});

test('catalog rejects missing/illegal fields and malformed index', () => {
  assert.equal(validateCatalogEntry({ schemaVersion: CATALOG_SCHEMA_VERSION, gameId: 'x' }).ok, false);
  const generated = generateRegistryIndex([], { generatedAt: 'not-a-date' });
  assert.equal(generated.ok, false);
  assert.ok(generated.errors.some((item) => item.field === 'generatedAt'));
});
