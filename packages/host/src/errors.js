/**
 * Host-side error helpers.
 *
 * Only `GM-*` codes may cross the API boundary (PRD §8.13 / D-030). Internal
 * `E_*` names are not used here; the two storage codes below are defined by the
 * PRD (§8.13.4) but are not yet exported by `packages/shared/src/errors.js`, so
 * they are declared locally without modifying the shared contract.
 */

import { GM, defaultMessageFor, isGmCode, makeGameError } from '../../shared/src/errors.js';

/** PRD §8.13.4 / E_STORE_IO — storage read/write failed. */
export const GM_STORE_IO = 'GM-5024';
/** PRD §8.13.4 / E_STORE_READONLY — storage root is not writable. */
export const GM_STORE_READONLY = 'GM-5025';

/** An error that is safe to translate into a public GM response. */
export class HostError extends Error {
  /**
   * @param {string} code GM code
   * @param {string} [message] English diagnostic (not user-facing copy)
   * @param {{retryable?: boolean, details?: object, cause?: unknown}} [options]
   */
  constructor(code, message, options = {}) {
    const gmCode = isGmCode(code) ? code : GM.INTERNAL;
    super(message || defaultMessageFor(gmCode));
    this.name = 'HostError';
    this.code = gmCode;
    this.retryable = options.retryable === true;
    if (options.details !== undefined) this.details = options.details;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function hostError(code, message, options) {
  return new HostError(code, message, options);
}

export function isHostError(error) {
  return error instanceof HostError;
}

/** Map any thrown value to the public `{code, message, retryable, details?}` shape. */
export function toGameError(error) {
  if (error instanceof HostError) {
    return makeGameError(error.code, error.message, {
      retryable: error.retryable,
      details: error.details,
    });
  }
  // Plain protocol errors from shared helpers are already public-safe.
  if (
    error !== null &&
    typeof error === 'object' &&
    typeof error.code === 'string' &&
    isGmCode(error.code)
  ) {
    return makeGameError(error.code, typeof error.message === 'string' ? error.message : undefined, {
      retryable: error.retryable === true,
      details: error.details,
    });
  }
  return makeGameError(GM.INTERNAL);
}

export function statusForError(error) {
  return statusForGm(error instanceof HostError ? error.code : toGameError(error).code);
}

/**
 * HTTP status for a GM code, per PRD §8.5.
 *
 * Kept local (rather than delegating to `shared/errors.js#httpStatusFor`) because
 * the Host owns a few documented exceptions, e.g. disk-full GM-4142 is 413 even
 * though its code lives in the 414x band. The V1.5 bands below mirror
 * `shared/errors.js#httpStatusFor` so both layers agree.
 */
export function statusForGm(code) {
  const text = String(code);
  if (!isGmCode(text)) return 500;
  const numeric = Number(text.slice(3));
  // V1.5 resource credentials: decided before the numeric bands because 4011
  // and 4013 would otherwise fall through to 500. S-A1 measured 403 for an
  // expired/released instance and 410 for a replayed launch URL
  // (docs/V1.5-CONTRACTS.md §7.2/§7.3).
  if (text === GM.RESOURCE_CREDENTIAL_EXPIRED) return 403;
  if (text === GM.ENTRY_LAUNCH_CONSUMED) return 410;
  if (text === GM.RESOURCE_CREDENTIAL_INVALID) return 401;
  if (text === GM.ENTRY_CREDENTIAL_CONSUMED) return 401;
  // V1.5 archive/descriptor/catalog/inline semantics are all 422 (§8.1/§8.3).
  if (numeric >= 4270 && numeric < 4290) return 422;
  // V1.5 update observation timeout is documented as 504 (contract §8.3).
  if (text === GM.UPDATE_OBSERVE_TIMEOUT) return 504;
  if (numeric >= 5030 && numeric < 6000) return 503;
  if (numeric >= 5000) return 500;
  if (numeric >= 4290 && numeric < 4300) return 429;
  if (numeric >= 4260 && numeric < 4270) return 409;
  // GM-422x (package) and GM-423x/GM-424x (manifest fields) are all 422.
  if (numeric >= 4220 && numeric < 4250) return 422;
  if (numeric >= 4150 && numeric < 4160) return 415;
  if (numeric >= 4130 && numeric < 4140) return 413;
  // Disk-full is documented as 413 even though its code lives in GM-414x.
  if (numeric === 4142) return 413;
  if (numeric >= 4090 && numeric < 4100) return 409;
  if (numeric >= 4040 && numeric < 4050) return 404;
  if (numeric >= 4030 && numeric < 4040) return 403;
  if (numeric >= 4000 && numeric < 4010) return 400;
  return 500;
}
