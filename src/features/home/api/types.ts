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

  team: TeamMember[];
  identitiesUnlinked: number;

  /**
   * Resolved ONCE on the server. Every relative label and day-count on the page
   * derives from it — a per-render clock differs between SSR and hydration and
   * React discards the subtree.
   */
  now: string;
};
