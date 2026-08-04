/**
 * The brief lifecycle CONTRACT — states and the event→state mapping.
 *
 * ⚠️ THIS FILE MUST NEVER IMPORT `@/db`, and that is why it exists separately
 * from `brief-fold.ts`.
 *
 * Client components render state labels and column order, so they import from
 * here. When these constants lived alongside the fold query, a `'use client'`
 * component importing `BRIEF_STATES` dragged the whole module — including
 * `db` and therefore `pg` — into the browser bundle, and the build failed with
 * `Module not found: Can't resolve 'dns' / 'fs' / 'net' / 'tls'`. Node built-ins
 * cannot resolve in a browser, and the error names pg internals rather than the
 * import that caused it, so it reads as a dependency problem rather than a
 * boundary violation.
 *
 * Keep this module free of anything that touches the database. The query lives
 * in `brief-fold.ts` and is server-only.
 */

/** Column/lifecycle order. Not alphabetical. */
export const BRIEF_STATES = ['in_progress', 'in_review', 'sent_back', 'approved'] as const;
export type BriefState = (typeof BRIEF_STATES)[number];

/**
 * Events that MOVE a brief. Last one wins.
 *
 * ⚠️ `brief.commented` and `brief.script_saved` are deliberately absent — they
 * update last-activity only. Verified against real data: `#2 — Ronin Launch` is
 * `submitted > commented > commented > sent_back > commented` and its state is
 * "Sent back". The trailing comment must not drag it back to In review.
 *
 * ⚠️ `brief.updated → in_progress` is what makes RESUBMISSION work with no
 * special-casing: a sent-back brief that gets edited returns to In progress, and
 * a later submit puts it back in review. The fold only ever asks "what was the
 * last lifecycle event".
 *
 * ⚠️ `brief.approved` has never been observed (0 of 165 events) but is mapped so
 * the day it arrives the board just works instead of filing it as In progress.
 */
export const LIFECYCLE_EVENT_STATE: Record<string, BriefState> = {
  'brief.created': 'in_progress',
  'brief.updated': 'in_progress',
  'brief.submitted': 'in_review',
  'brief.sent_back': 'sent_back',
  'brief.approved': 'approved'
};
