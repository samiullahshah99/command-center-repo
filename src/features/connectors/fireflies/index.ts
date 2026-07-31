import { signBodyOnly, verifyBodyOnly, type HmacVerifyResult } from '../verify-hmac';
import { firefliesWebhookSchema } from './schemas';

export * from './schemas';
export * from './client';

/**
 * Fireflies webhook verification.
 *
 * https://docs.fireflies.ai/graphql-api/webhooks
 *
 *   header     x-hub-signature      ⚠️ NO "-256" suffix
 *   prefix     sha256=
 *   basestring rawBody only
 *   replay     ❌ NONE
 *
 * ⚠️ The header is `x-hub-signature`, not GitHub's `x-hub-signature-256`. Most
 * examples online show the GitHub form; using it here means reading a header
 * that is never sent, so every request 401s with "missing signature header".
 *
 * ⚠️⚠️ NO REPLAY PROTECTION. Fireflies sends no timestamp, so a captured request
 * stays valid forever. Idempotency on meetingId is the ONLY defence — hence
 * verifyBodyOnly rather than verifyWithTimestamp.
 *
 * The secret is one WE choose: app.fireflies.ai/settings → Developer Settings,
 * either a custom 16–32 character string or one generated there. Unlike ClickUp,
 * it is not handed to us after registration.
 */
export const FIREFLIES_SIGNATURE_HEADER = 'x-hub-signature';
export const FIREFLIES_SIGNATURE_PREFIX = 'sha256=';

export function verifyFirefliesRequest(input: {
  rawBody: string;
  headers: Headers;
}): HmacVerifyResult {
  return verifyBodyOnly({
    headerName: FIREFLIES_SIGNATURE_HEADER,
    prefix: FIREFLIES_SIGNATURE_PREFIX,
    secret: process.env.FIREFLIES_WEBHOOK_SECRET,
    rawBody: input.rawBody,
    headers: input.headers
  });
}

/** Per-delivery id Fireflies sends on the new (Integrations page) webhook. */
export const FIREFLIES_DELIVERY_ID_HEADER = 'x-webhook-delivery-id';
export const FIREFLIES_TEST_DELIVERY_PREFIX = 'test-';

/**
 * TODO(REMOVE ONCE REAL EVENTS ARE CONFIRMED SIGNED)
 *
 * Fireflies' *test* deliveries arrive with NO signature header at all — two
 * confirmed, both carrying `x-webhook-delivery-id: test-…` among 20 headers and
 * nothing resembling a signature. Either they sign only real events, or their
 * config never persisted our secret. Until we have seen a real delivery we
 * cannot tell which, and we cannot see the payload shape without accepting one.
 *
 * ⚠️ SECURITY: BOTH conditions below are attacker-controlled, and this endpoint
 * is public and unauthenticated by design. Anyone who knows the URL can send
 * `x-webhook-delivery-id: test-x` with no signature and have arbitrary JSON
 * written to raw_event. Nothing parses raw_event yet and these rows are stored
 * with a null external_id so they are trivially identifiable and purgeable, but
 * this is a real hole and the reason to close the window quickly.
 *
 * The exception is deliberately narrow in one important way: a signature that is
 * PRESENT but INVALID never qualifies. Only total absence does. Otherwise an
 * attacker could send a `test-` id plus any garbage signature and be waved
 * through, and a genuinely misconfigured secret would look like a test ping.
 */
export function isUnsignedTestDelivery(headers: Headers): boolean {
  const deliveryId = headers.get(FIREFLIES_DELIVERY_ID_HEADER);
  if (!deliveryId?.startsWith(FIREFLIES_TEST_DELIVERY_PREFIX)) return false;

  // Absence only — never a present-but-wrong signature.
  return headers.get(FIREFLIES_SIGNATURE_HEADER) === null;
}

/** Test/util helper: sign the way Fireflies does. */
export function signFirefliesRequest(input: { rawBody: string; secret: string }): string {
  return signBodyOnly({
    rawBody: input.rawBody,
    secret: input.secret,
    prefix: FIREFLIES_SIGNATURE_PREFIX
  });
}

/**
 * Idempotency key: `meetingId`.
 *
 * Same value as the transcript id. Returns null for an off-contract payload,
 * which then stores without deduplication rather than being discarded.
 */
export function externalIdOf(payload: unknown): string | null {
  const parsed = firefliesWebhookSchema.safeParse(payload);
  return parsed.success ? parsed.data.meetingId : null;
}

/**
 * Retry budget for the Fireflies parse queue — deliberately different from the
 * global policy.
 *
 * Two reasons:
 *   1. Fireflies may fire the webhook BEFORE the transcript is retrievable, so a
 *      fetch legitimately fails and must be retried. A 5-second first retry
 *      almost certainly fires before it is ready and spends a request learning
 *      nothing.
 *   2. The API is 500 requests per DAY on Pro. Six attempts per meeting would
 *      let ~80 troubled meetings exhaust a day's quota.
 *
 * 3 retries at 60s → ~2m → ~4m (with jitter, capped at 30m) means at most 4 API
 * calls per meeting and a realistic window for the transcript to appear.
 */
export const FIREFLIES_JOB_OPTIONS = {
  retryLimit: Number(process.env.FIREFLIES_RETRY_LIMIT ?? 3),
  retryDelay: Number(process.env.FIREFLIES_RETRY_DELAY_SECONDS ?? 60),
  retryBackoff: true,
  retryDelayMax: Number(process.env.FIREFLIES_RETRY_DELAY_MAX_SECONDS ?? 1800)
} as const;
