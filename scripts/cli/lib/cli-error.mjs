/**
 * CLI error/exit-code contract (PRD §8.2.8).
 *
 *   0  success
 *   1  validation or compatibility failure (author can fix)
 *   2  usage / configuration error
 *   3  internal error (I/O or unexpected exception)
 *   4  network/Registry error (Host-only in V1; the CLI does not use it)
 */

export const EXIT_CODES = Object.freeze({
  OK: 0,
  INVALID: 1,
  USAGE: 2,
  INTERNAL: 3,
  NETWORK: 4,
});

export class CliError extends Error {
  /**
   * @param {string} message
   * @param {number} exitCode
   * @param {{cause?: unknown, hint?: string, code?: string}} [options]
   */
  constructor(message, exitCode = EXIT_CODES.USAGE, options = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    if (options.cause !== undefined) this.cause = options.cause;
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.code !== undefined) this.code = options.code;
  }
}

/** A validation report (`{ok,errors,warnings,truncated}`) produced by the shared validators. */
export class ValidationFailure extends CliError {
  constructor(report, source) {
    super(`Validation failed: ${report.errors.length} error(s)`, EXIT_CODES.INVALID);
    this.name = 'ValidationFailure';
    this.report = report;
    this.source = source || null;
  }
}

export function usageError(message, hint) {
  return new CliError(message, EXIT_CODES.USAGE, { hint });
}

export function internalError(message, cause) {
  return new CliError(message, EXIT_CODES.INTERNAL, { cause });
}
