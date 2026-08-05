import type { ActivityGap } from '../api/types';

/**
 * ⚠️ RE-EXPORTED, NOT DEFINED HERE ANY MORE. Row tones moved to `@/lib/row-tone`
 * and the meeting vocabulary to `@/lib/meeting-view` when My day became a third
 * consumer — CLAUDE.md: shared behaviour belongs in src/lib, not in an import
 * between features. Kept as re-exports so this feature's own components did not
 * all have to change import paths at once. New code should import from src/lib
 * directly.
 */
export { ROW_TONE, rowStateLabel, rowTone, type RowTone, type RowToneInput } from '@/lib/row-tone';
export { MEETING_ACTION_LABEL, MEETING_ACTION_TONE } from '@/lib/meeting-view';
// ⚠️ Moved to src/lib on its THIRD consumer (profile, my-team, department).
export { personAccentVar } from '@/lib/person-accent';

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
