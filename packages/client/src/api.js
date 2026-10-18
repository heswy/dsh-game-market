/**
 * Same-origin Host API client used by the Client and injected into Runtime.
 *
 * The heavy lifting lives in the shared client (all V0 endpoints + GM error
 * mapping). This module only owns the browser singleton and the test seam.
 */
import { createApiClient as sharedCreateApiClient, GameMarketApiError } from '../../shared/src/api-client.js';
import { reportDiagnostic } from './diagnostics.js';

export const ClientApiError = GameMarketApiError;

/** Factory kept for tests/back-compat: same signature as the shared client. */
export const createClientApi = function createClientApi(options) {
  return sharedCreateApiClient(options && typeof options === 'object' ? options : {});
};

let client = null;

/** Inject a client in tests or replace it at runtime. */
export function configureApiClient(nextClient) {
  client = nextClient && typeof nextClient === 'object' ? nextClient : null;
  return function reset() {
    client = null;
  };
}

/** Return the shared API client, or null when fetch is unavailable. */
export function getApiClient() {
  if (client !== null) return client;
  try {
    client = createClientApi();
  } catch (error) {
    reportDiagnostic('api-unavailable', error);
    client = null;
  }
  return client;
}

/** True when a same-origin fetch client can be built. */
export function isApiAvailable() {
  return getApiClient() !== null;
}
