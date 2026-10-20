/**
 * Approved media bindings for content-repository catalog records (CR8-02).
 *
 * A reviewer approves a cover and 1–5 screenshots; the digests live in the
 * immutable `reviews/<id>/<version>.json` record, and a catalog release *may*
 * repeat them in its `media` block. Deleting a digest from the catalog must
 * never mean "skip verification": the missing piece is either supplied by the
 * trusted review record (then the bytes are still downloaded and re-hashed) or
 * the release is rejected as unbound.
 *
 * The catalog record itself must always carry `url` + `size`; the `sha256` may
 * come from the review record. This is deliberately asymmetric:
 *   - `url` identifies what is fetched (a review only binds bytes, not URLs);
 *   - `size` has no source in the review schema, so a record without it is
 *     unbound even when the review has a digest;
 *   - `sha256` is the trust anchor and may be recovered from the review.
 *
 * Shared by `validate-catalog` (binding check, no downloads) and
 * `validate-assets` (binding check + real download verification). No file
 * system access here: callers pass the already-loaded review record.
 */
import { downloadVerified, publishError, validateMediaBytes } from './assets.mjs';

/** No approved binding (catalog + review both lack the digest, or size/url missing). */
export const MEDIA_UNBOUND = 'E_PUBLISH_MEDIA_UNBOUND';

const SHA256_RE = /^[a-f0-9]{64}$/;

/** True for a lowercase-hex sha256 digest. */
export function isApprovedDigest(value) {
  return typeof value === 'string' && SHA256_RE.test(value);
}

function bindingError(code, message, details) {
  return publishError(code, message, details);
}

/**
 * Resolve the approved binding of one catalog media asset.
 *
 * @param {{asset: object|undefined, reviewSha256?: string, label: string}} input
 * @returns {{url: string, sha256: string, size: number, type: string|null, digestSource: 'catalog'|'review'}}
 * @throws Error `E_PUBLISH_MEDIA_UNBOUND` when the binding cannot be completed.
 * @throws Error `E_REVIEW_BINDING` when catalog and review digests disagree.
 */
export function resolveMediaBinding({ asset, reviewSha256, label }) {
  const missing = [];
  const url = asset && typeof asset.url === 'string' && asset.url.trim().length > 0
    ? asset.url.trim()
    : null;
  if (!url) missing.push('url');
  const size = asset && Number.isSafeInteger(asset.size) && asset.size >= 1 ? asset.size : null;
  if (size === null) missing.push('size');

  const catalogDigest = asset && isApprovedDigest(asset.sha256) ? asset.sha256 : null;
  const reviewDigest = isApprovedDigest(reviewSha256) ? reviewSha256 : null;
  if (catalogDigest && reviewDigest && catalogDigest !== reviewDigest) {
    throw bindingError(
      'E_REVIEW_BINDING',
      `${label} sha256 does not match the approved review digest`,
      { label, catalog: catalogDigest, review: reviewDigest },
    );
  }
  const sha256 = catalogDigest || reviewDigest;
  if (!sha256) missing.push('sha256');

  if (missing.length > 0) {
    throw bindingError(
      MEDIA_UNBOUND,
      `${label} has no approved media binding (missing ${missing.join(', ')})`,
      { label, missing },
    );
  }
  return {
    url,
    sha256,
    size,
    type: asset && typeof asset.type === 'string' ? asset.type : null,
    digestSource: catalogDigest ? 'catalog' : 'review',
  };
}

/**
 * Resolve a media binding and actually download the bytes, then re-hash and
 * sniff them. A review-supplied digest still requires a real download: the
 * record is not trusted on its own.
 *
 * @returns {Promise<{url:string, sha256:string, size:number, type:string|null, digestSource:string, bytes:number, sniffedType:string}>}
 */
export async function verifyMediaAsset({ asset, reviewSha256, label, http = {} }) {
  const binding = resolveMediaBinding({ asset, reviewSha256, label });
  const downloaded = await downloadVerified(binding.url, binding, http, label);
  const checked = validateMediaBytes({ bytes: downloaded.bytes, media: binding, label });
  return {
    ...binding,
    bytes: downloaded.bytes.length,
    sniffedType: checked.type,
  };
}
