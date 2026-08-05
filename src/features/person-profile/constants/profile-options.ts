import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import type { ActivityGap, MeetingActionState } from '../api/types';

/**
 * Stable per-person avatar tint.
 *
 * ⚠️ Hashes the person's ID, not their name. The sidebar's user chip hashes a
 * display name because it may have no person id to hand; here we do, and an id
 * never changes — so correcting a spelling cannot recolour someone. That was the
 * specific objection recorded on `InitialsAvatar`, and this answers it.
 *
 * ⚠️ Returns a TOKEN REFERENCE, never a colour. `var(--chart-2)` follows the
 * active theme through light and dark; a hex would be right in one mode and wrong
 * in the other, which is the bug the theme adoption removed everywhere else.
 *
 * FNV-1a, matching @/lib/dept-accent — deliberately duplicated rather than
 * shared: a person is not a department, and the two palettes may diverge without
 * either dragging the other.
 */
export function personAccentVar(personId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < personId.length; i += 1) {
    hash ^= personId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `var(--chart-${(hash % 5) + 1})`;
}

/**
 * Item state → semantic token, for the 16px row dot and the status label.
 *
 * ⚠️ ONE mapping for both, so a dot and its label can never disagree — they read
 * as two independent signals when they do, and the reader trusts neither.
 *
 * ⚠️ `overdue` and `at_risk` are NOT `tracked_item.status` values. Status is
 * `open | in_progress | blocked | done | cancelled`; overdue is a due-date
 * comparison and at-risk is the `risk_flag` boolean. They are folded in here
 * because the mockup renders one dot per row — see `rowTone()`.
 */
export type RowTone = 'done' | 'destructive' | 'warning' | 'muted';

export const ROW_TONE: Record<RowTone, { dot: string; text: string }> = {
  done: { dot: 'bg-success', text: 'text-success-muted-foreground' },
  destructive: { dot: 'bg-destructive', text: 'text-destructive' },
  warning: { dot: 'bg-warning', text: 'text-warning-muted-foreground' },
  muted: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' }
};

/**
 * Which tone a task row gets.
 *
 * ⚠️ ORDER IS THE PRIORITY ORDER, and `done` wins first. A completed item that
 * happens to have a past due date is finished, not late — colouring it red fills
 * the page with alarm about closed work, which is the fastest way to train
 * someone to ignore red. Same reasoning as `formatDueDate`'s `terminal` option.
 */
export function rowTone(input: {
  status: TrackedItemStatus;
  overdue: boolean;
  riskFlag: boolean;
}): RowTone {
  if (input.status === 'done' || input.status === 'cancelled') return 'done';
  if (input.status === 'blocked' || input.overdue) return 'destructive';
  if (input.riskFlag) return 'warning';
  return 'muted';
}

/** Label for a row's state, matching the tone above. */
export function rowStateLabel(input: {
  status: TrackedItemStatus;
  overdue: boolean;
  riskFlag: boolean;
}): string {
  if (input.status === 'done') return 'Done';
  if (input.status === 'cancelled') return 'Cancelled';
  if (input.status === 'blocked') return 'Blocked';
  // Overdue outranks the plain status label: "3 days late" is the fact the reader
  // needs, and "Open" beside a red dot reads as a rendering bug.
  if (input.overdue) return 'Overdue';
  if (input.riskFlag) return 'At risk';
  return input.status === 'in_progress' ? 'In progress' : 'Open';
}

/** Meeting action state → the same tone vocabulary. */
export const MEETING_ACTION_TONE: Record<MeetingActionState, RowTone> = {
  open: 'muted',
  in_progress: 'warning',
  done: 'done'
};

export const MEETING_ACTION_LABEL: Record<MeetingActionState, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done'
};

/**
 * Source badge styling for the activity strip.
 *
 * ⚠️ NEUTRAL, DELIBERATELY — this was five per-vendor hues (violet / sky /
 * orange / emerald / cyan) and both halves of that were wrong.
 *
 * Mechanically: hardcoded palette values render light chips on a dark surface,
 * which is the exact bug the semantic-token adoption fixed everywhere else.
 *
 * More importantly, they were spending COLOUR ON A CATEGORY. Everywhere else in
 * the portal, colour means "this needs you" — amber is a stalled hand-off, red is
 * blocked or overdue. A strip of five vendor hues sitting next to those trains
 * the eye to ignore colour, and the next genuinely urgent amber gets read as
 * decoration. Which system an event came from is carried by the badge's TEXT,
 * which is where anyone reads it anyway.
 *
 * The map is kept rather than deleted so a source can be given a deliberate
 * treatment later without hunting call sites.
 */
export const SOURCE_BADGE: Record<string, string> = {
  slack: 'text-muted-foreground',
  clickup: 'text-muted-foreground',
  fireflies: 'text-muted-foreground',
  ugc: 'text-muted-foreground',
  vision: 'text-muted-foreground'
};

/**
 * ⚠️ Empty-state copy is ACTION-SHAPED where there is an action.
 *
 * "No recent activity" is a dead end. Naming the actual cause — no linked
 * accounts — and the place to fix it turns the gap into the next task, which is
 * the difference between a panel that looks broken and one that recruits help.
 * Most of the roster is in this state today: 168 events sit against identities
 * nobody has linked yet.
 */
export function activityEmptyCopy(gap: ActivityGap, name: string): string | null {
  switch (gap) {
    case 'no_identities':
      return `No linked accounts for ${name}. Link their Slack, Vision or UGC accounts to see activity here.`;
    case 'no_recent_events':
      return `No recent activity recorded for ${name}.`;
    default:
      return null;
  }
}
