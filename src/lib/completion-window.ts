import type { Cadence } from '@/db/schema/recurring-task';

/**
 * COMPLETION WINDOW BOUNDARIES — the business-timezone day.
 *
 * Design §3.3, Option B, DECIDED 2026-08-06 (§7 decision 1, the highest-regret
 * decision in the document).
 *
 * ⚠️⚠️ THIS IS DELIBERATELY NOT THE UTC CONVENTION USED ELSEWHERE, and the two
 * must not be merged.
 *
 * `src/lib/dept-health.ts` uses `startOfUtcDay()` for due-date arithmetic and
 * stays exactly as it is. That domain is coarse — "overdue by more than three
 * days" — and its dates are seeded at UTC midnight, so the boundary never lands
 * mid-ritual.
 *
 * Completion windows credit HUMAN DAILY RITUALS, and the team is in PKT (UTC+5).
 * Under a UTC day, anyone whose standup happens before 05:00 local credits the
 * PREVIOUS day and looks permanently one day late — a correctness failure about
 * people, not a convention preference. A 09:00 PKT standup is 04:00Z; a 03:00 PKT
 * one is 22:00Z *yesterday*.
 *
 * ⚠️ NOT per-user timezones. No such preference exists, and adding one is real
 * machinery (a column, a UI, a migration, and a per-row boundary calculation).
 * One named constant, one business timezone.
 */
export const COMPLETION_TZ = 'Asia/Karachi';

/**
 * Karachi's fixed offset from UTC, in minutes.
 *
 * ⚠️ PAKISTAN HAS NO DST, AND THAT IS THE ENTIRE JUSTIFICATION FOR A FIXED
 * OFFSET. PKT has been a constant UTC+05:00 since 2009, when the last DST
 * experiment was abandoned. A fixed offset is therefore exact here, and it is
 * exact in a way `Intl.DateTimeFormat` cannot beat while being trivially
 * testable and free of locale-data drift between Node versions.
 *
 * ⚠️ IF THE BUSINESS TIMEZONE EVER CHANGES, THIS ASSUMPTION BREAKS SILENTLY.
 * Moving `COMPLETION_TZ` to a DST-observing zone (anything in Europe or North
 * America) makes every window wrong for half the year, with no error. Switch to
 * `Intl.DateTimeFormat(COMPLETION_TZ, …)` at that point — do not adjust the
 * number. A test pins this pairing.
 */
export const COMPLETION_TZ_OFFSET_MINUTES = 5 * 60;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * The wall-clock civil date in COMPLETION_TZ for an instant, as `YYYY-MM-DD`.
 *
 * Shifting the instant by the offset and then reading its UTC parts is the
 * standard trick: after the shift, "UTC midnight" and "Karachi midnight" coincide.
 */
function civilDate(instant: Date): string {
  const shifted = new Date(instant.getTime() + COMPLETION_TZ_OFFSET_MINUTES * MS_PER_MINUTE);
  return shifted.toISOString().slice(0, 10);
}

/** UTC-midnight epoch ms of the shifted instant — the civil day as a number. */
function civilDayStartMs(instant: Date): number {
  const shifted = new Date(instant.getTime() + COMPLETION_TZ_OFFSET_MINUTES * MS_PER_MINUTE);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
}

/** `YYYY-MM-DD` for a civil-day epoch-ms value. */
function toDateString(civilMs: number): string {
  return new Date(civilMs).toISOString().slice(0, 10);
}

/**
 * ISO week start (MONDAY) for a civil day.
 *
 * ⚠️ Monday, not Sunday. `getUTCDay()` is 0 for Sunday, so Sunday must reach back
 * six days rather than zero — the classic off-by-one that silently files every
 * Sunday completion into the following week.
 */
function isoWeekStartMs(civilMs: number): number {
  const dow = new Date(civilMs).getUTCDay(); // 0=Sun … 6=Sat
  const backToMonday = dow === 0 ? 6 : dow - 1;
  return civilMs - backToMonday * MS_PER_DAY;
}

