import {
  DEFAULT_WINDOW_SECONDS,
  signWithTimestamp,
  verifyWithTimestamp,
  type HmacVerifyResult
} from '../verify-hmac';

/**
 * Slack request signature verification.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 *   header     X-Slack-Signature
 *   prefix     v0=
 *   basestring v0:{timestamp}:{rawBody}
 *   replay     ±5 minutes  ✅ enforced
 *
 * ⚠️ `rawBody` MUST be the exact request text from `await req.text()`.
 */

export const SLACK_SIGNATURE_HEADER = 'x-slack-signature';
export const SLACK_TIMESTAMP_HEADER = 'x-slack-request-timestamp';
export const MAX_TIMESTAMP_AGE_SECONDS = DEFAULT_WINDOW_SECONDS;

export type VerifyResult = HmacVerifyResult;

export function verifySlackRequest(input: {
  rawBody: string;
  headers: Headers;
  nowSeconds?: number;
}): VerifyResult {
  return verifyWithTimestamp({
    headerName: SLACK_SIGNATURE_HEADER,
    timestampHeader: SLACK_TIMESTAMP_HEADER,
    prefix: 'v0=',
    separator: ':',
    format: 'v0-prefixed',
    // Read here so the shared module stays free of environment coupling.
    secret: process.env.SLACK_SIGNING_SECRET,
    rawBody: input.rawBody,
    headers: input.headers,
    windowSeconds: MAX_TIMESTAMP_AGE_SECONDS,
    nowSeconds: input.nowSeconds
  });
}

/** Test/util helper: sign the way Slack does, so tests never hardcode digests. */
export function signSlackRequest(input: {
  rawBody: string;
  timestamp: number;
  signingSecret: string;
}): { signature: string; timestamp: string } {
  return signWithTimestamp({
    rawBody: input.rawBody,
    timestamp: input.timestamp,
    secret: input.signingSecret,
    prefix: 'v0=',
    separator: ':',
    format: 'v0-prefixed'
  });
}
