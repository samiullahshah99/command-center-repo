/**
 * Mockup-only constants.
 *
 * ⚠️⚠️ THE FIXED DATE BELOW IS A **MOCKUP CONVENTION**. DO NOT COPY IT INTO A
 * LIVE FEATURE.
 *
 * These pages are judged as screenshots, so every date is derived from one
 * hardcoded reference point. That buys two things a real feature does not want:
 * the today-line and the overdue bars land exactly where they were designed to,
 * and the screenshots look identical whenever they are reopened. Using the real
 * clock would make a mockup that drifts — bars sliding across the grid week by
 * week until the composition no longer reads.
 *
 * **A LIVE FEATURE MUST NOT DO THIS.** Per CLAUDE.md, real features resolve
 * `now` ONCE above the tree and thread it down as a parameter — see
 * `formatDueDate(due, now)` in src/lib/format-date.ts and how
 * src/features/tracker/components/board-table.tsx pins it with `useMemo`. Never
 * `Date.now()` in a cell renderer, and never a hardcoded date in shipped code.
 */
export const MOCKUP_TODAY = '2026-08-12';

/** The reference date as a Date. Constructed at UTC midnight, like the helpers. */
export function mockupNow(): Date {
  return new Date(`${MOCKUP_TODAY}T00:00:00Z`);
}

/** Whole days between two ISO dates (b - a). Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** ISO date `offset` days from the reference date. */
export function fromToday(offset: number): string {
  const d = mockupNow();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ── Timeline grid ───────────────────────────────────────────────────────────

/** Weeks shown on the roadmap: 3 before today's week, today's, and 4 after. */
export const TIMELINE_WEEKS_BEFORE = 3;
export const TIMELINE_WEEKS_AFTER = 4;
export const TIMELINE_WEEK_COUNT = TIMELINE_WEEKS_BEFORE + 1 + TIMELINE_WEEKS_AFTER;

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  // getUTCDay: 0 = Sunday. Shift so Monday is the first column.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

/** The grid's left edge. */
export function timelineStart(): string {
  const d = new Date(`${weekStart(MOCKUP_TODAY)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - TIMELINE_WEEKS_BEFORE * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Position on the grid as a percentage, 0–100.
 *
 * Clamped, because an overdue bar is deliberately allowed to start before the
 * today-line but must not escape the grid entirely — a bar rendered at -40%
 * disappears and reads as missing data rather than as very late.
 */
export function gridPercent(iso: string): number {
  const totalDays = TIMELINE_WEEK_COUNT * 7;
  const offset = daysBetween(timelineStart(), iso);
  return Math.max(0, Math.min(100, (offset / totalDays) * 100));
}
