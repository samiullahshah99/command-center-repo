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

export type PersonProfile = {
  person: {
    id: string;
    name: string;
    initials: string;
    role: string | null;
    email: string | null;
    /** Whether any identity is linked — drives the activity empty state. */
    linkedIdentityCount: number;
  };
  counts: ProfileCounts;
  items: ProfileItem[];
  events: ProfileEvent[];
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
