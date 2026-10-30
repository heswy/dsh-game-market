/**
 * Portable progress transfer contract (V1.5 M5 save migration).
 *
 * A legal save is capped by `LIMITS.saveTotalBytes` (envelope included, PRD
 * §8.6.5). Its portable form swaps the envelope bookkeeping fields for
 * `format`/`gameVersion`/`sha256`, so it may exceed the save quota by a small
 * fixed amount. Export, the client file picker and `POST /save-import` all use
 * the budgets below; the generic `LIMITS.jsonBodyBytes` request cap stays 1 MiB
 * for every other route.
 *
 * The exported file is the same compact JSON that is sent to the Host. A
 * pretty-printed file can grow far beyond the payload (indentation repeats per
 * nesting level), so formatting would make a file size budget that the import
 * route could never accept.
 */
import { LIMITS } from './constants.js';

export const SAVE_TRANSFER_LIMITS = Object.freeze({
  /** Compact JSON bytes of the portable payload; also the exported file size. */
  payloadBytes: LIMITS.saveTotalBytes + 4 * 1024,
  /** JSON request body for `POST /save-import`: payload + gameId/expectedRevision. */
  requestBytes: LIMITS.saveTotalBytes + 8 * 1024,
});

/** Serialise a portable save exactly as it is written to disk and sent back. */
export function portableSaveFileText(portable) {
  return JSON.stringify(portable);
}
