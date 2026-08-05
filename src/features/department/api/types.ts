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

/** One row of the creative brief backlog. */
export type BriefRow = {
  id: string;
  /** The brief's label from its Vision events. */
  title: string;
  /**
   * ⚠️ ALWAYS "—". Vision carries NO product field on a brief (audit §3.1). The
   * column exists because the mockup has it; inventing a value would be worse than
   * an em dash. Logged in docs/gaps.md.
   */
  product: string;
  /** Real where the actor resolved; "—" otherwise. ⚠️ NEVER guessed. */
  owner: string;
  /** Whole days since the brief was FIRST OBSERVED (not created — see the fold). */
  ageDays: number;
  state: BriefState;
};

/** One bar of the 6-week performance chart. */
export type WeekBar = {
  /** ISO week label, e.g. "W32". */
  week: string;
  count: number;
};

export type BriefPerformance = {
  bars: WeekBar[];
  /**
   * Team-wide `role_profile.quota_config.briefsPerWeek`, summed.
   *
   * ⚠️ NULL when no role profile configures one — which is the case today. An
   * unconfigured quota is NOT a zero quota, so the bars render neutral rather than
   * all-below-target. Same rule the briefs feature already applies.
   */
  quota: number | null;
  /**
   * ⚠️ TRUE when the series counts `brief.submitted` instead of approvals.
   *
   * Decision 6 (2026-08-06) says quota counts APPROVED briefs — but the live Vision
   * catalogue contains **no `brief.approved` events at all**, so an approvals series
   * would be six empty bars. The documented fallback is taken and surfaced in the
   * caption; this is a data gap, not a mock.
   */
  usesSubmittedFallback: boolean;
};

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
  briefs: { backlog: BriefRow[]; performance: BriefPerformance } | null;
  /** Present only for `dept_type = 'cx'`. */
  agents: AgentPerformanceView | null;
  /** Resolved ONCE on the server; every date comparison derives from it. */
  now: string;
};
