import type { OwnerConfidenceLevel } from '../api/types';

/**
 * How each owner-confidence level looks.
 *
 * ⚠️ 'fuzzy' and 'unresolved' are AMBER ON PURPOSE, and must stay visually
 * louder than the settled levels.
 *
 * The review queue's whole value is directing a human's attention to what a
 * machine could not decide. A guess styled like a fact gets approved on a skim —
 * and an owner accepted carelessly silently attributes one person's work to
 * another, which nobody goes looking for later. Uncertainty is the signal here,
 * so it gets the loud colour; a confident match is the boring case and is
 * styled like one.
 */
export const OWNER_CONFIDENCE_META: Record<
  OwnerConfidenceLevel,
  { label: string; className: string; hint: string }
> = {
  exact: {
    label: 'exact',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    hint: 'Matched an identity already linked to this person'
  },
  email: {
    label: 'email',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    hint: 'Matched on a meeting participant email that resembles the spoken name'
  },
  fuzzy: {
    label: 'fuzzy — needs review',
    className:
      'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200 font-semibold',
    hint: 'A name-similarity SUGGESTION only. Never auto-applied — a human must confirm it'
  },
  unresolved: {
    label: 'unresolved',
    className:
      'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200 font-semibold',
    hint: 'No confident match. Ties are deliberately left unresolved rather than guessed'
  }
};

/** Levels that mean "a person still has to decide this". */
export const NEEDS_REVIEW: OwnerConfidenceLevel[] = ['fuzzy', 'unresolved'];

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

// ⚠️ Re-exported from src/lib/format-date, NOT reimplemented here.
//
// These originally lived in this file. The tracker needs the same pinned-locale
// formatting, and a `tracker → features/extraction` import would couple two
// unrelated features to share four lines of Intl config — so the implementation
// moved to src/lib and this re-export keeps existing call sites unchanged.
export { formatDateOnly, formatMeetingDate, DATE_LOCALE, DATE_TZ } from '@/lib/format-date';
