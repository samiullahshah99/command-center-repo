import type { BriefState } from '@/lib/brief-states';

/**
 * ⚠️ EVERY FIELD HERE COMES FROM A REAL QUERY. There is no placeholder, no
 * sample, no "—" standing in for a number we did not fetch. The page this feeds
 * is read by the founder to answer "what needs my attention", so a number that
 * is not true is worse than no number: it either invents urgency or hides it.
 */

/** Severity drives ordering: red before amber before unowned. */
export type AttentionSeverity = 'red' | 'amber' | 'unowned';

export type AttentionRow = {
  key: string;
  kind: 'brief_sent_back' | 'brief_in_review' | 'candidate_unowned';
  severity: AttentionSeverity;
  /** Brief label, or a truncated candidate description. Shown verbatim. */
  title: string;
  /** Muted secondary line — brief id fragment, or the owner-confidence tier. */
  detail: string | null;
  /** Days in current state. Null for candidates, where age is not the signal. */
  days: number | null;
  actorName: string | null;
  actorLinked: boolean;
  href: string;
};

export type PipelineCounts = Record<BriefState, number>;

export type TeamMember = {
  id: string;
  name: string;
  initials: string;
  /** True when an ATTRIBUTED unified_event landed in the last 24h. */
  active24h: boolean;
};

export type ActivityDay = { day: string; count: number };

/** Monday-anchored capture totals for the Control Tower's stat row. */
export type WeeklyCapture = {
  /** `candidate_action_item` rows created since Monday 00:00 UTC. */
  captured: number;
  /** Of those, from a Fireflies-sourced `unified_event`. */
  fromMeetings: number;
  /** Of those, from a Slack-sourced `unified_event`. */
  fromSlack: number;
  /**
   * ⚠️ INVENTED. The completion engine does not exist: `completion_event` has 0
   * rows and NO WRITER, and nothing evaluates `recurring_task.auto_complete_rule`.
   * This is a shaped placeholder so the card has its fourth row, and the UI
   * renders a caption from `autoCompletedIsSample`. See docs/gaps.md.
   *
   * ⚠️ NEVER fix this by seeding `completion_event`. Seeding it would make a
   * fabricated number indistinguishable from a measured one at the database
   * level, which is strictly worse than a labelled placeholder.
   */
  autoCompleted: number;
  /** ⚠️ TRUE TODAY, ALWAYS. The flag travels with the number. */
  autoCompletedIsSample: boolean;
  /** Monday 00:00 UTC, ISO. */
  weekStart: string;
};

/** One department health card. Mirrors `DeptNavRow` minus the sidebar-only bits. */
export type DeptCard = {
  id: string;
  name: string;
  /** Theme token reference, e.g. `var(--chart-3)`. Never a colour literal. */
  accentVar: string;
  health: 'good' | 'needs_attention' | 'bad';
  /** `computeDeptHealth` reasons, worst first. Empty exactly when `good`. */
  healthReasons: string[];
  openCount: number;
  peopleCount: number;
};

export type ProjectRow = {
  id: string;
  name: string;
  ownerName: string | null;
  /** 0–100, terminal items over total. Null when the project has no items. */
  progressPct: number | null;
  openCount: number;
  totalCount: number;
  /** `active | paused | complete` — `archived` is filtered out upstream. */
  status: 'active' | 'paused' | 'complete';
};

export type HomeSnapshot = {
  /**
   * Worst-first, already sorted and capped by the service. `attentionTotal` is
   * the uncapped count so the UI can say "+N more" truthfully.
   */
  attention: AttentionRow[];
  attentionTotal: number;

  reviewPending: number;
  /** ISO of the oldest pending candidate, or null when there are none. */
  reviewOldestAt: string | null;

  activity: ActivityDay[];
  activityTotal: number;
  lastEvent: { source: string; at: string } | null;

  pipeline: PipelineCounts;

  /**
   * This week's capture, Monday-anchored.
   *
   * ⚠️ ONE FIELD HERE IS MOCKED and it is marked — see `autoCompleted`. Every
   * other number is a real count.
   */
  weekly: WeeklyCapture;

  /**
   * Department health cards.
   *
   * ⚠️ SAME SOURCE AS THE SIDEBAR'S DOTS — both come from `getDeptNav()` in
   * `@/lib/dept-nav`, which shares one query and one `computeDeptHealth` call.
   * A dot and a card must never disagree about a department.
   */
  departments: DeptCard[];

  /** Active projects, newest-relevant first. */
  projects: ProjectRow[];

  team: TeamMember[];
  identitiesUnlinked: number;

  /**
   * Resolved ONCE on the server. Every relative label and day-count on the page
   * derives from it — a per-render clock differs between SSR and hydration and
   * React discards the subtree.
   */
  now: string;
};
