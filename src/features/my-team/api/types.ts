// ============================================================
// My team — response shapes
// ============================================================
// Types live here rather than in service.ts because that file is 'use server':
// every export of a Server Actions module must be an async function.
// ============================================================

import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import type { DeptHealthStatus } from '@/lib/dept-health';
import type { AgentCadence, AgentPerformanceView, AgentRow } from '@/lib/agent-performance';
import type { TeamMemberView } from '@/components/team-member-list';

export type { DeptHealthStatus, TrackedItemStatus };

/**
 * ⚠️ Agent-performance shapes MOVED to `@/lib/agent-performance` when the CX
 * department panel became a second consumer of the same table. Re-exported so this
 * feature's DTO still reads whole.
 */
export type { AgentCadence, AgentPerformanceView as AgentPerformance, AgentRow };

/** One of the team's open items. */
export type TeamItem = {
  id: string;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  status: TrackedItemStatus;
  /** ISO timestamp or null. Rendered via formatDueDate(due, now). */
  dueDate: string | null;
  riskFlag: boolean;
  ownerPersonId: string | null;
  ownerName: string | null;
};

/** A troubled item, for the At risk / blocked panel. */
export type TeamRisk = {
  id: string;
  severity: 'destructive' | 'warning';
  text: string;
  /** "Owner · 4 days overdue" — assembled server-side. */
  meta: string;
  href: string;
};

/**
 * ⚠️ Member row shape MOVED to `@/components/team-member-list` — the department
 * page renders the same list. Re-exported for this feature's DTO.
 */
export type TeamMemberRow = TeamMemberView;

export type TeamStats = {
  open: number;
  overdue: number;
  blocked: number;
  atRisk: number;
  members: number;
};

export type MyTeam = {
  department: {
    id: string;
    name: string;
    /** Theme token reference, shared with the sidebar's dot. */
    accentVar: string;
  };
  /**
   * ⚠️ From `computeDeptHealth` over the SAME items the sidebar and Control Tower
   * score — see `getDeptItems`. A badge here and a dot in the rail cannot disagree.
   */
  health: DeptHealthStatus;
  healthReasons: string[];
  stats: TeamStats;
  agents: AgentPerformanceView;
  items: TeamItem[];
  risks: TeamRisk[];
  members: TeamMemberRow[];
  /**
   * Resolved ONCE on the server. Every due-date comparison derives from it — a
   * per-render clock differs between SSR and hydration and React discards the
   * subtree.
   */
  now: string;
};
