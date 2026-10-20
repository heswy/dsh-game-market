/**
 * Community publishing data contracts (V1.2 MVP / plan 2026-10-19).
 *
 * These are maintainer/content-repository schemas, NOT the runtime game package
 * or Registry schema. The runtime Registry is still generated from `catalog`
 * entries and validated by `registry.js`; never publish author/review metadata
 * into `registry/games.json`.
 *
 * Pure JS (no Node/browser globals), shared by the platform scripts, content
 * repository CI, tests and the developer Skill references.
 */

import { DEFAULT_OFFICIAL_REGISTRY_URL, GAME_ID_PATTERN, LIMITS, PACKAGE_FORMATS } from './constants.js';
import { CATEGORIES, CAPABILITIES, RESERVED_GAME_IDS, isValidVersion } from './manifest.js';
import { SHA256_RE, validateRegistryGame } from './registry.js';
import { packageFileNameForFormat } from './package-v2.js';

export const SUBMISSION_SCHEMA_VERSION = 1;
export const REVIEW_SCHEMA_VERSION = 1;
export const OWNER_SCHEMA_VERSION = 1;
export const CATALOG_SCHEMA_VERSION = 1;
export const SUBMISSION_TYPES = Object.freeze(['new', 'update']);
export const REVIEW_DECISIONS = Object.freeze(['approved', 'rejected']);
export const SAVE_COMPATIBILITY = Object.freeze(['compatible', 'incompatible', 'not-applicable']);
export const MEDIA_TYPES = Object.freeze(['png', 'webp', 'jpeg']);
export { DEFAULT_OFFICIAL_REGISTRY_URL };

const GITHUB_LOGIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const COMMIT_RE = /^[a-f0-9]{7,40}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const HTTPS_RE = /^https:\/\//i;
const TYPE_SET = new Set(MEDIA_TYPES);
const CATEGORY_SET = new Set(CATEGORIES);
const CAPABILITY_SET = new Set(CAPABILITIES);
const RESERVED_SET = new Set(RESERVED_GAME_IDS);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function error(errors, code, field, message) {
  errors.push({ code, field, message });
}

function checkString(errors, value, field, { min = 1, max = 280, pattern, code = 'E_SUBMISSION_FIELD' } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    error(errors, code, field, `${field} must be a string (${min}..${max} chars)`);
    return false;
  }
  if (pattern && !pattern.test(value)) {
    error(errors, code, field, `${field} has an unsupported format`);
    return false;
  }
  return true;
}

function checkHttps(errors, value, field, { max = 500, suffix = null, code = 'E_SUBMISSION_URL' } = {}) {
  if (typeof value !== 'string' || !HTTPS_RE.test(value) || value.length > max) {
    error(errors, code, field, `${field} must be an https URL`);
    return false;
  }
  if (suffix && !value.split('?')[0].endsWith(suffix)) {
    error(errors, code, field, `${field} must end with ${suffix}`);
    return false;
  }
  return true;
}

function checkSha(errors, value, field, code = 'E_SUBMISSION_SHA') {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    error(errors, code, field, `${field} must be 64 lowercase hex characters`);
    return false;
  }
  return true;
}

function checkGithubIdentity(errors, value, field, code = 'E_SUBMISSION_AUTHOR') {
  if (!isPlainObject(value)) {
    error(errors, code, field, `${field} must be an object`);
    return null;
  }
  checkString(errors, value.login, `${field}.login`, { max: 39, pattern: GITHUB_LOGIN_RE, code });
  if (!Number.isSafeInteger(value.githubUserId) || value.githubUserId < 1) {
    error(errors, code, `${field}.githubUserId`, 'githubUserId must be the numeric GitHub user id');
  }
  return value;
}

function checkIso(errors, value, field, code = 'E_SUBMISSION_DATE') {
  if (typeof value !== 'string' || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    error(errors, code, field, `${field} must be an ISO timestamp`);
    return false;
  }
  return true;
}

