import type { DeptHealthStatus } from '@/lib/dept-health';
import type { AgentCadence } from '../api/types';

/** Health badge wording, matching the Control Tower's cards. */
export const HEALTH_LABEL: Record<DeptHealthStatus, string> = {
  good: 'On track',
  needs_attention: 'Needs attention',
  bad: 'At risk'
};

/**
 * Health badge tone.
 *
 * ⚠️ `border-current` so the border tracks the text colour — a tone change is one
 * class, not two that can disagree. Same treatment as `TagPill` and the Control
 * Tower's department cards.
 */
export const HEALTH_BADGE: Record<DeptHealthStatus, string> = {
  good: 'text-success-muted-foreground border-current',
  needs_attention: 'text-warning-muted-foreground border-current',
  bad: 'text-destructive border-current'
};

/**
 * Agent ADHERENCE → label + tone.
 *
 * ⚠️ NOT `recurring_task.cadence`. That column is a repetition interval
 * (`daily | weekly | …`); this is whether an agent is keeping up. Two different
 * concepts share the word "cadence" across adjacent screens — see the note on
 * `AgentCadence` in ../api/types.ts.
 *
 * ⚠️ `ahead` is MUTED, not success. Green on "ahead" turns the table into a
 * leaderboard, and this page is a manager's view of real colleagues — the only
 * value worth colouring is the one that needs action.
 */
export const CADENCE_META: Record<AgentCadence, { label: string; tone: string }> = {
  on_track: { label: 'On track', tone: 'text-success-muted-foreground' },
  behind: { label: 'Behind', tone: 'text-destructive' },
  ahead: { label: 'Ahead', tone: 'text-muted-foreground' }
};
