import { signBodyOnly, verifyBodyOnly, type HmacVerifyResult } from '../verify-hmac';
import { firefliesWebhookSchema, isFirefliesTestEvent } from './schemas';

export * from './schemas';
export * from './client';

/**
 * Fireflies webhook verification.
 *
 *   header     x-hub-signature      ⚠️ NO "-256" suffix
 *   prefix     sha256=
 *   basestring rawBody only
 *   replay     ❌ NOT ENFORCED — see below
 *
 * ⚠️ The header is `x-hub-signature`, not GitHub's `x-hub-signature-256`. Most
 * examples online show the GitHub form; using it here means reading a header
 * that is never sent, so every request 401s with "missing signature header".
 *
 * ── Correction: there IS a timestamp, just not a header one ─────────────────
 * This comment used to say "Fireflies sends no timestamp". That was wrong. The
 * v2 body carries `timestamp` in epoch MILLIseconds. What does not exist is a
 * timestamp HEADER, which is the thing that matters for the basestring: the
 * signature covers the raw body alone, so there is nothing to interleave and
 * verifyBodyOnly stays correct.
 *
 * ── Why the body timestamp is NOT enforced as a replay window ───────────────
 * It could be. Body-only signing means an attacker replaying a captured request
 * cannot alter the timestamp without invalidating the signature, so a window
 * check would genuinely bound replay — unlike a header the attacker controls.
 *
 * It is deliberately not wired up, because the cost/benefit is upside-down here:
 *
 *   - The payoff of a successful replay is tiny. The handler stores an event and
 *     the worker performs an idempotent transcript fetch and upsert. Replaying a
 *     captured delivery re-fetches a transcript we already have, or is suppressed
 *     outright by the (source, external_id) index. There is no state change worth
 *     stealing and no side effect that is unsafe to repeat.
 *   - The cost of getting the window wrong is permanent data loss. Fireflies'
 *     retry behaviour is UNDOCUMENTED. If they retry an hour later carrying the
 *     original timestamp, a 300-second window rejects that retry every time and
 *     the meeting is never ingested — and we would have no way to tell that from
 *     a sender that simply stopped.
 *
 * Turning it on later is a small change (`verifyWithTimestamp` cannot be used —
 * it reads a header — so it would be an explicit check on the parsed body), and
 * worth revisiting once real delivery timing has been observed.
 *
 * The secret is one WE choose: app.fireflies.ai/settings → Developer Settings,
 * either a custom 16–32 character string or one generated there. Unlike ClickUp,
 * it is not handed to us after registration.
 *
 * ⚠️ Their SETUP TEST deliveries arrive entirely UNSIGNED, and are therefore
 * rejected with 401 like anything else unsigned. REAL events are signed — that
 * is confirmed by a live delivery that passed verification — so no exception is
 * made for the test pings and none should be added.
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

/**
 * Per-delivery id Fireflies sends on the v2 (Integrations page) webhook.
 *
 * Diagnostic only — NOT the idempotency key. See externalIdOf() for why the key
 * comes from the body instead.
 */
export const FIREFLIES_DELIVERY_ID_HEADER = 'x-webhook-delivery-id';

/**
 * ── Removed: the unsigned-test-delivery exception ───────────────────────────
 * There was a temporary bypass here that accepted deliveries carrying
 * `x-webhook-delivery-id: test-…` with no signature at all, because every test
 * ping we had seen arrived unsigned and we could not otherwise inspect the
 * payload.
 *
 * It is gone. A live REAL delivery has now been confirmed signed with
 * `x-hub-signature`, which answers the question the bypass existed to ask. It
 * was also a genuine hole: both of its conditions were attacker-controlled on a
 * public endpoint, so anyone who knew the URL could write to raw_event.
 *
 * Every delivery now requires a valid signature, with no exception for any
 * delivery-id prefix. Do not reintroduce one.
 */

/** Test/util helper: sign the way Fireflies does. */
export function signFirefliesRequest(input: { rawBody: string; secret: string }): string {
  return signBodyOnly({
    rawBody: input.rawBody,
    secret: input.secret,
    prefix: FIREFLIES_SIGNATURE_PREFIX
  });
}

/**
 * Idempotency key: `event:meeting_id`.
 *
 * ── Why a composite and not meeting_id alone ────────────────────────────────
 * One meeting can legitimately produce more than one event — a "transcribed"
 * followed by a "summarized", say. Keying on meeting_id alone would file the
 * second under the first's key and DO NOTHING would silently swallow it, losing
 * a real event with no error anywhere. The event name is part of the identity.
 *
 * The tradeoff, accepted deliberately: a genuine RE-transcription of the same
 * meeting emits the same event for the same id and will be suppressed as a
 * duplicate. That is the same bargain every other connector here makes, and it
 * is recoverable — delete the row and let it redeliver — whereas two distinct
 * events merged into one row is not.
 *
 * Both halves come from the BODY, so a raw_event replay can reconstruct the key.
 * The `x-webhook-delivery-id` header would give truer per-delivery identity but
 * is not in the payload, and whether Fireflies reuses it across retry attempts
 * is undocumented — if it mints a new one per attempt, every retry becomes a new
 * row and idempotency is gone.
 *
 * Returns null for a test event (so every setup ping lands, as with UGC and
 * Vision) and for an off-contract payload (so it stores undeduplicated rather
 * than being discarded).
 */
export function externalIdOf(payload: unknown): string | null {
  const parsed = firefliesWebhookSchema.safeParse(payload);
  if (!parsed.success) return null;
  if (isFirefliesTestEvent(parsed.data)) return null;
  return `${parsed.data.event}:${parsed.data.meeting_id}`;
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
