import type { ActivityGap } from '../api/types';

/** Source badge styling for the activity strip. */
export const SOURCE_BADGE: Record<string, string> = {
  slack: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  clickup: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  fireflies: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  ugc: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  vision: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
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
