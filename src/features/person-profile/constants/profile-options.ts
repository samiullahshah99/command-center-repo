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
