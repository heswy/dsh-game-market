/**
 * Storage/score wire-shape helpers.
 *
 * The DSH host returns **envelopes**, not bare payloads (V1 contract §8.3):
 *
 *   storage.load(key)  -> { key, data, revision, updatedAt } | null
 *   storage.save(key)  -> { key, bytes, revision, updatedAt }
 *   score.getBest()    -> { score, achievedAt, meta } | null
 *   score.submit()     -> { best: number|null, isBest, submittedAt }
 *
 * The game only ever deals with the payload inside `data` (and with a numeric
 * best score), so every read goes through these helpers. They also accept a
 * bare payload/legacy shape so offline previews and older adapters keep working.
 */

/** True for a host storage envelope `{ key, data, revision, updatedAt }`. */
export function isStorageEnvelope(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'data')
    && typeof value.key === 'string'
    && (Number.isInteger(value.revision) || typeof value.updatedAt === 'string');
}

/** Unwrap `storage.load(key)` to the stored payload (or pass a bare payload through). */
export function unwrapStorageValue(loaded) {
  if (loaded === null || loaded === undefined) return null;
  if (isStorageEnvelope(loaded)) return loaded.data === undefined ? null : loaded.data;
  return loaded;
}

/** Numeric best score from `score.getBest()` / `score.submit()` shapes. */
export function bestScoreOf(best) {
  if (typeof best === 'number') return Number.isFinite(best) ? Math.max(0, Math.floor(best)) : 0;
  if (!best || typeof best !== 'object') return 0;
  const candidates = [best.score, best.value, best.best];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return Math.max(0, Math.floor(candidate));
    if (candidate && typeof candidate === 'object' && typeof candidate.value === 'number' && Number.isFinite(candidate.value)) {
      return Math.max(0, Math.floor(candidate.value));
    }
  }
  return 0;
}
