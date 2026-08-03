/**
 * Date formatting for RENDERED output. One implementation, app-wide.
 *
 * ⚠️ FIXED locale and FIXED timezone. Never `undefined` for either.
 *
 * These strings are produced during SSR and again during hydration. Passing
 * `undefined` as the locale resolves to the HOST's locale — Node's on the
 * server, the browser's on the client — so the same timestamp came out as
 * "31 Jul 2026, 20:55" server-side and "Jul 31, 2026, 08:55 PM" client-side.
 * React treats that as a hydration mismatch and DISCARDS the subtree, which
 * presented as a data table rendering its toolbar and "5 row(s) total" footer
 * with no rows at all — indistinguishable from a failed fetch. See the
 * "PIN THE LOCALE" section in CLAUDE.md.
 *
 * Timezone is pinned for the same reason: a server in UTC and a browser in PKT
 * disagree even with the locale fixed. UTC is LABELLED in output so a pinned
 * time is not silently wrong for whoever reads it.
 *
 * Lives in src/lib rather than a feature folder because both extraction and the
 * tracker render dates, and a cross-feature import
 * (tracker → features/extraction) would couple two unrelated features together
 * to share four lines of Intl config.
 */

export const DATE_LOCALE = 'en-GB';
export const DATE_TZ = 'UTC';

/** Date + time, UTC-labelled. For meeting timestamps. */
export function formatMeetingDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleString(DATE_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: DATE_TZ
  })} UTC`;
}

/** Date only. Accepts `yyyy-mm-dd` or a full ISO timestamp. */
export function formatDateOnly(isoDate: string): string {
  const d = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00Z` : isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(DATE_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: DATE_TZ
  });
}

/**
 * A date reduced to its UTC day.
 *
 * Overdue is compared at DAY granularity: a task due "today" is not overdue at
 * 09:00 merely because it was created at 08:00 — day-level is what a human means
 * by a due date, and it stops the label flickering as the clock passes midnight
 * in someone's local zone.
 */
function dayOf(x: Date): number {
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

export type DueDateView = {
  label: string;
  /** Past due and not in a terminal state. */
  overdue: boolean;
  /** Due today (UTC). Distinct from overdue — worth attention, not alarm. */
  dueToday: boolean;
  /** No date set. An explicit state, never a blank cell. */
  absent: boolean;
};

/**
 * A due date, plus whether it has passed.
 *
 * ⚠️ `now` is a PARAMETER with no default, and callers must pass it from a
 * stable source — not `Date.now()` inside a render.
 *
 * "Overdue" is a comparison against the current time, and the server clock and
 * the browser clock are never the same instant. Computing it during render is
 * the `Date.now()` hydration bug listed under "Known violations" in CLAUDE.md:
 * a row on the boundary renders "overdue" on one side and not the other, and
 * React drops the subtree. Resolve `now` once, above the tree, and pass it down.
 */
export function formatDueDate(
  due: string | null,
  now: Date,
  opts: { terminal?: boolean } = {}
): DueDateView {
  if (!due) return { label: 'no date', overdue: false, dueToday: false, absent: true };

  const d = new Date(due.length === 10 ? `${due}T00:00:00Z` : due);
  if (Number.isNaN(d.getTime())) {
    return { label: due, overdue: false, dueToday: false, absent: false };
  }

  const dueDay = dayOf(d);
  const today = dayOf(now);

  return {
    label: formatDateOnly(due),
    // A done/cancelled item is not overdue — it is finished. Flagging it red
    // would fill the board with alarm about work that is already closed.
    overdue: !opts.terminal && dueDay < today,
    dueToday: !opts.terminal && dueDay === today,
    absent: false
  };
}
