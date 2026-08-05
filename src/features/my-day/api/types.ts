// ============================================================
// My day — response shapes
// ============================================================
// Types live here rather than in service.ts because that file is 'use server':
// every export of a Server Actions module must be an async function.
// ============================================================

import type { Cadence } from '@/db/schema/recurring-task';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import type { MeetingView } from '@/lib/meeting-view';

export type { Cadence, TrackedItemStatus };

/** Time of day, computed ONCE server-side from `now`. */
export type Greeting = 'morning' | 'afternoon' | 'evening';

/**
 * One of my action items.
 *
 * ⚠️ `sourceLabel` is humanised in the DTO, matching the person profile: the
 * column is a Postgres enum of lowercase snake values, and mapping it in a
 * component would put presentation strings in two places.
 */
export type MyItem = {
  id: string;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  status: TrackedItemStatus;
  sourceLabel: string;
  /** ISO timestamp or null. Rendered via formatDueDate(due, now). */
  dueDate: string | null;
  riskFlag: boolean;
};

/** Severity drives ordering and colour. Matches the Control Tower's vocabulary. */
export type AlertSeverity = 'destructive' | 'warning';

export type MyAlert = {
  /** The tracked_item id — stable across reloads, so it is a safe React key. */
  id: string;
  severity: AlertSeverity;
  /** The item title, or a stand-in when the source system holds it. */
  text: string;
  /** Project · due-date context. */
  meta: string;
  /** Right-hand pill: 'Overdue' | 'Blocked' | 'At risk'. */
  tag: string;
  href: string;
};

export type MySignals = {
  dueToday: number;
  overdue: number;
  /** Non-terminal items assigned to me. The denominator for "due today". */
  open: number;
  /** Items that reached `done` since Monday 00:00 UTC. */
  doneThisWeek: number;
};

/** One block on the "Today" timeline. */
export type TodayBlock = {
  id: string;
  /** Pre-formatted server-side, 24h UTC — e.g. "09:30". Never formatted in render. */
  time: string;
  title: string;
  /** Theme token reference for the 3px bar, e.g. `var(--chart-2)`. */
  accentVar: string;
};

export type MyToday = {
  /**
   * ⚠️ TRUE TODAY, ALWAYS. There is no calendar integration — no client, no
   * credentials, no table. See `sampleToday()` in ./service.ts and docs/gaps.md.
   * The flag travels WITH the data so a renderer cannot show it without the
   * caption.
   */
  isSample: boolean;
  blocks: TodayBlock[];
};

/**
 * A recurring task, as this page renders it.
 *
 * ⚠️ HYBRID — READ THE PER-FIELD NOTES. The row's existence, its owner, its
 * cadence and its watched signal are REAL (`recurring_task`, seeded and aligned to
 * the mockup's Automations table). Its completion `state` and `evidence` are
 * INVENTED, because the completion engine does not exist: `completion_event` has 0
 * rows and no writer, and nothing evaluates `auto_complete_rule`.
 *
 * Splitting the flag per-card rather than per-field is deliberate — the card
 * carries one "Sample data" caption naming exactly which columns are illustrative,
 * which is more honest than a badge on every second cell.
 */
export type RecurringState = 'auto_completed' | 'pending' | 'manual_required';

export type MyRecurringTask = {
  id: string;
  /**
   * Derived from `auto_complete_rule.event` via a label map — `recurring_task` has
   * NO name column and the seed spec forbids adding one. The underlying event is
   * real; only the wording is a display mapping.
   */
  name: string;
  /** REAL — `recurring_task.cadence`. */
  cadence: Cadence;
  /** REAL — built from `auto_complete_rule.source` + `.event`. */
  watchedSignal: string;
  /** REAL — `recurring_task.fallback_manual`. */
  fallbackManual: boolean;
  /** ⚠️ INVENTED. Completion engine unbuilt. */
  state: RecurringState;
  /** ⚠️ INVENTED. What "proved" completion — there is no evidence store yet. */
  evidence: string;
};

export type MyRecurring = {
  /** ⚠️ Applies to `state` and `evidence` only; the rows themselves are real. */
  stateIsSample: boolean;
  tasks: MyRecurringTask[];
};

export type MyLatestMeeting = {
  /**
   * ⚠️ TRUE TODAY, ALWAYS. Fireflies webhooks carry a `meeting_id` and no actor,
   * so attribution is 0% and "my meetings" has no honest join. See
   * `sampleLatestMeeting()` in ./service.ts, audit D4, and docs/gaps.md.
   */
  isSample: boolean;
  /** Null when there is nothing to show — the card is omitted entirely. */
  meeting: MeetingView | null;
};

export type MyDay = {
  person: {
    id: string;
    firstName: string;
    /** `role_profile.name` — WORK CONFIG, not the access role. */
    roleProfileName: string | null;
  };
  greeting: Greeting;
  /**
   * Resolved ONCE on the server. Every relative label, due-date comparison and
   * the greeting itself derive from it — a per-render clock differs between SSR
   * and hydration and React discards the subtree.
   */
  now: string;
  signals: MySignals;
  alerts: MyAlert[];
  items: MyItem[];
  today: MyToday;
  recurring: MyRecurring;
  latestMeeting: MyLatestMeeting;
};
