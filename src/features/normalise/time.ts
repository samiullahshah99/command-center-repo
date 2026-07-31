/**
 * Five senders, five wire formats for "when did this happen".
 *
 * All verified against real payloads stored in raw_event:
 *
 *   Vision      occurred_at              "2026-07-31T13:07:43.413115Z"  ISO 8601
 *   UGC         occurred_at              "2026-07-31T13:06:10.892563Z"  ISO 8601
 *   Fireflies   timestamp                1785514180451                  epoch MILLIS (number)
 *   ClickUp     history_items[0].date    "1785489973755"                epoch MILLIS (STRING)
 *   Slack       event.ts                 "1785508463.300799"            epoch SECONDS (float string)
 *
 * ⚠️ Three traps, each of which fails quietly rather than loudly:
 *
 *  1. ClickUp sends milliseconds as a STRING. `new Date("1785489973755")` is
 *     Invalid Date, not a timestamp — it must go through Number() first.
 *  2. Slack's `event_time` (1785508463) is whole seconds and DROPS the
 *     sub-second part. `event.ts` carries microseconds, and timestamptz stores
 *     them, so `ts` is the right field. Using event_time silently rounds every
 *     event to the second.
 *  3. Seconds and milliseconds are both bare numbers. Feeding epoch SECONDS to
 *     `new Date()` yields 1970; feeding MILLIS to a seconds parser yields the
 *     year 58,000. Neither throws. The helpers below are named for their unit
 *     so a call site cannot be ambiguous, and the result is sanity-checked.
 */

/**
 * Anything before this is treated as a parse failure rather than data.
 *
 * Catches the seconds-as-millis mistake (which lands in 1970) without rejecting
 * genuine backfilled history. Nothing this system ingests predates the company.
 */
const MIN_PLAUSIBLE_MS = Date.UTC(2015, 0, 1);

/** Guards the millis-as-seconds mistake, which lands tens of thousands of years out. */
const MAX_SKEW_MS = 365 * 24 * 60 * 60 * 1000;

function plausible(ms: number, now: number): boolean {
  return Number.isFinite(ms) && ms >= MIN_PLAUSIBLE_MS && ms <= now + MAX_SKEW_MS;
}

/** ISO 8601 — Vision and UGC. */
export function fromIso(value: unknown, now = Date.now()): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return plausible(ms, now) ? new Date(ms) : null;
}

/** Epoch MILLISECONDS, as a number or a numeric string — Fireflies and ClickUp. */
export function fromEpochMillis(value: unknown, now = Date.now()): Date | null {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  // Number('') is 0, which would pass Number.isFinite — plausible() rejects it.
  return plausible(ms, now) ? new Date(ms) : null;
}

/**
 * Epoch SECONDS with a fractional part — Slack's `ts` / `event_ts`.
 *
 * "1785508463.300799" → 1785508463300.799ms. Rounded to whole millis because
 * that is JS Date's resolution; the extra microseconds are already in the raw
 * payload if anyone ever needs them.
 */
export function fromEpochSecondsFloat(value: unknown, now = Date.now()): Date | null {
  const seconds =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(seconds)) return null;
  return plausible(seconds * 1000, now) ? new Date(Math.round(seconds * 1000)) : null;
}

export type ResolvedTime = {
  occurredAt: Date;
  occurredAtSource: 'payload' | 'received_at';
};

/**
 * Take the sender's timestamp, or fall back to when WE received it — and record
 * which happened.
 *
 * The recording is the point. A fallback timestamp is still a real number that
 * looks exactly like a parsed one, so without `occurredAtSource` a run of
 * unparseable payloads would quietly shift a time series toward ingest time with
 * nothing to alert on.
 */
export function occurredAtOr(parsed: Date | null, receivedAt: Date): ResolvedTime {
  return parsed
    ? { occurredAt: parsed, occurredAtSource: 'payload' }
    : { occurredAt: receivedAt, occurredAtSource: 'received_at' };
}
