import { z } from 'zod';
import { LIFECYCLE_EVENT_STATE, type BriefState } from '@/lib/brief-states';

/**
 * Brief lifecycle, DERIVED — Vision has no status field.
 *
 * ⚠️ STATE IS A PURE FUNCTION OF THE EVENT LOG, folded at query time. Nothing
 * stores it. That is deliberate: a stored state is a second source of truth that
 * can disagree with the events it came from, and the only way to check would be
 * re-deriving it — which is the query anyway.
 *
 * ⚠️ CC NEVER WRITES BRIEF STATE BACK. Vision is the system of record; this
 * feature observes. There are no mutations here and there must never be one.
 */

/**
 * ⚠️ The state contract and the fold itself live in `src/lib/brief-fold.ts`, not
 * here — two features consume them (briefs board, overview), and CLAUDE.md sends
 * shared behaviour to src/lib rather than a cross-feature import. Re-exported so
 * this file stays the one import site for brief presentation.
 */
export { BRIEF_STATES, LIFECYCLE_EVENT_STATE, type BriefState } from '@/lib/brief-states';

/** Every brief event we recognise, lifecycle or not — used for the timeline. */
export const BRIEF_EVENT_TYPES = [
  ...Object.keys(LIFECYCLE_EVENT_STATE),
  'brief.commented',
  'brief.script_saved'
] as const;

export const STATE_LABEL: Record<BriefState, string> = {
  in_progress: 'In progress',
  in_review: 'In review',
  sent_back: 'Sent back',
  approved: 'Approved'
};

/**
 * Days in current state before a card is flagged.
 *
 * ⚠️ SENT BACK HAS THE TIGHTEST BAR ON PURPOSE. It is the only state where work
 * has stopped with someone waiting on a specific person — a stale sent-back
 * brief is a stalled hand-off, which is the failure this board exists to catch.
 *
 * ⚠️ IN PROGRESS HAS THE LOOSEST. `brief.updated` fires constantly — 138 of 165
 * observed events — so a brief being edited for a week is someone working, not
 * something stuck. A tight threshold here would paint the whole board amber and
 * teach people to ignore the colour.
 *
 * `approved` is terminal and never ages: flagging finished work is noise.
 */
export const STALE_DAYS: Record<BriefState, { amber: number; red: number } | null> = {
  sent_back: { amber: 2, red: 4 },
  in_review: { amber: 3, red: 7 },
  in_progress: { amber: 7, red: 14 },
  approved: null
};

/**
 * Column accent.
 *
 * ⚠️ ONLY TWO OF THE FOUR CARRY COLOUR, and that is the point. This used to be
 * four saturated hues (slate / sky / amber / emerald), which had two problems:
 * the hardcoded palette values rendered light accents against a dark surface,
 * and — worse — a board where every column is coloured tells you nothing, because
 * the two states that actually need a human are painted no louder than the two
 * that do not.
 *
 * So the lifecycle reads as increasing neutral weight, and colour is reserved:
 *
 *   in_progress  faint grey   — work is happening, nothing to do
 *   in_review    solid grey   — waiting on a reviewer, normal
 *   sent_back    AMBER        — stalled hand-off, someone is blocked
 *   approved     GREEN        — terminal, done
 *
 * Semantic tokens throughout, so both themes are correct by construction.
 */
export const STATE_ACCENT: Record<BriefState, string> = {
  in_progress: 'bg-muted-foreground/30',
  in_review: 'bg-muted-foreground/70',
  sent_back: 'bg-warning',
  approved: 'bg-success'
};

/**
 * THE `role_profile.quota_config` SHAPE this feature reads.
 *
 * The column is `jsonb` typed only as `z.record(z.string(), z.unknown())`
 * ("shape TBD as the Control Tower work lands"), so this narrows the one key
 * Step 5 needs and ignores everything else — a role profile may carry unrelated
 * quota keys later without breaking this.
 *
 * Seed it like this:
 *
 *     { "briefsPerWeek": 5 }
 *
 * ⚠️ `.catch()` rather than a throw: a malformed or absent quota must render as
 * "no quota configured", never as a crashed People page. A quota is an
 * expectation, not data integrity.
 */
export const quotaConfigSchema = z
  .object({
    /** Briefs this role is expected to CREATE per week. Omit or 0 = no quota. */
    briefsPerWeek: z.number().int().nonnegative().optional()
  })
  .catch({});

export type QuotaConfig = z.infer<typeof quotaConfigSchema>;