function checkMedia(errors, value, field, { optional = false } = {}) {
  if (optional && value === undefined) return null;
  if (!isPlainObject(value)) {
    error(errors, 'E_SUBMISSION_MEDIA', field, `${field} must be an object`);
    return null;
  }
  checkHttps(errors, value.url, `${field}.url`, { code: 'E_SUBMISSION_MEDIA' });
  checkSha(errors, value.sha256, `${field}.sha256`, 'E_SUBMISSION_MEDIA');
  if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > LIMITS.previewBytes) {
    error(errors, 'E_SUBMISSION_MEDIA', `${field}.size`, `${field}.size is out of range`);
  }
  if (!TYPE_SET.has(value.type)) {
    error(errors, 'E_SUBMISSION_MEDIA', `${field}.type`, 'type must be png, webp or jpeg');
  }
  return value;
}

function checkSelfTest(errors, value) {
  if (!isPlainObject(value)) {
    error(errors, 'E_SUBMISSION_SELFTEST', 'selfTest', 'selfTest must be an object');
    return;
  }
  const required = [
    'ready', 'pauseResume', 'beforeSave', 'continuePlay', 'keyboard',
    'narrowWindow', 'theme', 'fullBleed', 'safeArea', 'noNetwork',
  ];
  const truthy = ['ready', 'pauseResume', 'beforeSave', 'continuePlay', 'keyboard',
    'narrowWindow', 'theme', 'fullBleed', 'safeArea', 'noNetwork'];
  for (const key of truthy) {
    if (value[key] !== true) {
      error(errors, 'E_SUBMISSION_SELFTEST', `selfTest.${key}`, `selfTest.${key} must be true`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key)) {
      error(errors, 'E_SUBMISSION_UNKNOWN_FIELD', `selfTest.${key}`, `unknown selfTest field: ${key}`);
    }
  }
}

const PENDING_SUBMISSION_FIELDS = Object.freeze([
  'author.login',
  'author.githubUserId',
  'author.sourceRepo',
  'package.url',
  'package.sha256Url',
  'media.cover.url',
  'media.screenshots[0].url',
  'media.screenshots[1].url',
  'media.screenshots[2].url',
  'media.screenshots[3].url',
  'media.screenshots[4].url',
]);

