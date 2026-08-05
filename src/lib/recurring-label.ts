/**
 * `recurring_task.auto_complete_rule.event` → a human label.
 *
 * ⚠️ `recurring_task` HAS NO NAME COLUMN and the seed spec forbids adding one, so
 * every surface that lists recurring tasks has to derive the wording. This is that
 * derivation, in one place: the event value is REAL (it is what the database
 * holds); only the phrasing is ours.
 *
 * ⚠️ PURE and client-safe. Lives in src/lib because two features need it — My
 * day's recurring card and the Capture queue's auto-completion ledger — and
 * CLAUDE.md puts shared behaviour here rather than in an import between features.
 *
 * Labels match the mockup's Automations table so the same task reads the same way
 * on every screen.
 */
const RECURRING_LABEL: Record<string, string> = {
  recap_delivered: 'CX metrics recap',
  awaiting_review_acknowledged: 'Daily returns review',
  ops_review_posted: 'Ops review post',
  briefs_submitted: 'Weekly brief quota',
  standup_message: 'Standup notes',
  progress_updated: 'Progress update'
};

/** `awaiting_review_acknowledged` → `Awaiting review acknowledged`. */
function humanise(value: string): string {
  const s = value.replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The label for a rule's event.
 *
 * ⚠️ An unmapped event falls back to a humanised form of ITSELF, never to a blank
 * or to "Recurring task". A missing label is a mapping gap worth seeing on the
 * screen; a blank row hides it.
 */
export function recurringLabel(event: string | undefined | null): string {
  if (!event) return 'Recurring task';
  return RECURRING_LABEL[event] ?? humanise(event);
}

/** `portal` + `awaiting_review_acknowledged` → "Portal · awaiting review acknowledged". */
export function watchedSignalLabel(
  source: string | undefined | null,
  event: string | undefined | null
): string {
  const src = source ? source.charAt(0).toUpperCase() + source.slice(1) : 'Unknown source';
  const evt = event ? event.replaceAll('_', ' ') : 'no signal configured';
  return `${src} · ${evt}`;
}
