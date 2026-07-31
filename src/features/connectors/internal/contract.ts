/**
 * The webhook contract for our OWN internal platforms (Portal and Studio).
 *
 * Unlike Slack and ClickUp, WE define this — the platform owners implement
 * against it. The canonical, sendable version is docs/webhook-contract.md; this
 * file is that document expressed as code, and the two must stay in step.
 *
 * No parsing of meaning happens here. `data` is deliberately left opaque:
 * raw_event is a landing zone, and interpreting payloads is a later stage.
 */

import * as z from 'zod';

export const CC_SIGNATURE_HEADER = 'x-cc-signature';
export const CC_TIMESTAMP_HEADER = 'x-cc-timestamp';

/** Bare hex, no prefix — unlike Slack's 'v0='. */
export const CC_SIGNATURE_PREFIX = '';

/** Which of our internal platforms an endpoint serves. */
export type InternalPlatform = 'portal' | 'studio';

/**
 * The envelope every internal webhook must send.
 *
 * Validated ONLY to the extent needed to extract the idempotency key. A payload
 * that fails this is still a real, signature-verified delivery, so it is stored
 * anyway with a null externalId rather than rejected — losing a verified event
 * because we disliked its shape would defeat the point of a landing zone.
 */
export const internalEnvelopeSchema = z.object({
  /** Unique per event, stable across retries. The idempotency key. */
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  /** ISO 8601. Not parsed to a Date here — that is interpretation. */
  occurred_at: z.string().min(1),
  data: z.unknown()
});

export type InternalEnvelope = z.infer<typeof internalEnvelopeSchema>;

/**
 * Idempotency key: the sender's own `event_id`.
 *
 * Returns null when the envelope does not match the contract, in which case the
 * event still gets stored but without deduplication. A duplicate row is
 * recoverable downstream; discarding a verified event is not.
 */
export function externalIdOf(payload: unknown): string | null {
  const parsed = internalEnvelopeSchema.safeParse(payload);
  return parsed.success ? parsed.data.event_id : null;
}

/** Env var holding the shared secret for each platform. */
export const SECRET_ENV_VAR: Record<InternalPlatform, string> = {
  portal: 'PORTAL_WEBHOOK_SECRET',
  studio: 'STUDIO_WEBHOOK_SECRET'
};
