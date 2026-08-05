// ============================================================
// Person profile — response shapes
// ============================================================
// Types live here rather than in service.ts because that file is 'use server':
// every export of a Server Actions module must be an async function.
// ============================================================

import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import type { OwnerConfidence } from '@/features/tracker/api/types';

export type { OwnerConfidence, TrackedItemStatus };

export type ProfileItem = {
  id: string;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  status: TrackedItemStatus;
  /**
   * Where the item came from, already humanised: 'Meeting' | 'Slack' | 'Manual'
   * | 'System'.
   *
   * ⚠️ Renamed IN THE DTO rather than mapped in the component. `source_type` is a
   * Postgres enum whose values are lowercase snake; a component mapping it would
   * put presentation strings in two places the moment a second screen shows the
   * same pill.
   */
  sourceLabel: string;
  /** ISO timestamp or null. Rendered via the pinned-locale helpers. */
  dueDate: string | null;
  /**
   * Confidence of the owner match on the candidate this was promoted from.
   * Null when there was no candidate — never guessed at is not the same as
   * guessed and came back clean.
   */
  originOwnerConfidence: OwnerConfidence | null;
  riskFlag: boolean;
  /** Last movement we know of. From tracked_item.last_update_at. */
  lastUpdateAt: string | null;
};

export type ProfileEvent = {
  id: string;
  source: string;
  eventType: string;
  occurredAt: string;
};

export type ProfileCounts = {
  open: number;
  overdue: number;
  done: number;
  total: number;
};

/**
 * Why the activity strip is empty, when it is.
 *
 * ⚠️ The distinction matters and drives different copy. "This person has linked
 * accounts but nothing happened recently" is a fact about them; "this person has
 * no linked accounts" is a fact about OUR data, and it has a fix the reader can
 * act on. Collapsing the two into one "no activity" message hides a task.
 */
export type ActivityGap = 'none' | 'no_identities' | 'no_recent_events';

export type SummaryCard = {
  summary: string;
  itemCount: number;
  eventCount: number;
  generatedAt: string;
  model: string;
  /** True when served from ai_summary rather than freshly generated. */
  cached: boolean;
};

/** Rolling 30-day activity totals for the "Events (30d)" signal card. */
export type ProfileEventStats = {
  last30d: number;
  /** Busiest source first. Empty when nothing landed in the window. */
  bySource: { source: string; count: number }[];
};

/** One block on the calendar grid. */
export type CalendarBlock = {
  id: string;
  /** Pre-formatted server-side, 24h UTC — e.g. "09:30". Never formatted in render. */
  time: string;
  title: string;
  /** Theme token reference for the 3px left border, e.g. `var(--chart-2)`. */
  accentVar: string;
};

export type CalendarDay = {
  /** ISO yyyy-mm-dd, for a stable React key. */
  key: string;
  /** "Mon 10" — pre-formatted server-side through the pinned-locale helpers. */
  label: string;
  blocks: CalendarBlock[];
};

export type ProfileCalendar = {
  /**
   * ⚠️ TRUE TODAY, ALWAYS. There is no calendar integration — see the note on
   * `sampleCalendar()` in ./service.ts. The flag travels WITH the data so a
   * renderer cannot show it without the caption.
   */
  isSample: boolean;
  days: CalendarDay[];
};

export type MeetingActionState = 'open' | 'in_progress' | 'done';

export type MeetingAction = {
  id: string;
  text: string;
  ownerName: string;
  state: MeetingActionState;
};

export type ProfileMeeting = {
  id: string;
  title: string;
  /** Only Fireflies produces transcripts today. */
  tool: 'Fireflies';
  /** Pre-formatted server-side via formatMeetingDate. */
  when: string;
  attendees: string[];
  aiSummary: string;
  actions: MeetingAction[];
};

export type ProfileMeetings = {
  /** ⚠️ TRUE TODAY, ALWAYS — see `sampleMeetings()` in ./service.ts. */
  isSample: boolean;
  items: ProfileMeeting[];
};

export type PersonProfile = {
  person: {
    id: string;
    name: string;
    initials: string;
    /**
     * ⚠️ `role_profile.name` — WORK CONFIG (tracked signals + quota), rendered as
     * the "Role profile:" chip. NOT the access role. See src/db/schema/role.ts:
     * the two are independent axes and must not be conflated.
     */
    role: string | null;
    /**
     * ⚠️ `role.display_name` — the ACCESS role, rendered in the subtitle line.
     * Display only; never branch on it (branch on `role.code`).
     */
    roleDisplayName: string | null;
    /** `department.name` via person.department_id. Null when unassigned. */
    deptName: string | null;
    /**
     * Slack display name from `person_identity` where source='slack'.
     *
     * ⚠️ DISPLAY ONLY, MUTABLE, NEVER AN IDENTITY KEY — the same rule the schema
     * states on `person_identity.display_name`. Null renders as "—" rather than
     * being omitted, so "no Slack account linked" is visible rather than implied.
     */
    slackHandle: string | null;
    email: string | null;
    /** Whether any identity is linked — drives the activity empty state. */
    linkedIdentityCount: number;
  };
  counts: ProfileCounts;
  eventStats: ProfileEventStats;
  items: ProfileItem[];
  events: ProfileEvent[];
  calendar: ProfileCalendar;
  meetings: ProfileMeetings;
  activityGap: ActivityGap;
  /**
   * Null when the summary could not be produced — no data, a parse failure, or
   * a provider error. The page renders fully without it, by design.
   */
  summary: SummaryCard | null;
  /** Set when the summary is absent for a reason worth showing quietly. */
  summaryUnavailable: 'no_data' | 'error' | null;
};

export type RegenerateResult = { ok: true; summary: SummaryCard } | { ok: false; message: string };
