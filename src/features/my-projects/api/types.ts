// ============================================================
// My projects — response shapes
// ============================================================
// Types live here rather than in service.ts because that file is 'use server':
// every export of a Server Actions module must be an async function.
// ============================================================

import type { ProjectStatus } from '@/db/schema/project';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import type { TrackedItemRowView } from '@/components/tracked-item-rows';

export type { ProjectStatus, TrackedItemStatus };

export type MyProjectStats = {
  /** Projects I am active in — see the definition on `getMyProjects`. */
  projects: number;
  /** My non-terminal items across all of them. */
  open: number;
  overdue: number;
  inFlight: number;
  /** Blocked OR risk-flagged. Counted once each, not summed twice. */
  troubled: number;
};

export type MyProject = {
  id: string;
  name: string;
  /** `project.lead_person_id` → person.name. Null when unassigned. */
  leadName: string | null;
  status: ProjectStatus;
  /**
   * ⚠️ ME-SCOPED: resolved over total for MY items in this project, not the
   * project's whole backlog. Null when I hold no items there at all — an empty
   * denominator is not 0% complete, and a 0% bar reads as failure.
   */
  progressPct: number | null;
  /** My open item count in this project. */
  openCount: number;
  /** My total item count in this project, terminal included. */
  totalCount: number;
};

/** My non-terminal items, shaped for the shared row component. */
export type MyProjectItem = TrackedItemRowView & {
  projectId: string | null;
};

export type MyProjectRisk = {
  id: string;
  severity: 'destructive' | 'warning';
  text: string;
  meta: string;
  href: string;
};

export type MyProjects = {
  stats: MyProjectStats;
  projects: MyProject[];
  items: MyProjectItem[];
  risks: MyProjectRisk[];
  /**
   * Resolved ONCE on the server. Every due-date comparison derives from it — a
   * per-render clock differs between SSR and hydration and React discards the
   * subtree.
   */
  now: string;
};
