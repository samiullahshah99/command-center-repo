// ============================================================
// My team — response shapes
// ============================================================
// Types live here rather than in service.ts because that file is 'use server':
// every export of a Server Actions module must be an async function.
// ============================================================

import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import type { DeptHealthStatus } from '@/lib/dept-health';

export type { DeptHealthStatus, TrackedItemStatus };

/**
 * ⚠️ ADHERENCE, NOT A SCHEDULE — and this is a named trap from the audit.
 *
 * The mockup's Agent-performance table has a "Cadence" column meaning *is this
 * agent keeping up*. `recurring_task.cadence` is a completely different concept: a
 * REPETITION INTERVAL (`daily | weekly | biweekly | monthly | quarterly`). Two
 * different things are called "cadence" on adjacent screens, so this type is named
 * `AgentCadence` and deliberately does NOT reuse `Cadence` from
 * `@/db/schema/recurring-task`. Importing that one here would typecheck and mean
 * the wrong thing.
 */
export type AgentCadence = 'on_track' | 'behind' | 'ahead';

/**
 * One row of the Agent-performance table.
 *
 * ⚠️ HYBRID. `personId` / `name` / `roleLabel` are REAL department members. Every
 * FIGURE — tickets, resolved, csat, cadence — is INVENTED: the Zendesk integration
 * does not exist (audit §3.3, no client, no credentials, no table). The card
 * renders a caption from `figuresAreSample`.
 */
export type AgentRow = {
  personId: string;
  /** REAL — the person's name. */
  name: string;
  /** REAL — `role.display_name`, or null when no access role is assigned. */
  roleLabel: string | null;
  /** ⚠️ INVENTED. */
  tickets: number;
  /** ⚠️ INVENTED. */
  resolved: number;
  /** ⚠️ INVENTED. 0–5, one decimal. */
  csat: number;
  /** ⚠️ INVENTED. Adherence — see AgentCadence. */
  cadence: AgentCadence;
};

export type AgentPerformance = {
  /** ⚠️ Applies to the figures only; the agents themselves are real. */
  figuresAreSample: boolean;
  rows: AgentRow[];
};

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

/** One member row. */
export type TeamMemberRow = {
  id: string;
  name: string;
  initials: string;
  /** Theme token reference for the avatar tint. Never a colour literal. */
  accentVar: string;
  /** `role.display_name`, or null. Display only — never branch on it. */
  roleLabel: string | null;
  /** Non-terminal items owned by this person. The row's signal. */
  openCount: number;
  /** Profile link, carrying `?from=my-team`. */
  href: string;
};

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
  agents: AgentPerformance;
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
