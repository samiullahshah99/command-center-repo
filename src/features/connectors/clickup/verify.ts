import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * ClickUp webhook signature verification.
 *
 * https://developer.clickup.com/docs/webhooksignature
 *
 * ⚠️ Two things differ from Slack and both are easy to get wrong:
 *
 * 1. The secret is the one returned when the WEBHOOK IS CREATED
 *    (CLICKUP_WEBHOOK_SECRET), *not* CLICKUP_API_TOKEN. They are different
 *    values and confusing them produces a silent verification failure.
 *
 * 2. The signed basestring is the raw body ALONE — no version prefix and no
 *    timestamp. So unlike Slack there is nothing to bound replay with; ClickUp
 *    sends no timestamp header. Replay protection therefore comes from the
 *    idempotency index, not from this function.
 */

export const CLICKUP_SIGNATURE_HEADER = 'x-signature';

export type ClickUpVerifyFailure =
  | 'missing_signature_header'
  | 'missing_webhook_secret'
  | 'signature_mismatch';

export type ClickUpVerifyResult = { ok: true } | { ok: false; reason: ClickUpVerifyFailure };

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, so length is checked first. The
  // expected length is fixed and public, so this leaks nothing.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyClickUpRequest(input: {
  rawBody: string;
  headers: Headers;
}): ClickUpVerifyResult {
  const signature = input.headers.get(CLICKUP_SIGNATURE_HEADER);
  if (!signature) return { ok: false, reason: 'missing_signature_header' };

  const secret = process.env.CLICKUP_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'missing_webhook_secret' };

  // Raw body only — no 'v0:' prefix, no timestamp. Hex digest, lowercase.
  const expected = createHmac('sha256', secret).update(input.rawBody).digest('hex');

  return safeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
}

/**
 * Test/util helper: sign a body the way ClickUp does, so tests never hardcode a
 * digest that would silently rot if the basestring changed.
 */
export function signClickUpRequest(input: { rawBody: string; webhookSecret: string }): string {
  return createHmac('sha256', input.webhookSecret).update(input.rawBody).digest('hex');
}
