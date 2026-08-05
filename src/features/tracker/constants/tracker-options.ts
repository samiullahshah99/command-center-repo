import { TRACKED_ITEM_STATUSES, type TrackedItemStatus } from '@/db/schema/tracked-item';
import { PROJECT_STATUSES, type ProjectStatus } from '@/db/schema/project';
import type { ExternalSystem, OwnerConfidence } from '../api/types';

export { TRACKED_ITEM_STATUSES, PROJECT_STATUSES };

/**
 * Board lane presentation.
 *
 * Derived from TRACKED_ITEM_STATUSES so a new status cannot be renderable
 * without also being valid — the map is keyed by the union, so TypeScript fails
 * the build if one is added and not styled here.
 */
/**
 * ⚠️ ONLY THE STATUSES THAT DEMAND SOMETHING CARRY COLOUR.
 *
 * These were five saturated hues (slate / sky / red / emerald / grey). Two
 * problems: the hardcoded palette values render light chips against a dark
 * surface, which is what the semantic-token adoption existed to fix; and a lane
 * header where every status is coloured conveys nothing, because `blocked` — the
 * only one that means "a human must act" — is painted no louder than `open`.
 *
 * So the ladder is neutral weight, with two exceptions:
 *
 *   open         faint grey  — queued, nothing to do
 *   in_progress  solid grey  — someone is on it
 *   blocked      RED         — stalled, needs a human
 *   done         GREEN       — terminal, succeeded
 *   cancelled    faint grey  — terminal, no outcome
 */
export const STATUS_META: Record<TrackedItemStatus, { label: string; dot: string; badge: string }> =
  {
    open: {
      label: 'Open',
      dot: 'bg-muted-foreground/40',
      badge: 'text-muted-foreground'
    },
    in_progress: {
      label: 'In progress',
      dot: 'bg-muted-foreground/70',
      badge: 'border-muted-foreground/30 text-foreground'
    },
    blocked: {
      label: 'Blocked',
      dot: 'bg-destructive',
      badge: 'border-destructive/40 text-destructive font-semibold'
    },
    done: {
      label: 'Done',
      dot: 'bg-success',
      badge: 'border-success/30 bg-success-muted text-success-muted-foreground'
    },
    cancelled: {
      label: 'Cancelled',
      dot: 'bg-muted-foreground/40',
      badge: 'text-muted-foreground'
    }
  };

/** Same rule: `paused` is the only project state anyone needs to look at. */
export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; badge: string }> = {
  active: {
    label: 'Active',
    badge: 'border-success/30 bg-success-muted text-success-muted-foreground'
  },
  paused: {
    label: 'Paused',
    badge: 'border-warning/40 bg-warning-muted text-warning-muted-foreground'
  },
  complete: {
    label: 'Complete',
    badge: 'border-muted-foreground/30 text-foreground'
  },
  archived: { label: 'Archived', badge: 'text-muted-foreground' }
};

/** Statuses meaning "finished" — excluded from open/overdue counts. */
export const TERMINAL_STATUSES: TrackedItemStatus[] = ['done', 'cancelled'];

export function isTerminal(status: TrackedItemStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Owner confidences that were a GUESS when the item was promoted.
 *
 * ⚠️ Marked on the board deliberately. A promoted 'fuzzy' owner is a
 * name-similarity suggestion a human waved through, and it can be wrong in a way
 * that silently attributes one person's work to another — the exact failure the
 * no-name-matching rule exists to prevent. Rendering it identically to an exact
 * match hides the one thing worth a second look.
 *
 * Subtle on purpose: these items were already reviewed, so this is a marker, not
 * an alarm. Loud styling here would make the board look broken.
 */
export const UNCERTAIN_ORIGINS: OwnerConfidence[] = ['fuzzy', 'unresolved'];

export function ownerWasUncertain(c: OwnerConfidence | null): boolean {
  return c !== null && UNCERTAIN_ORIGINS.includes(c);
}

/** Where an external row can be opened, when we can build a URL for it. */
export function externalUrlFor(
  system: ExternalSystem,
  externalTaskId: string | null
): string | null {
  if (!externalTaskId) return null;
  switch (system) {
    case 'clickup':
      return `https://app.clickup.com/t/${externalTaskId}`;
    case 'notion':
      // Notion page ids are dash-less in URLs.
      return `https://www.notion.so/${externalTaskId.replace(/-/g, '')}`;
    default:
      // 'internal' has no external page, by construction — the CHECK constraint
      // guarantees external_task_id is NULL for these.
      return null;
  }
}

export const SOURCE_SYSTEM_LABEL: Record<ExternalSystem, string> = {
  internal: 'Command Center',
  notion: 'Notion',
  clickup: 'ClickUp'
};
