import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Shared verifier for TIMESTAMPED HMAC webhook signatures.
 *
 * Covers any provider whose scheme is:
 *
 *   basestring = `v0:${timestamp}:${rawBody}`
 *   signature  = `${prefix}${HMAC_SHA256(secret, basestring)}`   (hex)
 *
 * ── Who shares this, and who does not ──────────────────────────────────────
 *
 *   Slack               ✅ identical basestring; signature carries a 'v0=' prefix
 *   Portal / Studio     ✅ identical basestring; signature is bare hex
 *   ClickUp             ❌ NOT shared, deliberately
 *
 * ClickUp sends no timestamp header at all and signs the raw body alone. Forcing
 * it through here would mean making the timestamp optional, which would turn the
 * replay check into a silent no-op for whichever caller forgot to pass one —
 * exactly the kind of security control that should not be conditional. It keeps
 * its own verifier in clickup/verify.ts.
 *
 * ⚠️ `rawBody` MUST be the exact request text. Parsing to JSON and
 * re-serialising changes bytes and the HMAC will not match.
 */

/** Slack's recommendation, and what our own contract specifies. */
export const DEFAULT_MAX_AGE_SECONDS = 60 * 5;

export type TimestampedHmacConfig = {
  signatureHeader: string;
  timestampHeader: string;
  /**
   * Prefix on the signature VALUE (not the basestring).
   * Slack sends 'v0=<hex>'; our internal contract sends bare '<hex>'.
   */
  signaturePrefix?: string;
  maxAgeSeconds?: number;
};

export type HmacVerifyFailure =
  | 'missing_signature_header'
  | 'missing_timestamp_header'
  | 'malformed_timestamp'
  | 'stale_timestamp'
  | 'missing_secret'
  | 'signature_mismatch';

export type HmacVerifyResult = { ok: true } | { ok: false; reason: HmacVerifyFailure };

/**
 * Constant-time comparison.
 *
 * timingSafeEqual throws when buffers differ in length, so lengths are checked
 * first. That check leaks nothing: the expected signature length is fixed and
 * publicly known.
 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function buildBasestring(timestamp: string, rawBody: string): string {
  // The literal 'v0:' is part of the SIGNED STRING — it is a scheme version, not
  // decoration, and both Slack and our contract include it.
  return `v0:${timestamp}:${rawBody}`;
}

export function verifyTimestampedHmac(input: {
  rawBody: string;
  headers: Headers;
  /** Read by the caller so this module never touches process.env. */
  secret: string | undefined;
  config: TimestampedHmacConfig;
  /** Injectable for tests. Defaults to wall clock. */
  nowSeconds?: number;
}): HmacVerifyResult {
  const { rawBody, headers, secret, config } = input;
  const prefix = config.signaturePrefix ?? '';
  const maxAge = config.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  const signature = headers.get(config.signatureHeader);
  if (!signature) return { ok: false, reason: 'missing_signature_header' };

  const timestamp = headers.get(config.timestampHeader);
  if (!timestamp) return { ok: false, reason: 'missing_timestamp_header' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !Number.isInteger(ts) || ts <= 0) {
    return { ok: false, reason: 'malformed_timestamp' };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Math.abs on purpose: a timestamp far in the FUTURE is equally suspect, and a
  // one-sided check would let a forged future timestamp replay indefinitely.
  if (Math.abs(now - ts) > maxAge) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  if (!secret) return { ok: false, reason: 'missing_secret' };

  const expected =
    prefix + createHmac('sha256', secret).update(buildBasestring(timestamp, rawBody)).digest('hex');

  return safeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
}

/**
 * Produce a signature the way a sender would.
 *
 * Used by tests so they sign fixtures rather than hardcoding digests that would
 * silently rot if the basestring ever changed — and by the worked example in
 * docs/webhook-contract.md.
 */
export function signTimestampedHmac(input: {
  rawBody: string;
  timestamp: number;
  secret: string;
  signaturePrefix?: string;
}): { signature: string; timestamp: string } {
  const timestamp = String(input.timestamp);
  const digest = createHmac('sha256', input.secret)
    .update(buildBasestring(timestamp, input.rawBody))
    .digest('hex');
  return { signature: `${input.signaturePrefix ?? ''}${digest}`, timestamp };
}
