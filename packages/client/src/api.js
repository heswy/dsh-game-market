/**
 * Same-origin Host API clients used by the Client and injected into Runtime.
 *
 * - `getApiClient()` is the shared V0 client (agent snapshots, launch, saves).
 * - `getMarketApi()` adds the V1 install/registry routes from `api-v1.js`.
 *
 * Both keep a test seam so components never construct fetch calls themselves.
 */
import { createApiClient as sharedCreateApiClient, GameMarketApiError } from '../../shared/src/api-client.js';
import { createMarketApi } from './api-v1.js';
import { reportDiagnostic } from './diagnostics.js';

export const ClientApiError = GameMarketApiError;

/** Factory kept for tests/back-compat: same signature as the shared client. */
export const createClientApi = function createClientApi(options) {
  return sharedCreateApiClient(options && typeof options === 'object' ? options : {});
};

let client = null;
let marketClient = null;

/** Inject a client in tests or replace it at runtime. */
export function configureApiClient(nextClient) {
  client = nextClient && typeof nextClient === 'object' ? nextClient : null;
  return function reset() {
    client = null;
  };
}

/** Inject the V1 Market client (install/registry) in tests. */
export function configureMarketApi(nextClient) {
  marketClient = nextClient && typeof nextClient === 'object' ? nextClient : null;
  return function reset() {
    marketClient = null;
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

/** Return the V1 Market API client, or null when fetch is unavailable. */
export function getMarketApi() {
  if (marketClient !== null) return marketClient;
  try {
    marketClient = createMarketApi();
  } catch (error) {
    reportDiagnostic('market-api-unavailable', error);
    marketClient = null;
  }
  return marketClient;
}

/** True when a same-origin fetch client can be built. */
export function isApiAvailable() {
  return getApiClient() !== null;
}

/** True when the V1 Market client can be built. */
export function isMarketApiAvailable() {
  return getMarketApi() !== null;
}
