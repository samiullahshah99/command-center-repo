import {
  DEFAULT_MAX_AGE_SECONDS,
  signTimestampedHmac,
  verifyTimestampedHmac,
  type HmacVerifyResult,
  type TimestampedHmacConfig
} from '../verify-hmac';

/**
 * Slack request signature verification.
 *
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * The mechanics live in ../verify-hmac.ts, which Slack shares with the internal
 * Portal and Studio connectors. The sharing is genuine, not forced: the signed
 * basestring is byte-identical (`v0:${timestamp}:${rawBody}`), the algorithm is
 * the same, and the replay window has the same semantics. The ONLY difference is
 * that Slack prefixes the signature VALUE with 'v0=' while our own contract
 * sends bare hex — one parameter.
 *
 * ClickUp is deliberately NOT shared: it sends no timestamp and signs the raw
 * body alone. See the note in verify-hmac.ts.
 *
 * ⚠️ `rawBody` MUST be the exact request text from `await req.text()`.
 */

export const SLACK_SIGNATURE_HEADER = 'x-slack-signature';
export const SLACK_TIMESTAMP_HEADER = 'x-slack-request-timestamp';

/** Slack's own recommendation. Re-exported so call sites need not know the source. */
export const MAX_TIMESTAMP_AGE_SECONDS = DEFAULT_MAX_AGE_SECONDS;

const SLACK_HMAC_CONFIG: TimestampedHmacConfig = {
  signatureHeader: SLACK_SIGNATURE_HEADER,
  timestampHeader: SLACK_TIMESTAMP_HEADER,
  signaturePrefix: 'v0=',
  maxAgeSeconds: MAX_TIMESTAMP_AGE_SECONDS
};

export type VerifyResult = HmacVerifyResult;

export function verifySlackRequest(input: {
  rawBody: string;
  headers: Headers;
  /** Injectable for tests. Defaults to wall clock. */
  nowSeconds?: number;
}): VerifyResult {
  return verifyTimestampedHmac({
    rawBody: input.rawBody,
    headers: input.headers,
    // Read here rather than inside the shared module, so that module stays free
    // of environment coupling.
    secret: process.env.SLACK_SIGNING_SECRET,
    config: SLACK_HMAC_CONFIG,
    nowSeconds: input.nowSeconds
  });
}

/**
 * Test/util helper: produce a valid signature for a body, the way Slack does.
 * Exported so tests sign fixtures instead of hardcoding digests.
 */
export function signSlackRequest(input: {
  rawBody: string;
  timestamp: number;
  signingSecret: string;
}): { signature: string; timestamp: string } {
  return signTimestampedHmac({
    rawBody: input.rawBody,
    timestamp: input.timestamp,
    secret: input.signingSecret,
    signaturePrefix: 'v0='
  });
}
