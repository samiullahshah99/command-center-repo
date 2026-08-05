/**
 * Department health — rule A.
 *
 * ⚠️ PURE. No `db`, no `auth()`, no clock of its own. That is deliberate and it
 * is why this file has no `server-only` marker: it is safe in a client component,
 * safe in a test, and safe in a server aggregate. The caller supplies both the
 * items and `now`.
 *
 * ⚠️ NOT WIRED INTO ANY SCREEN YET, on purpose. Rule A is a working decision
 * (2026-08-06) with team-lead confirmation pending, and health is the Control
 * Tower's headline signal — the number a founder reads every morning. The
 * thresholds below are named constants so a confirmation-or-tweak is a one-line
 * change rather than a hunt through query text.
 *
 * ⚠️ NOT A COLUMN, and deliberately not stored. `department` has no `health`
 * column: a stored status is a second source of truth that can disagree with the
 * items it was derived from, and the only way to check it would be to re-derive
 * it — which is this function. Same reasoning as `brief-fold.ts`. If this ever
 * proves too slow to compute on read, materialise it THEN, with a correct answer
 * to check against.
 *
 * ── Rule A ──────────────────────────────────────────────────────────────────
 *   bad              any active item overdue by MORE THAN OVERDUE_BAD_DAYS,
 *                    OR at least BLOCKED_BAD_COUNT blocked items
 *   needs_attention  any active item overdue at all, blocked, or at risk
 *   good             otherwise
 */

/**
 * Overdue days beyond which a department is `bad`. STRICTLY greater than.
 *
 * ⚠️ Overdue by exactly 3 days is therefore NOT bad — it is `needs_attention`.
 * A test pins that boundary, because ">" and ">=" read identically at a glance
 * and the difference is a whole state on the Control Tower.
 */
export const OVERDUE_BAD_DAYS = 3;

/**
 * Blocked-item count at which a department is `bad`. AT LEAST this many.
 *
 * ⚠️ Exactly 1 blocked item is therefore NOT bad — one blocker is ordinary work,
 * two is a pattern. Also pinned by a test.
 */
export const BLOCKED_BAD_COUNT = 2;

/**
 * Statuses that mean "no longer needs attention", so they are excluded from
 * every count below.
 *
 * ⚠️ Declared here rather than imported from the tracker feature: that module is
 * `'use server'`, so every export must be an async function and a plain
 * constant cannot cross the boundary. Kept in sync with `TERMINAL` in
 * src/features/tracker/api/service.ts by hand — both derive from
 * TRACKED_ITEM_STATUSES.
 */
export const TERMINAL_STATUSES = ['done', 'cancelled'] as const;

export const DEPT_HEALTH_STATUSES = ['good', 'needs_attention', 'bad'] as const;
export type DeptHealthStatus = (typeof DEPT_HEALTH_STATUSES)[number];

/**
 * The minimum an item must expose to be scored.
 *
 * Structurally typed, so a `tracked_item` row, a DTO, or a test literal all fit
 * without a mapping step.
 */
export type DeptHealthItem = {
  /** A `tracked_item.status` value. Unknown values count as active. */
  status: string;
  /** `Date`, ISO string, or null for "no due date" (never overdue). */
  dueDate: Date | string | null;
  riskFlag?: boolean | null;
};

export type DeptHealth = {
  status: DeptHealthStatus;
  /**
   * Why, worst trigger first. Empty exactly when status is `good`.
   *
   * Written for a human reading a department card, and it names the threshold it
   * crossed — "overdue by 5 days" beats "has overdue items" when the reader's
   * next question is always "how bad?".
   */
  reasons: string[];
};

/** UTC midnight of a date, as epoch ms. */
function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole days overdue: 0 when due today, 1 when due yesterday, negative when due
 * in the future.
 *
 * ⚠️ COMPARED ON UTC DAY BOUNDARIES, not by subtracting timestamps. An item due
 * "today" is stored at 00:00 and would be a fraction of a day "past" by any
 * instant-based comparison — so a due-today item would flip a department to
 * `needs_attention` the moment the seed finished running. Day arithmetic makes
 * due-today mean 0 days overdue for the whole day, and 1 tomorrow.
 */
function overdueDaysOf(due: Date, now: Date): number {
  return Math.round((startOfUtcDay(now) - startOfUtcDay(due)) / MS_PER_DAY);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Score one department's items.
 *
 * ⚠️ `now` IS A REQUIRED PARAMETER, never `new Date()` inside. Two reasons, and
 * both have bitten this repo:
 *
 *   1. Purity — a function that reads the clock cannot be tested against a
 *      boundary, and the boundaries here (exactly 3 days, exactly 1 blocked) are
 *      the whole point.
 *   2. Hydration — a clock read during render differs between the server and the
 *      browser by construction, and React discards the mismatched subtree. That
 *      presented once as a data table rendering its toolbar and row count with no
 *      rows, which reads exactly like a failed fetch. `formatDueDate(due, now)`
 *      takes `now` for the same reason. Resolve it ONCE above the tree.
 */
export function computeDeptHealth(items: readonly DeptHealthItem[], now: Date): DeptHealth {
  const terminal = new Set<string>(TERMINAL_STATUSES);
  const active = items.filter((i) => !terminal.has(i.status));

  let overdueCount = 0;
  let worstOverdueDays = 0;
  let blockedCount = 0;
  let atRiskCount = 0;

  for (const item of active) {
    if (item.status === 'blocked') blockedCount += 1;
    if (item.riskFlag) atRiskCount += 1;

    if (item.dueDate === null || item.dueDate === undefined) continue;
    const days = overdueDaysOf(toDate(item.dueDate), now);
    // >= 1: due today is not overdue.
    if (days >= 1) {
      overdueCount += 1;
      if (days > worstOverdueDays) worstOverdueDays = days;
    }
  }

  const reasons: string[] = [];

  // ── bad ───────────────────────────────────────────────────────────────────
  const badlyOverdue = worstOverdueDays > OVERDUE_BAD_DAYS;
  const badlyBlocked = blockedCount >= BLOCKED_BAD_COUNT;

  if (badlyOverdue || badlyBlocked) {
    // Both triggers are reported when both fired — a department that is bad for
    // two independent reasons is a different conversation from one that is bad
    // for one, and the card has room for both lines.
    if (badlyOverdue) {
      reasons.push(
        `${plural(overdueCount, 'item', 'items')} overdue, worst by ${plural(worstOverdueDays, 'day', 'days')} (over the ${OVERDUE_BAD_DAYS}-day limit)`
      );
    }
    if (badlyBlocked) {
      reasons.push(`${plural(blockedCount, 'blocked item', 'blocked items')}`);
    }
    if (atRiskCount > 0) {
      reasons.push(`${plural(atRiskCount, 'item', 'items')} flagged at risk`);
    }
    return { status: 'bad', reasons };
  }

  // ── needs_attention ───────────────────────────────────────────────────────
  if (overdueCount > 0) {
    reasons.push(
      `${plural(overdueCount, 'item', 'items')} overdue, worst by ${plural(worstOverdueDays, 'day', 'days')}`
    );
  }
  if (blockedCount > 0) {
    reasons.push(`${plural(blockedCount, 'blocked item', 'blocked items')}`);
  }
  if (atRiskCount > 0) {
    reasons.push(`${plural(atRiskCount, 'item', 'items')} flagged at risk`);
  }

  if (reasons.length > 0) return { status: 'needs_attention', reasons };

  // ── good ──────────────────────────────────────────────────────────────────
  return { status: 'good', reasons: [] };
}