/** Validate one `submission.json` document (author-facing contract). */
export function validateSubmission(input, options = {}) {
  const mode = options.mode === 'draft' ? 'draft' : 'final';
  const errors = [];
  const warnings = [];
  const warningsList = warnings;
  let pending = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: 'E_SUBMISSION_DOCUMENT', field: '$', message: 'submission must be an object' }], warnings, submission: null };
  }
  const submission = input;
  if (submission.schemaVersion !== SUBMISSION_SCHEMA_VERSION) {
    error(errors, 'E_SUBMISSION_SCHEMA', 'schemaVersion', 'schemaVersion must be 1');
  }
  if (!SUBMISSION_TYPES.includes(submission.submissionType)) {
    error(errors, 'E_SUBMISSION_FIELD', 'submissionType', 'submissionType must be new or update');
  }

  const game = submission.game;
  if (!isPlainObject(game)) {
    error(errors, 'E_SUBMISSION_FIELD', 'game', 'game must be an object');
  } else {
    if (typeof game.id !== 'string' || !GAME_ID_PATTERN.test(game.id) || game.id.includes('--')) {
      error(errors, 'E_SUBMISSION_ID', 'game.id', 'game.id must match the package id pattern');
    } else if (RESERVED_SET.has(game.id)) {
      error(errors, 'E_SUBMISSION_ID_RESERVED', 'game.id', `game.id is reserved: ${game.id}`);
    }
    checkString(errors, game.name, 'game.name', { max: 64 });
    if (typeof game.version !== 'string' || !isValidVersion(game.version)) {
      error(errors, 'E_SUBMISSION_VERSION', 'game.version', 'game.version must be a strict semver subset');
    }
    checkString(errors, game.description, 'game.description', { max: 280 });
    if (!Array.isArray(game.categories) || game.categories.length < 1 || game.categories.length > 3) {
      error(errors, 'E_SUBMISSION_FIELD', 'game.categories', 'categories must contain 1..3 categories');
    } else {
      for (const category of game.categories) {
        if (!CATEGORY_SET.has(category)) error(errors, 'E_SUBMISSION_FIELD', 'game.categories', `unknown category: ${category}`);
      }
    }
    if (game.tags !== undefined && (!Array.isArray(game.tags) || game.tags.length > 8)) {
      error(errors, 'E_SUBMISSION_FIELD', 'game.tags', 'tags must be an array of <= 8 items');
    }
    if (!Array.isArray(game.capabilities)) {
      error(errors, 'E_SUBMISSION_FIELD', 'game.capabilities', 'capabilities must be an array');
    } else {
      for (const capability of game.capabilities) {
        if (!CAPABILITY_SET.has(capability)) error(errors, 'E_SUBMISSION_FIELD', 'game.capabilities', `unsupported capability: ${capability}`);
      }
    }
    checkString(errors, game.sdkVersion, 'game.sdkVersion', { max: 64 });
    checkString(errors, game.runtimeVersion, 'game.runtimeVersion', { max: 64 });
    if (game.homepage !== undefined) checkHttps(errors, game.homepage, 'game.homepage');
    if (game.repository !== undefined) checkHttps(errors, game.repository, 'game.repository');
    if (game.license !== undefined) checkString(errors, game.license, 'game.license', { max: 64 });
  }

  if (!isPlainObject(submission.author)) {
    error(errors, 'E_SUBMISSION_AUTHOR', 'author', 'author must be an object');
  } else {
    checkGithubIdentity(errors, submission.author, 'author');
    if (!checkHttps(errors, submission.author.sourceRepo, 'author.sourceRepo')) {
      /* already reported */
    }
    if (typeof submission.author.sourceCommit !== 'string' || !COMMIT_RE.test(submission.author.sourceCommit)) {
      error(errors, 'E_SUBMISSION_AUTHOR', 'author.sourceCommit', 'sourceCommit must be a fixed 7..40 char hex commit');
    }
    checkString(errors, submission.author.buildInstructions, 'author.buildInstructions', { max: 4000 });
    if (submission.author.contact !== undefined) checkString(errors, submission.author.contact, 'author.contact', { max: 200 });
  }

  if (!isPlainObject(submission.package)) {
    error(errors, 'E_SUBMISSION_PACKAGE', 'package', 'package must be an object');
  } else {
    const gameId = isPlainObject(game) ? game.id : '';
    const version = isPlainObject(game) ? game.version : '';
    // V1.5: a submission may carry either format. `format` is optional and
    // defaults to html-v1, so every existing HTML submission keeps validating
    // exactly as before; a resource package declares `format` and is held to
    // that format's file name and size ceiling (docs/V1.5-CONTRACTS.md §1/§3).
    const declaredFormat = submission.package.format;
    const format = declaredFormat === undefined ? 'html-v1' : declaredFormat;
    if (!PACKAGE_FORMATS.includes(format)) {
      error(errors, 'E_SUBMISSION_PACKAGE', 'package.format', 'package.format must be html-v1 or asset-zip-v2');
    } else {
      const hasIds = typeof gameId === 'string' && typeof version === 'string' && gameId.length > 0 && version.length > 0;
      checkHttps(errors, submission.package.url, 'package.url', {
        suffix: hasIds ? packageFileNameForFormat(gameId, version, format) : null,
        code: 'E_SUBMISSION_PACKAGE',
      });
      // The archive digest is the trust anchor for HTML (the file *is* the
      // package); for a resource package the archive digest binds the outer ZIP
      // and `filesDigest` binds the validated inner manifest.
      checkSha(errors, submission.package.sha256, 'package.sha256', 'E_SUBMISSION_PACKAGE');
      checkHttps(errors, submission.package.sha256Url, 'package.sha256Url', { code: 'E_SUBMISSION_PACKAGE' });
      const sizeLimit = format === 'asset-zip-v2' ? LIMITS.zip.zipOuterBytes : LIMITS.packageBytes;
      if (!Number.isSafeInteger(submission.package.size) || submission.package.size < 1 || submission.package.size > sizeLimit) {
        error(errors, 'E_SUBMISSION_PACKAGE', 'package.size', 'package.size is out of range');
      }
      if (submission.package.filesDigest !== undefined) {
        if (format !== 'asset-zip-v2') {
          error(errors, 'E_SUBMISSION_PACKAGE', 'package.filesDigest', 'package.filesDigest is only valid for asset-zip-v2');
        } else if (typeof submission.package.filesDigest !== 'string' || !SHA256_RE.test(submission.package.filesDigest)) {
          error(errors, 'E_SUBMISSION_PACKAGE', 'package.filesDigest', 'package.filesDigest must be 64 lowercase hex characters');
        }
      }
    }
  }

  if (!isPlainObject(submission.media)) {
    error(errors, 'E_SUBMISSION_MEDIA', 'media', 'media must be an object');
  } else {
    checkMedia(errors, submission.media.cover, 'media.cover');
    if (!Array.isArray(submission.media.screenshots) || submission.media.screenshots.length < 1 || submission.media.screenshots.length > 5) {
      error(errors, 'E_SUBMISSION_MEDIA', 'media.screenshots', 'screenshots must contain 1..5 images');
    } else {
      submission.media.screenshots.forEach((shot, index) => checkMedia(errors, shot, `media.screenshots[${index}]`));
    }
  }

  if (!isPlainObject(submission.licensing)) {
    error(errors, 'E_SUBMISSION_LICENSE', 'licensing', 'licensing must be an object');
  } else {
    checkString(errors, submission.licensing.codeLicense, 'licensing.codeLicense', { max: 128 });
    checkString(errors, submission.licensing.assetLicense, 'licensing.assetLicense', { max: 128 });
    if (submission.licensing.archivePermission !== true) {
      error(errors, 'E_SUBMISSION_LICENSE', 'licensing.archivePermission', 'archivePermission must be true');
    }
    if (submission.licensing.notes !== undefined) checkString(errors, submission.licensing.notes, 'licensing.notes', { max: 2000 });
  }

  checkSelfTest(errors, submission.selfTest);

  if (submission.submissionType === 'update') {
    if (!isPlainObject(submission.update)) {
      error(errors, 'E_SUBMISSION_UPDATE', 'update', 'update submissions require an update object');
    } else {
      checkString(errors, submission.update.changelog, 'update.changelog', { max: 2000 });
      if (!SAVE_COMPATIBILITY.includes(submission.update.saveCompatibility)) {
        error(errors, 'E_SUBMISSION_UPDATE', 'update.saveCompatibility', 'saveCompatibility is invalid');
      }
      if (submission.update.breakingChanges !== undefined && typeof submission.update.breakingChanges !== 'string') {
        error(errors, 'E_SUBMISSION_UPDATE', 'update.breakingChanges', 'breakingChanges must be a string');
      }
    }
  }

  let pendingNotes = [];
  if (submission.pending !== undefined) {
    if (!Array.isArray(submission.pending) || submission.pending.length > 32) {
      error(errors, 'E_SUBMISSION_PENDING', 'pending', 'pending must be an array of field paths or notes');
    } else {
      const fields = [];
      for (const entry of submission.pending) {
        const text = String(entry || '').trim();
        if (!text) continue;
        const token = text.split(/[\s(]/)[0];
        if (token === 'media.screenshots[].url') {
          const count = Array.isArray(submission.media && submission.media.screenshots) ? submission.media.screenshots.length : 0;
          for (let index = 0; index < count; index += 1) fields.push(`media.screenshots[${index}].url`);
        } else if (PENDING_SUBMISSION_FIELDS.includes(token)) fields.push(token);
        else if (token.includes('.')) error(errors, 'E_SUBMISSION_PENDING', 'pending', `unsupported pending field: ${token}`);
        else pendingNotes.push(text);
      }
      pending = [...new Set(fields)];
    }
  }
  if (mode === 'final' && (pending.length > 0 || pendingNotes.length > 0)) {
    error(errors, 'E_SUBMISSION_PENDING', 'pending', 'a final submission must resolve every pending remote field');
  }
  const effectiveErrors = mode === 'draft'
    ? errors.filter((item) => !(pending.includes(item.field) && PENDING_SUBMISSION_FIELDS.includes(item.field)))
    : errors;
  return {
    ok: effectiveErrors.length === 0,
    errors: effectiveErrors,
    warnings: warningsList,
    pending,
    pendingNotes,
    mode,
    submission: effectiveErrors.length === 0 ? submission : null,
  };
}