/**
 * Which window a completion credits — a DATE string, half of the idempotency key
 * `(recurring_task_id, window_start)`.
 *
 * ⚠️ `occurredAt` MUST BE THE EVENT'S OWN TIME, never `now()` (design §2.4). A
 * signal can arrive late — a webhook retry, a queue backlog, a `renormalise` run
 * replaying a fixed parser — and stamping the worker's clock would credit Monday's
 * standup to Wednesday. Using the event's time also makes window assignment
 * deterministic and replayable.
 *
 * @param taskCreatedAt anchors `biweekly` only; ignored by every other cadence.
 */
export function windowStartFor(cadence: Cadence, occurredAt: Date, taskCreatedAt?: Date): string {
  const dayMs = civilDayStartMs(occurredAt);

  switch (cadence) {
    case 'daily':
      return civilDate(occurredAt);

    case 'weekly':
      return toDateString(isoWeekStartMs(dayMs));

    case 'biweekly': {
      /**
       * ⚠️ ANCHORED ON THE TASK, not on the epoch. "Every other week" is only
       * meaningful relative to a starting week — anchoring on an arbitrary global
       * origin would put two tasks created a week apart on opposite phases with no
       * way to reason about it. Falls back to the event's own week when no
       * `taskCreatedAt` is supplied, which degrades to weekly rather than throwing.
       */
      const eventWeek = isoWeekStartMs(dayMs);
      if (!taskCreatedAt) return toDateString(eventWeek);

      const anchorWeek = isoWeekStartMs(civilDayStartMs(taskCreatedAt));
      const weeksSince = Math.floor((eventWeek - anchorWeek) / (7 * MS_PER_DAY));
      // Two-week buckets: an odd week folds back into the even one before it.
      // Math.floor handles negatives correctly (a pre-anchor event, from a
      // backfill), where a bare `% 2` would not.
      const bucketStart = anchorWeek + Math.floor(weeksSince / 2) * 2 * 7 * MS_PER_DAY;
      return toDateString(bucketStart);
    }

    case 'monthly': {
      const d = new Date(dayMs);
      return toDateString(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    }

    case 'quarterly': {
      const d = new Date(dayMs);
      const quarterFirstMonth = Math.floor(d.getUTCMonth() / 3) * 3;
      return toDateString(Date.UTC(d.getUTCFullYear(), quarterFirstMonth, 1));
    }
  }
}

/**
 * The instant a window closes — the start of the NEXT window.
 *
 * Used by the sweep to decide which windows have ended. Exclusive: a completion
 * at exactly this instant belongs to the next window, matching `windowStartFor`.
 */
export function windowEndFor(cadence: Cadence, windowStart: string, taskCreatedAt?: Date): Date {
  // `windowStart` is a civil date; midnight in COMPLETION_TZ is that date's UTC
  // midnight minus the offset.
  const startUtcMs =
    Date.parse(`${windowStart}T00:00:00Z`) - COMPLETION_TZ_OFFSET_MINUTES * MS_PER_MINUTE;
  const d = new Date(Date.parse(`${windowStart}T00:00:00Z`));

  switch (cadence) {
    case 'daily':
      return new Date(startUtcMs + MS_PER_DAY);
    case 'weekly':
      return new Date(startUtcMs + 7 * MS_PER_DAY);
    case 'biweekly':
      return new Date(startUtcMs + 14 * MS_PER_DAY);
    case 'monthly':
      return new Date(
        Date.parse(
          `${toDateString(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))}T00:00:00Z`
        ) -
          COMPLETION_TZ_OFFSET_MINUTES * MS_PER_MINUTE
      );
    case 'quarterly':
      return new Date(
        Date.parse(
          `${toDateString(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1))}T00:00:00Z`
        ) -
          COMPLETION_TZ_OFFSET_MINUTES * MS_PER_MINUTE
      );
  }

  // Unreachable; `taskCreatedAt` is accepted for symmetry with windowStartFor.
  void taskCreatedAt;
}
