/**
 * Error type shared by the maintainer release tooling.
 *
 * Every failure carries a stable `E_RELEASE_*` code plus an actionable
 * `guidance` line, so a dry-run failure tells the maintainer exactly which
 * precondition is missing and what to do (never "something went wrong").
 */
export class ReleaseError extends Error {
  /**
   * @param {string} code stable `E_RELEASE_*` code
   * @param {string} message one-line description of the violated rule
   * @param {{guidance?: string, details?: unknown}} [options]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'ReleaseError';
    this.code = code;
    this.guidance = options.guidance;
    this.details = options.details;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {{guidance?: string, details?: unknown}} [options]
 */
export function fail(code, message, options = {}) {
  throw new ReleaseError(code, message, options);
}

/** Serialise arbitrary thrown values into the tool's JSON error envelope. */
export function errorPayload(error) {
  if (error instanceof ReleaseError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.guidance === undefined ? {} : { guidance: error.guidance }),
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    ok: false,
    code: 'E_RELEASE_INTERNAL',
    message: error && error.message ? error.message : String(error),
  };
}
