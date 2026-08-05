import type { ActivityGap } from '../api/types';

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