/** Validate an approved review record and bind it to the exact submission bytes. */
export function validateReview(input, options = {}) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: 'E_REVIEW_DOCUMENT', field: '$', message: 'review must be an object' }], review: null };
  }
  const review = input;
  if (review.schemaVersion !== REVIEW_SCHEMA_VERSION) error(errors, 'E_REVIEW_SCHEMA', 'schemaVersion', 'schemaVersion must be 1');
  if (!REVIEW_DECISIONS.includes(review.decision)) error(errors, 'E_REVIEW_DECISION', 'decision', 'decision must be approved or rejected');
  if (review.decision !== 'approved') error(errors, 'E_REVIEW_NOT_APPROVED', 'decision', 'only an approved review can publish');
  checkString(errors, review.gameId, 'gameId', { max: 48 });
  if (typeof review.version !== 'string' || !isValidVersion(review.version)) error(errors, 'E_REVIEW_VERSION', 'version', 'version must be semver');
  checkGithubIdentity(errors, review.reviewer, 'reviewer', 'E_REVIEW_REVIEWER');
  checkIso(errors, review.reviewedAt, 'reviewedAt', 'E_REVIEW_DATE');
  if (typeof review.sourceCommit !== 'string' || !COMMIT_RE.test(review.sourceCommit)) {
    error(errors, 'E_REVIEW_BINDING', 'sourceCommit', 'sourceCommit must be a fixed commit');
  }
  if (!isPlainObject(review.package)) {
    error(errors, 'E_REVIEW_BINDING', 'package', 'package must be an object');
  } else {
    checkSha(errors, review.package.sha256, 'package.sha256', 'E_REVIEW_BINDING');
    if (!Number.isSafeInteger(review.package.size) || review.package.size < 1) {
      error(errors, 'E_REVIEW_BINDING', 'package.size', 'package.size must be a positive integer');
    }
  }
  if (!isPlainObject(review.media)) {
    error(errors, 'E_REVIEW_BINDING', 'media', 'media must be an object');
  } else {
    checkSha(errors, review.media.coverSha256, 'media.coverSha256', 'E_REVIEW_BINDING');
    if (!Array.isArray(review.media.screenshotSha256s) || review.media.screenshotSha256s.length < 1 || review.media.screenshotSha256s.length > 5) {
      error(errors, 'E_REVIEW_BINDING', 'media.screenshotSha256s', 'screenshotSha256s must contain 1..5 hashes');
    } else {
      review.media.screenshotSha256s.forEach((sha, index) => checkSha(errors, sha, `media.screenshotSha256s[${index}]`, 'E_REVIEW_BINDING'));
    }
  }
  if (!Array.isArray(review.testEvidence) || review.testEvidence.length < 1) {
    error(errors, 'E_REVIEW_EVIDENCE', 'testEvidence', 'at least one test evidence item is required');
  }
  if (!isPlainObject(review.source)) {
    error(errors, 'E_REVIEW_SOURCE', 'source', 'source must be an object');
  } else {
    for (const key of ['issueUrl', 'prUrl']) {
      if (review.source[key] !== undefined) checkHttps(errors, review.source[key], `source.${key}`, { code: 'E_REVIEW_SOURCE' });
    }
  }

  const submission = options.submission || null;
  if (submission) {
    if (review.gameId !== submission.game.id) error(errors, 'E_REVIEW_MISMATCH', 'gameId', 'review.gameId does not match submission.game.id');
    if (review.version !== submission.game.version) error(errors, 'E_REVIEW_MISMATCH', 'version', 'review.version does not match submission.game.version');
    if (review.sourceCommit !== submission.author.sourceCommit) error(errors, 'E_REVIEW_MISMATCH', 'sourceCommit', 'review.sourceCommit does not match submission.author.sourceCommit');
    if (isPlainObject(review.package) && review.package.sha256 !== submission.package.sha256) {
      error(errors, 'E_REVIEW_MISMATCH', 'package.sha256', 'review.package.sha256 does not match submission');
    }
    if (isPlainObject(review.package) && review.package.size !== submission.package.size) {
      error(errors, 'E_REVIEW_MISMATCH', 'package.size', 'review.package.size does not match submission');
    }
    if (isPlainObject(review.media) && isPlainObject(submission.media)) {
      if (review.media.coverSha256 !== submission.media.cover.sha256) {
        error(errors, 'E_REVIEW_MISMATCH', 'media.coverSha256', 'review cover hash does not match submission');
      }
      const submitted = submission.media.screenshots.map((shot) => shot.sha256);
      const reviewed = review.media.screenshotSha256s || [];
      if (submitted.length !== reviewed.length || submitted.some((sha, index) => sha !== reviewed[index])) {
        error(errors, 'E_REVIEW_MISMATCH', 'media.screenshotSha256s', 'review screenshot hashes do not match submission');
      }
    }
  }
  return { ok: errors.length === 0, errors, review: errors.length === 0 ? review : null };
}

