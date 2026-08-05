import type { BriefRow, WeeklyPerformanceView } from '@/lib/brief-view';
import type { BriefState } from '../constants/brief-states';

export type { BriefState };

/**
 * Who acted on a brief.
 *
 * ⚠️ `linked` is false for EVERY brief on current data: `person_identity_id` is
 * set on all 165 brief events but `person_id` is set on none, so no brief can be
 * attributed to a `person` row yet. The name still resolves — through
 * `person_identity.editor_name` / `display_name` — and is marked unlinked.
 *
 * ⚠️ Vision's `editor_name` is DISPLAY-ONLY and mutable (CLAUDE.md). An unlinked
 * strategist gets no identity colour and is never treated as a person: a display
 * name is not an identity, and two people can share one.
 */
export type BriefActor = {
  /** person.id when the identity has been linked, else null. */
  personId: string | null;
  name: string;
  linked: boolean;
};

export type BriefCard = {
  /** Vision's `subject.id`. */
  id: string;
  /**
   * Vision's `subject.label`, shown verbatim — e.g. "#2 — Ronin Launch".
   *
   * ⚠️ NOT UNIQUE. Twelve of seventeen observed briefs share a label with
   * another brief ("#4 — Untitled brief" covers three distinct ids), so the UI
   * must show `idFragment` alongside it or the board reads as duplicated rows.
   * Upstream naming hygiene is the real fix.
   */
  label: string | null;
  /** Short, stable slice of `id` used only to disambiguate colliding labels. */
  idFragment: string;
  state: BriefState;
  /** When the event that set the CURRENT state occurred. */
  stateEnteredAt: string;
  strategist: BriefActor | null;
  /**
   * `min(occurred_at)` — FIRST OBSERVED, not true creation. Two briefs have no
   * `brief.created` event at all (we only see events from when the webhook was
   * wired), so this must never be presented as "created".
   */
  firstObservedAt: string;
  lastActivityAt: string;
  eventCount: number;
};

export type BriefBoard = {
  cards: BriefCard[];
  /** Distinct production briefs, before any grouping. */
  total: number;
  /**
   * Resolved ONCE on the server. Every "days in state" and relative label
   * derives from it — a per-render clock differs between SSR and hydration.
   */
  now: string;
};

export type BriefTimelineEntry = {
  id: string;
  eventType: string;
  occurredAt: string;
  actor: BriefActor | null;
  /** `metadata.fields[]` on brief.updated — rendered as "edited: voiceover, hook". */
  fields: string[];
};

export type BriefTimeline = {
  briefId: string;
  label: string | null;
  entries: BriefTimelineEntry[];
  now: string;
};

// ── Step 5: weekly brief quota ───────────────────────────────────────────────

export type QuotaRow = {
  personId: string;
  /**
   * Briefs SUBMITTED by this person since Monday.
   *
   * ⚠️ RENAMED FROM `created` ON 2026-08-06, and the underlying event changed with
   * it. Decision 6 says the quota counts APPROVED briefs; Vision emits no
   * `brief.approved` event at all (escalated to the platform owner), so submissions
   * are the closest measurable proxy to the decision. Counting `brief.created`
   * measured briefs STARTED, which is a different thing and was flagged as a
   * mismatch in audit D9.
   *
   * ⚠️ THE FIELD WAS RENAMED DELIBERATELY rather than left as `created` with new
   * contents. A field whose name says "created" holding submissions is how the next
   * reader draws a wrong conclusion from a correct number.
   */
  submitted: number;
  /** From role_profile.quota_config.briefsPerWeek. Null = no quota configured. */
  target: number | null;
};

export type BriefQuota = {
  rows: QuotaRow[];
  /**
   * False when no role profile carries a `briefsPerWeek`. The People page renders
   * NOTHING in that case rather than an empty bar — an unconfigured quota is not
   * a zero quota, and a 0-of-0 bar reads as failure.
   */
  configured: boolean;
  /** Monday 00:00 UTC of the current week. */
  weekStart: string;
};

// ── Briefs & quota (the creative persona's home screen) ─────────────────────

/**
 * The hero card's me-scoped quota.
 *
 * ⚠️ `target` is null when no role profile configures `briefsPerWeek` — the case
 * today. An unconfigured quota is NOT a zero quota: the UI shows the submitted
 * count alone, with no bar and no "/ target", because a 0-of-0 bar reads as
 * failure against a target nobody set.
 */
export type MyQuota = {
  submitted: number;
  target: number | null;
  /** ISO week label, e.g. "W32". */
  week: string;
  /** Monday 00:00 UTC, ISO. */
  weekStart: string;
  /**
   * ⚠️ INVENTED, and null whenever `target` is null.
   *
   * The mockup's nudge is calendar-aware ("2 to go before Friday — writing blocks
   * Mon & Wed on your calendar"). Calendar has no code at all (audit §2.12), so the
   * line is a placeholder carrying `nudgeIsSample`. A nudge toward a target nobody
   * set is noise, so it is omitted entirely when unconfigured.
   */
  nudge: string | null;
  /** ⚠️ True whenever `nudge` is non-null. */
  nudgeIsSample: boolean;
};

/** Mean days from a brief's created event to its submitted event. */
export type Turnaround = {
  /** Null when no brief has both events in the window — renders "—". */
  avgDays: number | null;
  /** How many briefs contributed. Zero is an honest answer, not an error. */
  sampleSize: number;
};

/**
 * ⚠️ WHOLLY INVENTED. `BRIEF_STATES` has no `in_testing` or `winner`, there is no
 * ad-testing table and no source emits one (audit §2.12). Carries `isSample` so the
 * card cannot render without its caption.
 */
export type AdTesting = {
  inTesting: number;
  winners: string[];
  isSample: boolean;
};

export type BriefsQuotaScreen = {
  /** Shared with the department page — same fold, same builder. */
  backlog: BriefRow[];
  /** Shared with the department page — same fold, same builder. */
  performance: WeeklyPerformanceView;
  quota: MyQuota;
  turnaround: Turnaround;
  adTesting: AdTesting;
  /** Resolved ONCE on the server; every date comparison derives from it. */
  now: string;
};
