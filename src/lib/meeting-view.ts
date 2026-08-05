import type { RowTone } from './row-tone';

/**
 * The shape a meeting takes when RENDERED, plus its state vocabulary.
 *
 * ⚠️ PURE and client-safe. Lives in src/lib because two features render meetings
 * — the person profile's Meetings tab and My day's latest-meeting card — and
 * CLAUDE.md forbids one feature importing another's internals. The shared
 * component that consumes this is `@/components/meeting-card`.
 *
 * ⚠️ A VIEW TYPE, NOT A DB SHAPE. `when` and every other string arrives
 * PRE-FORMATTED from a service through the pinned-locale helpers in
 * `@/lib/format-date`. Formatting a date inside a renderer is the hydration bug
 * CLAUDE.md documents: the server and browser resolve locale and timezone
 * differently, React declares a mismatch, and the subtree is discarded.
 */
export type MeetingActionState = 'open' | 'in_progress' | 'done';

export type MeetingAction = {
  id: string;
  text: string;
  ownerName: string;
  state: MeetingActionState;
};

export type MeetingView = {
  id: string;
  title: string;
  /** Only Fireflies produces transcripts today. */
  tool: 'Fireflies';
  /** Pre-formatted via `formatMeetingDate`. Never a raw ISO string. */
  when: string;
  attendees: string[];
  aiSummary: string;
  actions: MeetingAction[];
};

/** Meeting action state → the shared row tone vocabulary. */
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
