/**
 * Identifier helpers. Only `node:crypto` is used; no third-party dependency.
 */

import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

/** Lowercase hex string with `byteLength` random bytes. */
export function randomHex(byteLength = 16) {
  const length = Number.isSafeInteger(byteLength) && byteLength > 0 ? byteLength : 16;
  return nodeRandomBytes(length).toString('hex');
}

/** `req_` + 16 lowercase hex (PRD §8.1). */
export function createRequestId() {
  return `req_${randomHex(8)}`;
}

/** `ps_` + 24 lowercase hex (PRD §8.1). */
export function createPlaySessionId() {
  return `ps_${randomHex(12)}`;
}

/** 32 lowercase hex (PRD §8.1). */
export function createInstanceId() {
  return randomHex(16);
}

/** 32 lowercase hex (PRD §8.1). */
export function createNonce() {
  return randomHex(16);
}

/** `job_` + 16 lowercase hex (V1-CONTRACTS §1.2). */
export function createJobId() {
  return `job_${randomHex(8)}`;
}

/** Random id of the current Host process. */
export function createHostEpoch() {
  return `he_${randomHex(8)}`;
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
