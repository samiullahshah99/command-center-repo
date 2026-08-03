// ============================================================
// Tracker — Response shapes, filters, mutation payloads
// ============================================================
// Types live here rather than in service.ts because that file is 'use server':
// every export of a Server Actions module must be an async function, so a type
// exported from it is a build error.
// ============================================================

import type { ExternalSystem } from '@/db/schema/external-system';
import type { ProjectStatus } from '@/db/schema/project';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';

export type { ExternalSystem, ProjectStatus, TrackedItemStatus };

/** Owner confidence carried over from the candidate an item was promoted from. */
export type OwnerConfidence = 'exact' | 'email' | 'fuzzy' | 'unresolved';

export type PersonRef = {
  id: string;
  name: string;
  /** Initials for the avatar fallback — `person` has no image column. */
  initials: string;
};

// ── Project list ────────────────────────────────────────────────────────────

export type ProjectRollup = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  lead: PersonRef | null;
  externalSystem: ExternalSystem | null;
  externalId: string | null;
  /** Items not in a terminal state. */
  openCount: number;
  /** Non-terminal items whose due_date is in the past. */
  overdueCount: number;
  /**
   * Pending candidate_action_item rows attributable to this project.
   *
   * A COUNT ONLY. The review queue itself is a later increment — this number
   * links to nothing yet, deliberately.
   */
  needsReviewCount: number;
  totalCount: number;
};

export type ProjectListResponse = {
  projects: ProjectRollup[];
  /** Pending candidates not attributable to any project. */
  unassignedNeedsReview: number;
};

// ── Board ───────────────────────────────────────────────────────────────────

export type BoardItem = {
  id: string;
  title: string | null;
  description: string | null;
  status: TrackedItemStatus;
  owner: PersonRef | null;
  /** ISO timestamp, or null. Rendered through the pinned-locale helper. */
  dueDate: string | null;
  sourceSystem: ExternalSystem;
  sourceType: string;
  /** Set only when sourceSystem !== 'internal' (tracked_item_external_ref_ck). */
  externalTaskId: string | null;
  /**
   * Confidence of the owner match on the candidate this was promoted from.
   *
   * Null when the item has no candidate — a manually created row was never
   * guessed at, which is NOT the same as a guess that came back clean.
   */
  originOwnerConfidence: OwnerConfidence | null;
  riskFlag: boolean;
  updatedAt: string;
};

export type BoardGroup = {
  status: TrackedItemStatus;
  items: BoardItem[];
};

export type BoardResponse = {
  project: {
    id: string;
    name: string;
    description: string | null;
    status: ProjectStatus;
    lead: PersonRef | null;
  };
  /** Grouped by status, in TRACKED_ITEM_STATUSES order. Empty groups included. */
  groups: BoardGroup[];
  /** Every person, for the owner picker. Small roster; no need to paginate. */
  roster: PersonRef[];
  totalCount: number;
};

// ── Mutations ───────────────────────────────────────────────────────────────

export type UpdateItemResult = { ok: true; item: BoardItem } | { ok: false; message: string };
