import type { TrackedItemStatus } from '@/db/schema/tracked-item';

/**
 * Item state → semantic token, for a row's status dot and its label.
 *
 * ⚠️ PURE and no `server-only` marker: three client surfaces render these — the
 * person profile's task list, My day's action items and the shared meeting card.
 * No `db`, no clock, no randomness.
 *
 * ⚠️ MOVED HERE FROM `features/person-profile/constants/profile-options.ts` when
 * My day became a third consumer. CLAUDE.md: "if two features need the same
 * behaviour, it belongs in src/lib or the DB layer, not in an import between
 * them." That file re-exports these so its own components keep working.
 *
 * ⚠️ ONE mapping for the dot AND the label, so the two can never disagree. They
 * read as two independent signals when they do, and the reader trusts neither.
 */
export type RowTone = 'done' | 'destructive' | 'warning' | 'muted';

export const ROW_TONE: Record<RowTone, { dot: string; text: string }> = {
  done: { dot: 'bg-success', text: 'text-success-muted-foreground' },
  destructive: { dot: 'bg-destructive', text: 'text-destructive' },
  warning: { dot: 'bg-warning', text: 'text-warning-muted-foreground' },
  muted: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' }
};

/** What a row's tone and label are computed from. */
export type RowToneInput = {
  status: TrackedItemStatus;
  /** Whether the due date has passed — from `formatDueDate(due, now).overdue`. */
  overdue: boolean;
  riskFlag: boolean;
};

/**
 * Which tone a task row gets.
 *
 * ⚠️ ORDER IS THE PRIORITY ORDER, and `done` wins first. A completed item that
 * happens to have a past due date is finished, not late — colouring it red fills
 * the page with alarm about closed work, which is the fastest way to train
 * someone to ignore red. Same reasoning as `formatDueDate`'s `terminal` option.
 */
export function rowTone(input: RowToneInput): RowTone {
  if (input.status === 'done' || input.status === 'cancelled') return 'done';
  if (input.status === 'blocked' || input.overdue) return 'destructive';
  if (input.riskFlag) return 'warning';
  return 'muted';
}

/** Label for a row's state, matching the tone above. */
export function rowStateLabel(input: RowToneInput): string {
  if (input.status === 'done') return 'Done';
  if (input.status === 'cancelled') return 'Cancelled';
  if (input.status === 'blocked') return 'Blocked';
  // Overdue outranks the plain status label: "3 days late" is the fact the reader
  // needs, and "Open" beside a red dot reads as a rendering bug.
  if (input.overdue) return 'Overdue';
  if (input.riskFlag) return 'At risk';
  return input.status === 'in_progress' ? 'In progress' : 'Open';
}
