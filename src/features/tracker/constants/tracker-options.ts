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
export const STATUS_META: Record<TrackedItemStatus, { label: string; dot: string; badge: string }> =
  {
    open: {
      label: 'Open',
      dot: 'bg-slate-400',
      badge: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300'
    },
    in_progress: {
      label: 'In progress',
      dot: 'bg-sky-500',
      badge: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    },
    blocked: {
      label: 'Blocked',
      dot: 'bg-red-500',
      badge: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
    },
    done: {
      label: 'Done',
      dot: 'bg-emerald-500',
      badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    },
    cancelled: {
      label: 'Cancelled',
      dot: 'bg-muted-foreground/40',
      badge: 'text-muted-foreground'
    }
  };

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; badge: string }> = {
  active: {
    label: 'Active',
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  },
  paused: {
    label: 'Paused',
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'
  },
  complete: {
    label: 'Complete',
    badge: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
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
