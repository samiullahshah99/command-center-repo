import type { RowTone } from '@/lib/row-tone';
import type { Greeting, RecurringState } from '../api/types';

/**
 * Greeting wording, keyed on the band the SERVER computed.
 *
 * ⚠️ The BAND is decided server-side (`greetingFor` in ../api/service.ts) and only
 * the wording lives here. A component deciding "is it morning?" would read the
 * clock during render, which differs between SSR and hydration for anyone near a
 * boundary and makes React discard the subtree.
 */
export const GREETING_TEXT: Record<Greeting, string> = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening'
};

/**
 * Recurring-task completion state → label + tone.
 *
 * ⚠️ THE STATES THEMSELVES ARE INVENTED TODAY — the completion engine does not
 * exist. This map is the presentation for a value the service currently mocks; it
 * needs no change when the engine lands, because the vocabulary is the one the
 * engine will produce (`auto_completed` / `pending` / `manual_required` mirror the
 * PRD's "evidenced, never self-declared" plus its documented manual fallback).
 *
 * ⚠️ `manual_required` is WARNING, not destructive. A task with no reliable signal
 * is a known design limitation the PRD plans for — "where no reliable signal
 * exists, tasks fall back to a lightweight manual check-off" — not a failure. Red
 * here would put alarm on every task the design expects to be manual.
 */
export const RECURRING_STATE: Record<RecurringState, { label: string; tone: RowTone }> = {
  auto_completed: { label: 'Auto-completed', tone: 'done' },
  pending: { label: 'Pending', tone: 'muted' },
  manual_required: { label: 'Manual check-off', tone: 'warning' }
};
