import type { BriefState } from './brief-states';
// ⚠️ TYPE-ONLY import from a `server-only` module. Erased at compile time, so it
// never reaches a bundle — the boundary checker documents this exemption
// explicitly. Do not turn it into a value import.
import type { FoldedBrief } from './brief-fold';

/**
 * Brief presentation types and the PURE builders that produce them.
 *
 * ⚠️ PURE and client-safe — no `db`, no clock of its own, no `server-only`. The
 * callers fetch (`foldBriefs()`, which carries the mandatory production filter)
 * and pass the result in; these functions only shape it. That is what lets the
 * same builders serve the department page and the creative Briefs & quota screen
 * without either importing the other.
 *
 * ⚠️ Lives in src/lib because TWO features build these rows. CLAUDE.md: shared
 * behaviour belongs here, not in an import between features.
 */

/** One row of the brief backlog table. */
export type BriefRow = {
  id: string;
  title: string;
  /**
   * ⚠️ ALWAYS "—". Vision carries NO product field on a brief (audit §3.1). The
   * column exists because the mockup has it; inventing a value would be worse than
   * an em dash. Logged in docs/gaps.md.
   */
  product: string;
  /** Real where the actor resolved; "—" otherwise. ⚠️ NEVER guessed. */
  owner: string;
  /** Whole days since FIRST OBSERVED — not created; two briefs have no create event. */
  ageDays: number;
  state: BriefState;
};

/** One bar of a weekly series. */
export type WeekBar = {
  /** ISO week label, e.g. "W32". */
  week: string;
  count: number;
};

export type WeeklyPerformanceView = {
  bars: WeekBar[];
  /**
   * Team-wide `role_profile.quota_config.briefsPerWeek`, summed.
   *
   * ⚠️ NULL when nothing configures one — the case today, every `quota_config`
   * being `{}`. An unconfigured quota is NOT a zero quota, so bars render neutral
   * rather than all-below-target. Colouring against a threshold nobody set would be
   * a fabricated judgement.
   */
  quota: number | null;
  /**
   * ⚠️ TRUE while the series counts SUBMISSIONS instead of approvals.
   *
   * Decision 6 (2026-08-06) says the quota counts APPROVED briefs. The live Vision
   * catalogue emits **no `brief.approved` event at all**, so an approvals series
   * would be six empty bars — which reads as a broken chart rather than a data gap.
   * Submissions are the closest measurable proxy. Escalated to the platform owner;
   * flip this to false and count approvals the day the event exists.
   */
  usesSubmittedFallback: boolean;
};

/**
 * Brief lifecycle state → label + tone.
 *
 * ⚠️ `sent_back` is the ONLY amber: it is stalled work waiting on a named person.
 * `in_review` is ordinary progress, and colouring it would put alarm on the normal
 * path.
 */
export const BRIEF_STATE_META: Record<BriefState, { label: string; tone: string }> = {
  in_progress: { label: 'In progress', tone: 'text-muted-foreground' },
  in_review: { label: 'In review', tone: 'text-muted-foreground' },
  sent_back: { label: 'Sent back', tone: 'text-warning-muted-foreground' },
  approved: { label: 'Approved', tone: 'text-success-muted-foreground' }
};

/** Weeks the performance chart covers. */
export const PERF_WEEKS = 6;

function utcDay(x: Date): number {
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

/** Monday 00:00 UTC of the week containing `d`. Sunday counts as the prior week. */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

/** ISO week label — "W32". */
export function isoWeekLabel(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of this week decides the ISO year/week.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `W${week}`;
}

/**
 * The backlog: non-terminal briefs, oldest first.
 *
 * ⚠️ `approved` is excluded — it is the end of the lifecycle, so an approved brief
 * is not backlog.
 *
 * ⚠️ `now` is a PARAMETER. A clock read inside would differ between SSR and
 * hydration and React would discard the subtree.
 */
export function buildBriefBacklog(folded: FoldedBrief[], now: Date): BriefRow[] {
  const today = utcDay(now);

  return folded
    .filter((b) => b.state !== 'approved')
    .map((b) => ({
      id: b.id,
      title: b.label ?? 'Untitled brief',
      product: '—',
      // Real where the actor resolved, "—" otherwise. NEVER guessed: two people can
      // share a display name and a wrong attribution is silent.
      owner: b.actorName ?? '—',
      ageDays: Math.max(0, Math.round((today - utcDay(new Date(b.firstObservedAt))) / 86_400_000)),
      state: b.state
    }))
    .toSorted((a, b) => b.ageDays - a.ageDays);
}

/**
 * The last `PERF_WEEKS` weeks of submissions.
 *
 * ⚠️ Counts briefs whose CURRENT state is `in_review`, bucketed by
 * `stateEnteredAt` — the submitted-proxy described on `usesSubmittedFallback`.
 *
 * ⚠️ Bucketing from the FOLD reflects each brief's current state, so a brief
 * submitted in W31 and sent back in W32 counts in NEITHER. That under-counts
 * rather than inventing; a true series needs transition replay, not a fold.
 */
export function buildWeeklySeries(
  folded: FoldedBrief[],
  now: Date,
  quota: number | null
): WeeklyPerformanceView {
  const weekStarts: Date[] = [];
  const thisMonday = mondayOf(now);
  for (let i = PERF_WEEKS - 1; i >= 0; i -= 1) {
    const d = new Date(thisMonday);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weekStarts.push(d);
  }

  const counts = new Map<number, number>(weekStarts.map((d) => [d.getTime(), 0]));
  for (const b of folded) {
    if (b.state !== 'in_review') continue;
    const wk = mondayOf(new Date(b.stateEnteredAt)).getTime();
    if (counts.has(wk)) counts.set(wk, (counts.get(wk) ?? 0) + 1);
  }

  return {
    bars: weekStarts.map((d) => ({ week: isoWeekLabel(d), count: counts.get(d.getTime()) ?? 0 })),
    quota,
    usesSubmittedFallback: true
  };
}
