// ============================================================
// Department detail — response shapes
// ============================================================
// Types live here rather than in service.ts because that file is 'use server':
// every export of a Server Actions module must be an async function.
// ============================================================

import type { DeptType } from '@/db/schema/department';
import type { ProjectStatus } from '@/db/schema/project';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import type { AgentPerformanceView } from '@/lib/agent-performance';
import type { BriefState } from '@/lib/brief-states';
import type { BriefRow, WeekBar, WeeklyPerformanceView } from '@/lib/brief-view';
import type { TeamMemberView } from '@/components/team-member-list';
import type { DeptHealthStatus } from '@/lib/dept-health';

export type { BriefState, DeptHealthStatus, DeptType, TrackedItemStatus };

export type DeptStats = {
  open: number;
  overdue: number;
  blocked: number;
  atRisk: number;
  people: number;
};

/** A project this department is working in. */
export type DeptProject = {
  id: string;
  name: string;
  /** `project.lead_person_id` → person.name. Null when unassigned. */
  leadName: string | null;
  status: ProjectStatus;
  /**
   * ⚠️ DEPT-SCOPED, not global. Resolved over total for THIS department's items in
   * the project — see the note in ./service.ts. Null when the department has no
   * items there at all.
   */
  progressPct: number | null;
  /** This department's open item count in the project. */
  openCount: number;
  /** This department's total item count in the project. */
  totalCount: number;
};

/** One of the department's open items — the source array for risks. */
export type DeptItem = {
  id: string;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  status: TrackedItemStatus;
  dueDate: string | null;
  riskFlag: boolean;
  ownerName: string | null;
};

export type DeptRisk = {
  id: string;
  severity: 'destructive' | 'warning';
  text: string;
  meta: string;
  href: string;
};

/**
 * ⚠️ Brief view shapes MOVED to `@/lib/brief-view` when the Briefs & quota screen
 * became a second consumer of the same table and chart. Re-exported so this
 * feature's DTO still reads whole.
 */
export type { BriefRow, WeeklyPerformanceView, WeekBar };

export type DepartmentDetail = {
  department: {
    id: string;
    name: string;
    deptType: DeptType;
    /** Theme token reference, shared with the sidebar's dot. */
    accentVar: string;
  };
  health: DeptHealthStatus;
  healthReasons: string[];
  /**
   * A deterministic factual sentence built from live counts.
   *
   * ⚠️ NOT AI-GENERATED and carries no sample flag — there is no model call. The
   * `ai_summary` cache is per-`person_id`; a polymorphic subject is backend work
   * (audit §1.3), not something to fake here.
   */
  summary: string;
  stats: DeptStats;
  projects: DeptProject[];
  items: DeptItem[];
  risks: DeptRisk[];
  members: TeamMemberView[];
  /** Present only for `dept_type = 'creative'`. */
  briefs: { backlog: BriefRow[]; performance: WeeklyPerformanceView } | null;
  /** Present only for `dept_type = 'cx'`. */
  agents: AgentPerformanceView | null;
  /** Resolved ONCE on the server; every date comparison derives from it. */
  now: string;
};
