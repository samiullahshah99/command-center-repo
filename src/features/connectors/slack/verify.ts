import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Slack request signature verification.
 *
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * ⚠️ `rawBody` MUST be the exact request text from `await req.text()`. Parsing to
 * JSON and re-serialising changes key order and whitespace, so the recomputed
 * HMAC will not match. This is the single most common way this gets built wrong.
 */

export const SLACK_SIGNATURE_HEADER = 'x-slack-signature';
export const SLACK_TIMESTAMP_HEADER = 'x-slack-request-timestamp';

/** Slack's own recommendation. Older requests are treated as replays. */
export const MAX_TIMESTAMP_AGE_SECONDS = 60 * 5;

export type VerifyFailure =
  | 'missing_signature_header'
  | 'missing_timestamp_header'
  | 'malformed_timestamp'
  | 'stale_timestamp'
  | 'missing_signing_secret'
  | 'signature_mismatch';

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

function getSigningSecret(): string | undefined {
  return process.env.SLACK_SIGNING_SECRET;
}

/**
 * Constant-time comparison that does not leak length.
 *
 * timingSafeEqual throws when the buffers differ in length, so the lengths are
 * checked first — but that check itself is not secret, since the expected
 * signature length is fixed and public.
 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifySlackRequest(input: {
  rawBody: string;
  headers: Headers;
  /** Injectable for tests. Defaults to wall clock. */
  nowSeconds?: number;
}): VerifyResult {
  const { rawBody, headers } = input;

  const signature = headers.get(SLACK_SIGNATURE_HEADER);
  if (!signature) return { ok: false, reason: 'missing_signature_header' };

  const timestamp = headers.get(SLACK_TIMESTAMP_HEADER);
  if (!timestamp) return { ok: false, reason: 'missing_timestamp_header' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !Number.isInteger(ts) || ts <= 0) {
    return { ok: false, reason: 'malformed_timestamp' };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Absolute difference: a timestamp far in the FUTURE is equally suspect and
  // would otherwise pass a one-sided check.
  if (Math.abs(now - ts) > MAX_TIMESTAMP_AGE_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const secret = getSigningSecret();
  if (!secret) return { ok: false, reason: 'missing_signing_secret' };

  // Note the literal 'v0:' version prefix — it is part of the signed basestring,
  // not decoration.
  const basestring = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', secret).update(basestring).digest('hex')}`;

  return safeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
}

/**
 * Test/util helper: produce a valid signature for a body. Exported so the tests
 * can sign fixtures the same way Slack does rather than hardcoding digests that
 * would silently rot if the basestring changed.
 */
export function signSlackRequest(input: {
  rawBody: string;
  timestamp: number;
  signingSecret: string;
}): { signature: string; timestamp: string } {
  const timestamp = String(input.timestamp);
  const basestring = `v0:${timestamp}:${input.rawBody}`;
  const signature = `v0=${createHmac('sha256', input.signingSecret).update(basestring).digest('hex')}`;
  return { signature, timestamp };
}