/** Validate `owners/<id>.json` (stable numeric GitHub identity). */
export function validateOwner(input, options = {}) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: 'E_OWNER_DOCUMENT', field: '$', message: 'owner record must be an object' }], owner: null };
  }
  const record = input;
  if (record.schemaVersion !== OWNER_SCHEMA_VERSION) error(errors, 'E_OWNER_SCHEMA', 'schemaVersion', 'schemaVersion must be 1');
  checkString(errors, record.gameId, 'gameId', { max: 48 });
  if (options.gameId && record.gameId !== options.gameId) error(errors, 'E_OWNER_MISMATCH', 'gameId', 'owner gameId does not match path');
  checkGithubIdentity(errors, record.owner, 'owner', 'E_OWNER_IDENTITY');
  checkIso(errors, record.createdAt, 'createdAt', 'E_OWNER_DATE');
  if (record.updatedAt !== undefined) checkIso(errors, record.updatedAt, 'updatedAt', 'E_OWNER_DATE');
  return { ok: errors.length === 0, errors, owner: errors.length === 0 ? record : null };
}

/** Validate a generated catalog source record (`catalog/<id>.json`). */
export function validateCatalogEntry(input, options = {}) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: 'E_CATALOG_DOCUMENT', field: '$', message: 'catalog entry must be an object' }], entry: null };
  }
  const entry = input;
  if (entry.schemaVersion !== CATALOG_SCHEMA_VERSION) error(errors, 'E_CATALOG_SCHEMA', 'schemaVersion', 'schemaVersion must be 1');
  if (options.gameId && entry.gameId !== options.gameId) error(errors, 'E_CATALOG_MISMATCH', 'gameId', 'catalog gameId does not match path');
  checkString(errors, entry.gameId, 'gameId', { max: 48 });
  if (!isPlainObject(entry.game)) {
    error(errors, 'E_CATALOG_GAME', 'game', 'game must be an object');
  } else {
    checkString(errors, entry.game.name, 'game.name', { max: 64 });
    if (typeof entry.game.version !== 'string' || !isValidVersion(entry.game.version)) error(errors, 'E_CATALOG_GAME', 'game.version', 'version must be semver');
    checkString(errors, entry.game.description, 'game.description', { max: 280 });
    if (!Array.isArray(entry.game.categories) || entry.game.categories.length < 1 || entry.game.categories.length > 3) error(errors, 'E_CATALOG_GAME', 'game.categories', 'categories must contain 1..3 items');
    if (!Array.isArray(entry.game.capabilities)) error(errors, 'E_CATALOG_GAME', 'game.capabilities', 'capabilities must be an array');
    checkString(errors, entry.game.sdkVersion, 'game.sdkVersion', { max: 64 });
    checkString(errors, entry.game.runtimeVersion, 'game.runtimeVersion', { max: 64 });
  }
  if (!isPlainObject(entry.author)) {
    error(errors, 'E_CATALOG_AUTHOR', 'author', 'author must be an object');
  } else {
    checkString(errors, entry.author.name, 'author.name', { max: 64 });
    checkGithubIdentity(errors, entry.author, 'author', 'E_CATALOG_AUTHOR');
  }
  if (!isPlainObject(entry.release)) {
    error(errors, 'E_CATALOG_RELEASE', 'release', 'release must be an object');
  } else {
    checkString(errors, entry.release.tag, 'release.tag', { max: 120 });
    checkIso(errors, entry.release.releasedAt, 'release.releasedAt', 'E_CATALOG_RELEASE');
    checkHttps(errors, entry.release.packageUrl, 'release.packageUrl', { code: 'E_CATALOG_RELEASE' });
    checkSha(errors, entry.release.packageSha256, 'release.packageSha256', 'E_CATALOG_RELEASE');
    if (!Number.isSafeInteger(entry.release.packageSize) || entry.release.packageSize < 1 || entry.release.packageSize > LIMITS.packageBytes) error(errors, 'E_CATALOG_RELEASE', 'release.packageSize', 'packageSize is out of range');
    checkMedia(errors, entry.release.cover, 'release.cover');
    if (!Array.isArray(entry.release.screenshots) || entry.release.screenshots.length < 1 || entry.release.screenshots.length > 5) error(errors, 'E_CATALOG_RELEASE', 'release.screenshots', 'screenshots must contain 1..5 items');
    else entry.release.screenshots.forEach((shot, index) => checkMedia(errors, shot, `release.screenshots[${index}]`));
  }
  if (!isPlainObject(entry.source)) {
    error(errors, 'E_CATALOG_SOURCE', 'source', 'source must be an object');
  } else {
    checkHttps(errors, entry.source.repo, 'source.repo', { code: 'E_CATALOG_SOURCE' });
    if (typeof entry.source.commit !== 'string' || !COMMIT_RE.test(entry.source.commit)) error(errors, 'E_CATALOG_SOURCE', 'source.commit', 'commit must be a fixed hex commit');
  }
  if (!isPlainObject(entry.review)) {
    error(errors, 'E_CATALOG_REVIEW', 'review', 'review must be an object');
  } else {
    checkGithubIdentity(errors, entry.review.reviewer, 'review.reviewer', 'E_CATALOG_REVIEW');
    checkIso(errors, entry.review.reviewedAt, 'review.reviewedAt', 'E_CATALOG_REVIEW');
    checkSha(errors, entry.review.packageSha256, 'review.packageSha256', 'E_CATALOG_REVIEW');
  }
  if (!isPlainObject(entry.selfTest)) error(errors, 'E_CATALOG_SELFTEST', 'selfTest', 'selfTest must be an object');
  if (entry.changelog !== undefined) checkString(errors, entry.changelog, 'changelog', { max: 2000 });
  if (entry.publishedAt !== undefined) checkIso(errors, entry.publishedAt, 'publishedAt', 'E_CATALOG_DATE');
  if (entry.updatedAt !== undefined) checkIso(errors, entry.updatedAt, 'updatedAt', 'E_CATALOG_DATE');
  return { ok: errors.length === 0, errors, entry: errors.length === 0 ? entry : null };
}

