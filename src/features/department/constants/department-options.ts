import type { ProjectStatus } from '@/db/schema/project';
import type { BriefState, DeptHealthStatus } from '../api/types';

/** Health badge wording — identical to the Control Tower and My team. */
export const HEALTH_LABEL: Record<DeptHealthStatus, string> = {
  good: 'On track',
  needs_attention: 'Needs attention',
  bad: 'At risk'
};

/** ⚠️ `border-current` so the border tracks the text colour — one class, not two. */
export const HEALTH_BADGE: Record<DeptHealthStatus, string> = {
  good: 'text-success-muted-foreground border-current',
  needs_attention: 'text-warning-muted-foreground border-current',
  bad: 'text-destructive border-current'
};

/** Project status → the Control Tower's vocabulary, so the two screens agree. */
export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: string }> = {
  active: { label: 'In flight', tone: 'text-muted-foreground' },
  paused: { label: 'Paused', tone: 'text-warning-muted-foreground' },
  complete: { label: 'Done', tone: 'text-success-muted-foreground' },
  archived: { label: 'Archived', tone: 'text-muted-foreground' }
};

/**
 * Brief lifecycle state → label + tone.
 *
 * ⚠️ `sent_back` is the only amber: it is stalled work waiting on a named person.
 * `in_review` is ordinary progress, and colouring it would put alarm on the normal
 * path.
 */
export const BRIEF_STATE_META: Record<BriefState, { label: string; tone: string }> = {
  in_progress: { label: 'In progress', tone: 'text-muted-foreground' },
  in_review: { label: 'In review', tone: 'text-muted-foreground' },
  sent_back: { label: 'Sent back', tone: 'text-warning-muted-foreground' },
  approved: { label: 'Approved', tone: 'text-success-muted-foreground' }
};
