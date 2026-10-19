#!/usr/bin/env node
/**
 * Tiny assertion collector for verification scripts (CR-08).
 *
 * A script must fail loudly (non-zero exit) when a measured expectation is not
 * met; collecting every check first keeps the evidence report complete.
 */
export function createChecker(label) {
  const checks = [];
  const failures = [];
  return {
    check(name, ok, details) {
      const entry = { name, ok: ok === true, ...(details === undefined ? {} : { details }) };
      checks.push(entry);
      if (!entry.ok) {
        failures.push(entry);
        console.error(`[FAIL] ${label}: ${name}${details === undefined ? '' : ` ${JSON.stringify(details)}`}`);
      }
      return entry.ok;
    },
    equal(name, actual, expected) {
      return this.check(name, actual === expected, { actual, expected });
    },
    checked(name, value) {
      return this.check(name, value !== null && value !== undefined && value !== false, value);
    },
    get checks() {
      return checks;
    },
    get failures() {
      return failures;
    },
    get ok() {
      return failures.length === 0;
    },
    finish(extra = {}) {
      const report = { ...extra, ok: this.ok, checks, failures };
      if (!this.ok) console.error(`[FAIL] ${label}: ${failures.length} assertion(s) failed`);
      return report;
    },
    exitCode() {
      return this.ok ? 0 : 1;
    },
  };
}
