/**
 * Inbound contracts for our two internal platforms, UGC and Vision.
 *
 * ⚠️ These contracts are defined by the BACKEND ENGINEER, not by us. Both
 * implementations are already built and stable, so this file conforms to them.
 * Do not "improve" the schemes here — that would break live senders.
 *
 * The two differ in more than a secret: UGC signs with a timestamp, Vision does
 * not. That difference is load-bearing and is why they use different verify
 * functions rather than one parameterised call.
 */

/** Which internal platform an endpoint serves. Matches raw_event.source. */
export type InternalPlatform = 'ugc' | 'vision';

// ── UGC ─────────────────────────────────────────────────────────────────────

export const UGC_SIGNATURE_HEADER = 'x-luckyfours-signature';
export const UGC_TIMESTAMP_HEADER = 'x-luckyfours-timestamp';
export const UGC_EVENT_ID_HEADER = 'x-luckyfours-event-id';
export const UGC_EVENT_HEADER = 'x-luckyfours-event';

export const UGC_SIGNATURE_PREFIX = 'sha256=';

/**
 * Basestring separator: a literal DOT, not a colon.
 *
 *   `{timestamp}.{rawBody}`
 *
 * Slack uses `v0:{ts}:{body}`. Copying the Slack verifier here produces a valid
 * hex signature that never matches, which reads exactly like a wrong secret.
 */
export const UGC_SEPARATOR = '.';

/** Their skew tolerance. */
export const UGC_WINDOW_SECONDS = 300;

/** Their timeout budget — we must answer well inside this. */
export const UGC_SENDER_TIMEOUT_SECONDS = 10;

// ── Vision ──────────────────────────────────────────────────────────────────

export const VISION_SIGNATURE_HEADER = 'x-vision-signature';
export const VISION_DELIVERY_HEADER = 'x-vision-delivery';
export const VISION_EVENT_HEADER = 'x-vision-event';

export const VISION_SIGNATURE_PREFIX = 'sha256=';

/** Their timeout budget. */
export const VISION_SENDER_TIMEOUT_SECONDS = 15;

// ── Shared ──────────────────────────────────────────────────────────────────

export const SECRET_ENV_VAR: Record<InternalPlatform, string> = {
  ugc: 'UGC_WEBHOOK_SECRET',
  vision: 'VISION_WEBHOOK_SECRET'
};

/**
 * Idempotency key: the sender's own `id` on the payload.
 *
 * Returns null when absent, in which case the event is stored without
 * deduplication. A duplicate row is recoverable downstream; discarding a
 * signature-verified event because we disliked its shape is not.
 */
export function externalIdOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

// ── Event type field: DIFFERENT KEY PER PLATFORM ────────────────────────────

/**
 * ⚠️ The two platforms name this field differently. Getting it wrong means test
 * events are not recognised and event type reads as undefined downstream.
 *
 *   UGC     `type`    e.g. "creator.approved"
 *   Vision  `event`   e.g. "brief.submitted"
 *
 * Both ALSO send it as a header (X-LuckyFours-Event / X-Vision-Event), which is
 * preferred because it needs no payload shape assumption.
 */
export const EVENT_TYPE_FIELD: Record<InternalPlatform, 'type' | 'event'> = {
  ugc: 'type',
  vision: 'event'
};

export function eventTypeOf(platform: InternalPlatform, payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as Record<string, unknown>)[EVENT_TYPE_FIELD[platform]];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ── Setup / test events ─────────────────────────────────────────────────────

/**
 * Both platforms send a fixed-id test event during setup:
 *
 *   UGC     type  `test.ping`,           id literally "evt_test",
 *           actor.id "system", metadata.test true. NOT written to their ledger.
 *   Vision  event `control_center.test`, id all zeros, metadata.test true.
 *
 * Because we deduplicate on id, the SECOND test ping would be silently
 * suppressed — during setup that looks exactly like a broken handler, at the
 * worst possible moment for a confusing signal.
 *
 * Stored with a NULL externalId (see the handler) so every ping lands as its own
 * row and repeated pings stay visible.
 */
export const UGC_TEST_EVENT_ID = 'evt_test';
export const UGC_TEST_EVENT_TYPE = 'test.ping';
export const VISION_TEST_EVENT_TYPE = 'control_center.test';

/** All-zero id, ignoring dashes — covers UUID and bare-digit forms. */
function isAllZeroId(id: string): boolean {
  return id.length > 0 && /^[0-]+$/.test(id) && id.includes('0');
}

/** Both docs specify metadata.test === true on their test event. */
function hasTestMarker(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const meta = (payload as { metadata?: unknown }).metadata;
  if (typeof meta !== 'object' || meta === null) return false;
  return (meta as { test?: unknown }).test === true;
}

export function isTestEvent(
  platform: InternalPlatform,
  payload: unknown,
  eventTypeHeader: string | null
): boolean {
  const id = externalIdOf(payload);
  // Header first — it needs no assumption about the payload's field names.
  const eventType = eventTypeHeader ?? eventTypeOf(platform, payload);

  if (hasTestMarker(payload)) return true;

  if (platform === 'ugc') {
    return id === UGC_TEST_EVENT_ID || eventType === UGC_TEST_EVENT_TYPE;
  }
  return (id !== null && isAllZeroId(id)) || eventType === VISION_TEST_EVENT_TYPE;
}
