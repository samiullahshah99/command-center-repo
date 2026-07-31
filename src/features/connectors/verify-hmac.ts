import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC webhook signature verification, shared across all four inbound schemes.
 *
 * Two SEPARATE entry points, deliberately:
 *
 *   verifyWithTimestamp()  — signature + timestamp, replay window enforced
 *   verifyBodyOnly()       — signature only, NO replay protection
 *
 * The timestamp is NOT an optional parameter on one function. If it were, a
 * caller could omit it and silently lose replay protection while the code still
 * read as "verified". Two functions make the absence visible at the call site,
 * where a reviewer will see it.
 *
 * ⚠️ `rawBody` MUST be the exact request text. Parsing to JSON and
 * re-serialising changes bytes, and the HMAC will not match.
 */

export const DEFAULT_WINDOW_SECONDS = 300;

export type HmacVerifyFailure =
  | 'missing_signature_header'
  | 'missing_timestamp_header'
  | 'malformed_timestamp'
  | 'stale_timestamp'
  | 'missing_secret'
  | 'signature_mismatch';

export type HmacVerifyResult = { ok: true } | { ok: false; reason: HmacVerifyFailure };

/**
 * How the signed string is assembled.
 *
 *   'v0-prefixed'  `v0{sep}{timestamp}{sep}{body}`   — Slack
 *   'plain'        `{timestamp}{sep}{body}`          — UGC
 */
export type BasestringFormat = 'v0-prefixed' | 'plain';

/**
 * Constant-time comparison.
 *
 * timingSafeEqual throws on length mismatch, so lengths are compared first. That
 * leaks nothing — the expected signature length is fixed and public.
 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function buildTimestampedBasestring(input: {
  format: BasestringFormat;
  separator: string;
  timestamp: string;
  rawBody: string;
}): string {
  const { format, separator: s, timestamp, rawBody } = input;
  return format === 'v0-prefixed'
    ? `v0${s}${timestamp}${s}${rawBody}`
    : `${timestamp}${s}${rawBody}`;
}

function hexHmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

// ── Scheme A: signature + timestamp ─────────────────────────────────────────

/**
 * Verifies a signature AND enforces a replay window.
 *
 * Used by Slack (`v0:{ts}:{body}`, prefix `v0=`) and UGC (`{ts}.{body}`,
 * prefix `sha256=`).
 */
export function verifyWithTimestamp(input: {
  headerName: string;
  timestampHeader: string;
  /** Prefix on the signature VALUE, e.g. 'v0=' or 'sha256='. */
  prefix: string;
  /** Separator inside the basestring: ':' for Slack, '.' for UGC. */
  separator: string;
  format: BasestringFormat;
  secret: string | undefined;
  rawBody: string;
  headers: Headers;
  windowSeconds?: number;
  /** Injectable for tests. Defaults to wall clock. */
  nowSeconds?: number;
}): HmacVerifyResult {
  const window = input.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  const signature = input.headers.get(input.headerName);
  if (!signature) return { ok: false, reason: 'missing_signature_header' };

  const timestamp = input.headers.get(input.timestampHeader);
  if (!timestamp) return { ok: false, reason: 'missing_timestamp_header' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !Number.isInteger(ts) || ts <= 0) {
    return { ok: false, reason: 'malformed_timestamp' };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Math.abs on purpose: a timestamp far in the FUTURE is equally suspect, and a
  // one-sided check would let a forged future timestamp replay indefinitely.
  if (Math.abs(now - ts) > window) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  if (!input.secret) return { ok: false, reason: 'missing_secret' };

  const basestring = buildTimestampedBasestring({
    format: input.format,
    separator: input.separator,
    timestamp,
    rawBody: input.rawBody
  });

  const expected = input.prefix + hexHmac(input.secret, basestring);

  return safeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
}

// ── Scheme B: signature over the body alone ─────────────────────────────────

/**
 * Verifies a signature over the raw body ONLY.
 *
 * ⚠️ THERE IS NO REPLAY PROTECTION. The sender transmits no timestamp, so a
 * captured request stays valid forever and can be replayed verbatim.
 * Idempotency on the provider's event id is the ONLY defence.
 *
 * Used by Vision (prefix `sha256=`) and ClickUp (no prefix). Every call site
 * must state this in a comment.
 */
export function verifyBodyOnly(input: {
  headerName: string;
  /** Prefix on the signature VALUE. '' for ClickUp, 'sha256=' for Vision. */
  prefix: string;
  secret: string | undefined;
  rawBody: string;
  headers: Headers;
}): HmacVerifyResult {
  const signature = input.headers.get(input.headerName);
  if (!signature) return { ok: false, reason: 'missing_signature_header' };

  if (!input.secret) return { ok: false, reason: 'missing_secret' };

  const expected = input.prefix + hexHmac(input.secret, input.rawBody);

  return safeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
}

// ── Signing helpers (tests + docs) ──────────────────────────────────────────

export function signWithTimestamp(input: {
  rawBody: string;
  timestamp: number;
  secret: string;
  prefix: string;
  separator: string;
  format: BasestringFormat;
}): { signature: string; timestamp: string } {
  const timestamp = String(input.timestamp);
  const basestring = buildTimestampedBasestring({
    format: input.format,
    separator: input.separator,
    timestamp,
    rawBody: input.rawBody
  });
  return { signature: input.prefix + hexHmac(input.secret, basestring), timestamp };
}

export function signBodyOnly(input: { rawBody: string; secret: string; prefix: string }): string {
  return input.prefix + hexHmac(input.secret, input.rawBody);
}
