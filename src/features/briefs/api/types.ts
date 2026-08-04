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
  /** Briefs CREATED by this person since Monday. */
  created: number;
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
