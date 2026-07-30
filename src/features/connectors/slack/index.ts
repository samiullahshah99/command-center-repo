import type { Connector } from '../types';
import { externalIdOf, isUrlVerification } from './events';
import { SLACK_SIGNATURE_HEADER, verifySlackRequest } from './verify';

export * from './events';
export * from './verify';

/**
 * Auth header convention for Slack.
 *
 * Bot tokens start `xoxb-` and REQUIRE the `Bearer ` prefix. Throws on a missing
 * token rather than emitting `Bearer undefined`, which returns the same
 * `invalid_auth` as a revoked token and is far harder to diagnose.
 *
 * Not used by the webhook route (inbound requests are verified by signature, not
 * by our token) — this is for outbound calls to the Web API.
 */
export function slackAuthHeaders(): Record<string, string> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN is not set — refusing to send an empty Authorization header.');
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8'
  };
}

export const slackConnector: Connector = {
  source: 'slack',
  displayName: 'Slack',
  baseUrl: 'https://slack.com/api',
  authHeaders: slackAuthHeaders,
  webhook: {
    signatureHeader: SLACK_SIGNATURE_HEADER,
    verify: async ({ rawBody, headers }) => verifySlackRequest({ rawBody, headers }).ok,
    externalIdOf,
    handshake: (payload) =>
      isUrlVerification(payload)
        ? // Slack wants the raw challenge value echoed back, within 3 seconds.
          { status: 200, body: payload.challenge }
        : null
  }
};