/** Build the flat RegistryGame consumed by the Host from a catalog source entry. */
export function registryGameFromCatalog(entry) {
  if (!isPlainObject(entry) || !isPlainObject(entry.game) || !isPlainObject(entry.release)) return null;
  const game = entry.game;
  const release = entry.release;
  const author = entry.author || {};
  return {
    id: entry.gameId,
    name: game.name,
    version: game.version,
    description: game.description,
    author: { name: author.name },
    categories: game.categories,
    tags: Array.isArray(game.tags) ? game.tags : [],
    capabilities: game.capabilities,
    sdkVersion: game.sdkVersion,
    runtimeVersion: game.runtimeVersion,
    ...(game.preferredTheme ? { preferredTheme: game.preferredTheme } : {}),
    package: {
      url: release.packageUrl,
      sha256: release.packageSha256,
      size: release.packageSize,
      releasedAt: release.releasedAt,
    },
    cover: release.cover.url,
    screenshots: release.screenshots.map((shot) => shot.url),
    ...(game.homepage ? { homepage: game.homepage } : {}),
    ...(game.repository ? { repository: game.repository } : {}),
    ...(game.license ? { license: game.license } : {}),
    ...(entry.changelog ? { changelog: entry.changelog } : {}),
    publishedAt: entry.publishedAt || entry.release.releasedAt,
    updatedAt: entry.updatedAt || entry.publishedAt || entry.release.releasedAt,
  };
}

