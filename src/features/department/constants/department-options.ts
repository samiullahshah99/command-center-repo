import type { ProjectStatus } from '@/db/schema/project';
import type { DeptHealthStatus } from '../api/types';

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

// ⚠️ BRIEF_STATE_META moved to @/lib/brief-view when the Briefs & quota screen
// became a second consumer of the same table.
