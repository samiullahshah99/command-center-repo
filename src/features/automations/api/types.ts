// ============================================================
// Automations — response shapes
// ============================================================
// Types live here rather than in service.ts because that file is 'use server':
// every export of a Server Actions module must be an async function.
// ============================================================

import type { Cadence } from '@/db/schema/recurring-task';

export type { Cadence };

/** Derived, not stored — see the note on `roleProfileStatus` in ./service.ts. */
export type RoleProfileStatus = 'live' | 'manual';

export type RoleProfileRow = {
  id: string;
  /** REAL — `role_profile.name`. */
  name: string;
  /** REAL — people whose `role_profile_id` points here. */
  peopleCount: number;
  /** Their names, for the count's tooltip. Empty when nobody is assigned. */
  peopleNames: string[];
  /**
   * REAL, parsed DEFENSIVELY from `tracked_signals` jsonb.
   *
   * ⚠️ The column is untyped and the inventory says rebuild it (audit §3.4). A
   * malformed value renders as an empty array here — never throws. This is an ops
   * page; a bad config row must not take the whole table down.
   */
  signals: string[];
  /** REAL — "8/wk" when `quota_config.briefsPerWeek` is a positive number, else null. */
  quotaLabel: string | null;
  /** REAL — humanised `auto_complete_rule`, or null when there is none. */
  ruleLabel: string | null;
  /** REAL — the rule's source system, or the first `source_channels` entry. */
  sourceLabel: string | null;
  /** ⚠️ DERIVED from whether a rule exists — see ./service.ts. */
  status: RoleProfileStatus;
  /** The existing admin surface for this profile. */
  editHref: string;
};

export type RuleStatus = 'active' | 'manual_fallback' | 'no_rule';

export type AutomationRuleRow = {
  id: string;
  /** REAL — derived from the rule's event via @/lib/recurring-label. */
  task: string;
  /** REAL — the task's owner. */
  ownerName: string | null;
  /** REAL — `recurring_task.cadence`. */
  cadence: Cadence;
  /** REAL — built from `auto_complete_rule.source` + `.event`. */
  watchedSignal: string;
  /** REAL — `recurring_task.fallback_manual`. */
  fallbackManual: boolean;
  /** ⚠️ INVENTED. The completion engine does not exist. */
  firedCount: number;
  /** ⚠️ INVENTED. Pre-formatted; there is no completion timestamp to read. */
  lastFiredLabel: string | null;
  /** ⚠️ DERIVED from real fields — see ./service.ts. */
  status: RuleStatus;
};

export type Automations = {
  roleProfiles: RoleProfileRow[];
  rules: AutomationRuleRow[];
  /**
   * ⚠️ Applies to `firedCount` and `lastFiredLabel` ONLY. Every other field on a
   * rule row — task, owner, cadence, watched signal, fallback, status — is real.
   */
  firedIsSample: boolean;
  /** Resolved ONCE on the server. */
  now: string;
};