/** Build a catalog source record from an approved submission + release URLs. */
export function catalogEntryFromSubmission(options) {
  const submission = options && options.submission;
  const review = options && options.review;
  const release = options && options.release;
  if (!isPlainObject(submission) || !isPlainObject(review) || !isPlainObject(release)) return null;
  const game = submission.game;
  const media = submission.media;
  const author = submission.author;
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    gameId: game.id,
    game: {
      name: game.name,
      version: game.version,
      description: game.description,
      categories: game.categories.slice(),
      tags: Array.isArray(game.tags) ? game.tags.slice() : [],
      capabilities: game.capabilities.slice(),
      sdkVersion: game.sdkVersion,
      runtimeVersion: game.runtimeVersion,
      ...(game.preferredTheme ? { preferredTheme: game.preferredTheme } : {}),
      ...(game.homepage ? { homepage: game.homepage } : {}),
      ...(game.repository ? { repository: game.repository } : {}),
      ...(game.license ? { license: game.license } : {}),
    },
    author: {
      name: author.login,
      login: author.login,
      githubUserId: author.githubUserId,
    },
    release: {
      tag: release.tag,
      releasedAt: release.releasedAt,
      packageUrl: release.packageUrl,
      packageSha256: release.packageSha256,
      packageSize: release.packageSize,
      cover: { ...release.cover, sha256: media.cover.sha256, size: media.cover.size, type: media.cover.type },
      screenshots: release.screenshots.map((shot, index) => ({
        ...shot,
        sha256: media.screenshots[index].sha256,
        size: media.screenshots[index].size,
        type: media.screenshots[index].type,
      })),
    },
    source: {
      repo: author.sourceRepo,
      commit: author.sourceCommit,
      ...(release.issueUrl ? { issueUrl: release.issueUrl } : {}),
      ...(release.prUrl ? { prUrl: release.prUrl } : {}),
    },
    review: {
      reviewer: { login: review.reviewer.login, githubUserId: review.reviewer.githubUserId },
      reviewedAt: review.reviewedAt,
      packageSha256: review.package.sha256,
    },
    selfTest: { ...submission.selfTest },
    publishedAt: release.releasedAt,
    updatedAt: release.updatedAt || release.releasedAt,
    ...(submission.update && submission.update.changelog ? { changelog: submission.update.changelog } : {}),
  };
}

