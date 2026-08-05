import type { DeptHealthStatus } from '@/lib/dept-health';

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

// ⚠️ CADENCE_META moved to @/lib/agent-performance (AGENT_CADENCE_META) when the
// department page became a second consumer of the same table.
