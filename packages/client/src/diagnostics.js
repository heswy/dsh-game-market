/**
 * Lightweight in-memory diagnostics. Codes only: never record prompts, tool
 * arguments, file paths, titles or error messages (PRD 8.9 privacy red line).
 */
import { LOG_PREFIX } from '../../shared/src/constants.js';

const MAX_ENTRIES = 100;
const entries = [];
const logged = new Set();

/** Record one diagnostic code; the first occurrence per code also logs once. */
export function reportDiagnostic(code, error) {
  const safeCode = typeof code === 'string' && code.length > 0 ? code.slice(0, 120) : 'unknown';
  const detail = error && typeof error.code === 'string' ? error.code : null;
  entries.push({ code: safeCode, detail: detail, at: Date.now() });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  if (!logged.has(safeCode)) {
    logged.add(safeCode);
    try {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(LOG_PREFIX, safeCode, detail || '');
      }
    } catch (_error) {
      // Logging must never break the UI.
    }
  }
}

/** Snapshot of recorded diagnostics (diagnostics only, no user content). */
export function getDiagnostics() {
  return entries.map(function copy(entry) {
    return { code: entry.code, detail: entry.detail, at: entry.at };
  });
}

/** Test helper: reset the in-memory buffer. */
export function resetDiagnostics() {
  entries.length = 0;
  logged.clear();
}
