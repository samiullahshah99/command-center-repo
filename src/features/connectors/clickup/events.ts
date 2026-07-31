/**
 * ClickUp webhook payload shapes.
 *
 * NO PARSING OF MEANING here. These helpers only answer "what is the idempotency
 * key" — interpretation is downstream, and raw_event holds the payload verbatim
 * so a parser can be rewritten and replayed.
 */

export const CLICKUP_WEBHOOK_EVENTS = [
  'taskCreated',
  'taskUpdated',
  'taskStatusUpdated',
  'taskDeleted'
] as const;

export type ClickUpWebhookEvent = (typeof CLICKUP_WEBHOOK_EVENTS)[number];

export type ClickUpHistoryItem = {
  /** UUID per change. The only plausible per-delivery identifier. */
  id?: string;
  field?: string;
  date?: string;
  [key: string]: unknown;
};

export type ClickUpWebhookPayload = {
  event?: string;
  /** Identifies the WEBHOOK, not the delivery. Identical on every event. */
  webhook_id?: string;
  task_id?: string;
  list_id?: string;
  folder_id?: string;
  space_id?: string;
  history_items?: ClickUpHistoryItem[];
  [key: string]: unknown;
};

export function isClickUpPayload(p: unknown): p is ClickUpWebhookPayload {
  return typeof p === 'object' && p !== null;
}

/**
 * Idempotency key.
 *
 * ⚠️ NOT `webhook_id` — that identifies the webhook registration and is identical
 * on every single delivery. Using it would collapse every ClickUp event ever
 * received into one raw_event row.
 *
 * ⚠️ NOT `task_id` — one task emits many events.
 *
 * `history_items[0].id` is a UUID per change, which is the closest thing ClickUp
 * offers to a delivery id. ClickUp's docs do not explicitly guarantee it is
 * unique per delivery, so this is the best available option rather than a
 * documented one.
 *
 * Returns null when there are no history items (taskCreated and taskDeleted may
 * send none). Null means the row inserts without deduplication — a duplicate
 * raw_event is recoverable downstream, whereas merging two genuinely distinct
 * events is not.
 */
export function externalIdOf(payload: unknown): string | null {
  if (!isClickUpPayload(payload)) return null;

  const first = payload.history_items?.[0];
  if (first && typeof first.id === 'string' && first.id.length > 0) {
    return first.id;
  }

  return null;
}
