import type { Connector } from '../types';
import { externalIdOf } from './events';
import { CLICKUP_SIGNATURE_HEADER, verifyClickUpRequest } from './verify';

export * from './events';
export * from './verify';
export * from './schemas';

export const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';

/**
 * Auth header convention for ClickUp — DIFFERENT from every other connector here.
 *
 *   Authorization: <token>        ← RAW, no "Bearer " prefix
 *
 * Adding `Bearer ` returns OAUTH_025; omitting the header entirely returns
 * OAUTH_017. Neither message mentions a prefix, so this is encoded once, here,
 * and never hand-written at a call site.
 *
 * Throws on a missing token rather than sending `Authorization: undefined`, which
 * produces the same ambiguous failure as a revoked token.
 */
export function clickUpAuthHeaders(): Record<string, string> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    throw new Error(
      'CLICKUP_API_TOKEN is not set — refusing to send an empty Authorization header.'
    );
  }
  return {
    // No "Bearer ". This is deliberate.
    Authorization: token,
    'Content-Type': 'application/json'
  };
}

export const clickUpConnector: Connector = {
  source: 'clickup',
  displayName: 'ClickUp',
  baseUrl: CLICKUP_BASE_URL,
  authHeaders: clickUpAuthHeaders,
  webhook: {
    signatureHeader: CLICKUP_SIGNATURE_HEADER,
    verify: async ({ rawBody, headers }) => verifyClickUpRequest({ rawBody, headers }).ok,
    externalIdOf
    // No handshake: ClickUp validates reachability at creation time by calling the
    // endpoint, but sends no challenge to echo back.
  }
};