/** Generate the complete runtime Registry index from catalog source entries. */
export function generateRegistryIndex(entries, options = {}) {
  const errors = [];
  if (!Array.isArray(entries)) {
    return { ok: false, errors: [{ code: 'E_CATALOG_LIST', field: '$', message: 'catalog entries must be an array' }], index: null };
  }
  const games = [];
  const seen = new Set();
  for (const entry of entries) {
    const validation = validateCatalogEntry(entry);
    if (!validation.ok) {
      errors.push(...validation.errors.map((item) => ({ ...item, gameId: entry && entry.gameId })));
      continue;
    }
    if (seen.has(entry.gameId)) {
      errors.push({ code: 'E_CATALOG_DUPLICATE', field: 'gameId', message: `duplicate game id: ${entry.gameId}` });
      continue;
    }
    seen.add(entry.gameId);
    const game = registryGameFromCatalog(entry);
    const registryValidation = validateRegistryGame(game, {
      sourceType: 'https',
      sourceUrl: DEFAULT_OFFICIAL_REGISTRY_URL,
    });
    if (!registryValidation.ok) {
      errors.push(...registryValidation.errors.map((item) => ({ ...item, gameId: entry.gameId })));
      continue;
    }
    games.push(game);
  }
  if (errors.length > 0) return { ok: false, errors, index: null };
  games.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const generatedAt = typeof options.generatedAt === 'string' ? options.generatedAt : null;
  if (generatedAt === null || !ISO_RE.test(generatedAt) || Number.isNaN(Date.parse(generatedAt))) {
    return { ok: false, errors: [{ code: 'E_CATALOG_DATE', field: 'generatedAt', message: 'generatedAt must be an ISO timestamp' }], index: null };
  }
  return {
    ok: true,
    errors: [],
    index: { registryVersion: 1, generatedAt, games },
  };
}

/** True when a review approval binds the exact submission metadata. */
export function reviewBindsSubmission(review, submission) {
  return validateReview(review, { submission }).ok;
}
