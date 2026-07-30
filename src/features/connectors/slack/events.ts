/**
 * Slack Events API payload shapes and the decisions made about them.
 *
 * NO PARSING OF MEANING happens here or anywhere in the request path. These
 * helpers only answer structural questions needed to decide "store or skip" and
 * "what is the idempotency key". Interpretation is a downstream concern —
 * raw_event holds the payload verbatim so a parser can be rewritten and replayed.
 */

/** Envelope Slack posts once when the Request URL is saved. */
export type UrlVerificationPayload = {
  type: 'url_verification';
  challenge: string;
  token?: string;
};

/** Normal event delivery envelope. */
export type EventCallbackPayload = {
  type: 'event_callback';
  /** Unique per event. THIS is the idempotency key, not event.ts. */
  event_id: string;
  event_time?: number;
  team_id?: string;
  api_app_id?: string;
  authorizations?: { user_id?: string; is_bot?: boolean }[];
  event?: SlackEvent;
};

export type SlackEvent = {
  type?: string;
  subtype?: string;
  /** Channel ID (C…/G…), NOT a channel name. */
  channel?: string;
  user?: string;
  text?: string;
  /** Message timestamp. Not unique across event types — do not use for dedup. */
  ts?: string;
  bot_id?: string;
  app_id?: string;
  [key: string]: unknown;
};

export type SlackWebhookPayload = UrlVerificationPayload | EventCallbackPayload | { type?: string };

export function isUrlVerification(p: unknown): p is UrlVerificationPayload {
  return (
    typeof p === 'object' &&
    p !== null &&
    (p as { type?: unknown }).type === 'url_verification' &&
    typeof (p as { challenge?: unknown }).challenge === 'string'
  );
}

export function isEventCallback(p: unknown): p is EventCallbackPayload {
  return typeof p === 'object' && p !== null && (p as { type?: unknown }).type === 'event_callback';
}

/**
 * Idempotency key.
 *
 * `event_id` is unique per event delivery and stable across Slack's retries,
 * which is exactly what dedup needs. `event.ts` is a message timestamp — it is
 * NOT unique across event types (a message and a reaction on it can share one),
 * so using it would collapse distinct events into one row.
 */
export function externalIdOf(payload: unknown): string | null {
  if (isEventCallback(payload) && typeof payload.event_id === 'string') {
    return payload.event_id;
  }
  return null;
}

/**
 * Should this event be skipped entirely?
 *
 * Purpose is loop prevention: if the copilot posts to a channel it also listens
 * to, its own message comes back as an event, and acting on that would recurse.
 *
 * Three independent signals, because Slack is inconsistent about which it sends:
 *   1. subtype === 'bot_message'
 *   2. a bot_id on the event
 *   3. app_id matching our own app (SLACK_APP_ID)
 *
 * This is a LOOP GUARD, not a content filter. Channel scoping is deliberately
 * not done here — Slack only delivers events for channels the bot was invited
 * to, so invitation is already the filter, and dropping events at ingest makes
 * them unreplayable. Downstream filters on payload->>'channel' instead.
 */
export function shouldSkipEvent(payload: unknown): { skip: boolean; reason?: string } {
  if (!isEventCallback(payload)) return { skip: false };

  const event = payload.event;
  if (!event) return { skip: false };

  if (event.subtype === 'bot_message') {
    return { skip: true, reason: 'bot_message_subtype' };
  }

  if (typeof event.bot_id === 'string' && event.bot_id.length > 0) {
    return { skip: true, reason: 'has_bot_id' };
  }

  const ourAppId = process.env.SLACK_APP_ID;
  if (ourAppId && event.app_id === ourAppId) {
    return { skip: true, reason: 'own_app_id' };
  }

  // api_app_id on the envelope is OUR app id on every delivery (it identifies
  // the receiving app), so it must NOT be used as a self-check — that would
  // skip everything.

  return { skip: false };
}
