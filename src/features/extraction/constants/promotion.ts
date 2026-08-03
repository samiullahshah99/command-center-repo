/**
 * Where a promoted action item is filed.
 *
 * ── The rule, and why it is this dumb ───────────────────────────────────────
 * A constant map from the originating `unified_event.source` to a project NAME.
 * No config UI, no inference from transcript text, no picker.
 *
 * ⚠️ EVERYTHING LANDS IN "Inbox" TODAY, AND THAT IS THE POINT. The alternative
 * was mapping `fireflies -> 'Command Center'`, which is a lie with a straight
 * face: a content-ops meeting's action items would file silently under an
 * engineering project and nobody reading the board would know the filing was
 * arbitrary. A visible triage bucket beats invisible mis-filing.
 *
 * When a real signal exists — a Notion/Ocean project mirror, or a picker in the
 * full review queue — this map changes and no data migrates.
 */

/** Project name per originating source. Add sources as connectors gain extraction. */
export const PROMOTION_PROJECT_BY_SOURCE: Record<string, string> = {
  fireflies: 'Inbox',
  slack: 'Inbox'
};

/** Used when the source is unknown or unmapped. Never null — see below. */
export const FALLBACK_PROJECT_NAME = 'Inbox';

/**
 * ⚠️ A promoted item MUST get a project.
 *
 * `/dashboard/tracker` is project-scoped: the board filters on `project_id` and
 * the projects list only counts items that have one. A `tracked_item` with a
 * null project is invisible on the only surface that is now the system of
 * record — approved, stored, and impossible to find.
 */
export function promotionProjectFor(source: string | null | undefined): string {
  if (!source) return FALLBACK_PROJECT_NAME;
  return PROMOTION_PROJECT_BY_SOURCE[source] ?? FALLBACK_PROJECT_NAME;
}

/**
 * Description written when the Inbox project is first created.
 *
 * The card has to explain itself on the tracker — somebody who has never read
 * this file needs to understand from the board alone why these items are here
 * and what to do about them.
 */
export const INBOX_PROJECT_DESCRIPTION =
  'Promoted action items awaiting filing — assign a real project from the board.';

/** Fields a reviewer may correct. Anything else is the model's own record. */
export const EDITABLE_FIELDS = ['description', 'owner', 'due_date'] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];
