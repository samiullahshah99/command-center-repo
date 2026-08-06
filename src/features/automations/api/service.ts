// ============================================================
// Automations Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/tracker/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED — queries.ts is consumed on both sides of the SSR
// handoff. Every export must be an async function; types live in ./types.ts.
//
// READ-ONLY, and deliberately so. ⚠️ THIS IS NOT A SECOND CRUD SURFACE. A full
// role-profile admin already exists at /dashboard/role-profiles (list) and
// /dashboard/role-profiles/[roleProfileId] (edit form). This page is the overview
// the mockup shows; every row links there to edit. Do not add mutations here.
//
// ⚠️ ONE surface is invented: a rule's FIRED count and last-fired time (the
// completion engine is unbuilt). Everything else is a real query.
//
// ⚠️ ONE PRE-AGGREGATED CALL — `getAutomations(now)`.
// ============================================================

'use server';

import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireRole } from '@/lib/current-actor';
import { rolesForRoute } from '@/lib/route-access';
import { person, recurringTask, roleProfile } from '@/db/schema';
import type { Cadence } from '@/db/schema/recurring-task';
import { formatMeetingDate } from '@/lib/format-date';
import { recurringLabel, watchedSignalLabel } from '@/lib/recurring-label';
import type {
  Automations,
  AutomationRuleRow,
  RoleProfileRow,
  RoleProfileStatus,
  RuleStatus
} from './types';

// ── Defensive JSONB parsing ─────────────────────────────────────────────────
//
// ⚠️ `tracked_signals`, `quota_config` and `source_channels` are UNTYPED jsonb, and
// the inventory says the whole `role_profile` shape is due a rebuild (audit §3.4).
// Nothing validates what goes in — the admin form writes them, and a hand-edited
// row can hold anything at all.
//
// ⚠️ EVERY PARSE BELOW RETURNS A FALLBACK AND NEVER THROWS. This is the ops
// page: one malformed config row must render an em dash in one cell, not take the
// table — and with it the operator's only view of what is configured — down.

/** A jsonb array of strings, or []. Non-string members are dropped, not coerced. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** `{ briefsPerWeek: 8 }` → "8/wk". Anything else → null. */
function quotaLabelOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const n = (value as { briefsPerWeek?: unknown }).briefsPerWeek;
  // Guards NaN and Infinity as well as the wrong type — `> 0` is false for both.
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? `${n}/wk` : null;
}

/** `{ source, event, within }`, defensively. Any field may be absent. */
function ruleOf(value: unknown): { source?: string; event?: string; within?: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const r = value as Record<string, unknown>;
  return {
    source: typeof r.source === 'string' ? r.source : undefined,
    event: typeof r.event === 'string' ? r.event : undefined,
    within: typeof r.within === 'string' ? r.within : undefined
  };
}

function titleCase(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * ⚠️ STATUS IS DERIVED, NOT STORED. `role_profile` has NO status column.
 *
 * A profile counts as `live` when it carries an auto-complete rule — i.e. when
 * something is actually watching a signal for it — and `manual` otherwise.
 *
 * ⚠️ SWAP POINT: when the `role_profile` rebuild (audit §3.4) adds a real status
 * column, this function is the ONE place to change. Do not scatter the derivation
 * into the component; a derived value that looks stored is how a screen starts
 * disagreeing with the database.
 */
function roleProfileStatus(hasRule: boolean): RoleProfileStatus {
  return hasRule ? 'live' : 'manual';
}

/**
 * ⚠️ ALSO DERIVED. `recurring_task` has no status column either.
 *
 * Order matters, and this is the case the seeded data actually contains: two of
 * the five tasks have BOTH a rule and `fallback_manual = true`. A rule wins —
 * the task DOES auto-complete when its signal fires, and the fallback is what
 * happens when it does not. Reporting those as "Manual fallback" would tell an
 * operator nothing is watching, which is false. The fallback is still surfaced on
 * the row itself so the field is not hidden.
 */
function ruleStatus(hasRule: boolean, fallbackManual: boolean): RuleStatus {
  if (hasRule) return 'active';
  if (fallbackManual) return 'manual_fallback';
  return 'no_rule';
}

/**
 * TODO(backend): completion engine (audit D5).
 *
 * ⚠️ THE FIRED COUNT AND LAST-FIRED TIME ARE INVENTED. `completion_event` has 0
 * rows and NO WRITER, and nothing evaluates `auto_complete_rule` — so nothing has
 * ever fired. Every other field on the row is real.
 *
 * ⚠️ NEVER "fix" this by seeding `completion_event`. A seeded row makes a
 * fabricated firing indistinguishable from a measured one at the database level,
 * which is strictly worse than a labelled placeholder. The seed spec forbids it.
 *
 * ⚠️ DERIVED FROM THE ROW'S INDEX AND CADENCE, matching the Capture-queue ledger's
 * spread (one day apart, descending) so the same task tells the same story on both
 * screens. A daily task plausibly fires more often than a weekly one — that shape
 * is the only thing making these numbers legible as a preview rather than noise.
 */
function sampleFired(
  index: number,
  cadence: Cadence,
  hasRule: boolean,
  now: Date
): { firedCount: number; lastFiredLabel: string | null } {
  // A task with no rule cannot have fired, sample or not.
  if (!hasRule) return { firedCount: 0, lastFiredLabel: null };

  const base = cadence === 'daily' ? 22 : cadence === 'weekly' ? 6 : 3;
  const when = new Date(now);
  when.setUTCDate(when.getUTCDate() - index);
  when.setUTCHours(9, 0, 0, 0);

  return {
    firedCount: base + (index % 4),
    lastFiredLabel: formatMeetingDate(when.toISOString())
  };
}

/**
 * Everything the Automations page renders, in TWO queries.
 *
 * ⚠️ `now` is a PARAMETER, resolved once by the caller and threaded through.
 *
 * ⚠️ ROLE GATE, INSIDE THE SERVICE — defence in depth, not the UX.
 *
 * The page guard (`requireRouteAccess`) already redirects an unauthorised reader.
 * It does NOT protect this function: `'use server'` publishes every export as its
 * own POST endpoint, reachable without ever loading the page. For the automations overview the
 * RETURN VALUE is the thing worth protecting, so the check belongs here too.
 *
 * ⚠️ Roles come from `ROUTE_ACCESS`, so this list cannot drift from the page's.
 */
export async function getAutomations(now: Date): Promise<Automations> {
  await requireRole(rolesForRoute('/dashboard/automations'), 'the automations overview');

  /**
   * ── Role profiles, with their people.
   *
   * ⚠️ People are aggregated in SQL rather than fetched per profile — seven
   * profiles would otherwise be seven round trips for a count and a tooltip.
   */
  const profileRows = await db
    .select({
      id: roleProfile.id,
      name: roleProfile.name,
      trackedSignals: roleProfile.trackedSignals,
      quotaConfig: roleProfile.quotaConfig,
      sourceChannels: roleProfile.sourceChannels,
      peopleCount: sql<number>`count(${person.id})::int`,
      peopleNames: sql<string | null>`string_agg(${person.name}, ', ' order by ${person.name})`
    })
    .from(roleProfile)
    .leftJoin(person, eq(person.roleProfileId, roleProfile.id))
    .groupBy(
      roleProfile.id,
      roleProfile.name,
      roleProfile.trackedSignals,
      roleProfile.quotaConfig,
      roleProfile.sourceChannels
    )
    .orderBy(asc(roleProfile.name));

  /**
   * ⚠️ `role_profile` HAS NO `auto_complete_rule` COLUMN — that lives on
   * `recurring_task`. The mockup's "Auto-complete rule" column on the ROLE table is
   * therefore derived from the recurring tasks belonging to that profile's people.
   * A profile whose people have no recurring task shows "Manual check-off", which
   * is the truthful reading rather than a blank.
   */
  const ruleRows = await db
    .select({
      id: recurringTask.id,
      cadence: recurringTask.cadence,
      rule: recurringTask.autoCompleteRule,
      fallbackManual: recurringTask.fallbackManual,
      ownerName: person.name,
      ownerRoleProfileId: person.roleProfileId
    })
    .from(recurringTask)
    .leftJoin(person, eq(person.id, recurringTask.ownerPersonId))
    .orderBy(asc(recurringTask.createdAt));

  // Which profiles have at least one rule, and what it watches.
  const ruleByProfile = new Map<string, { source?: string; event?: string }>();
  for (const r of ruleRows) {
    if (!r.ownerRoleProfileId) continue;
    if (ruleByProfile.has(r.ownerRoleProfileId)) continue;
    const parsed = ruleOf(r.rule);
    if (parsed.event) ruleByProfile.set(r.ownerRoleProfileId, parsed);
  }

  const roleProfiles: RoleProfileRow[] = profileRows.map((p) => {
    const rule = ruleByProfile.get(p.id);
    const channels = stringList(p.sourceChannels);

    return {
      id: p.id,
      name: p.name,
      peopleCount: p.peopleCount,
      peopleNames: p.peopleNames ? p.peopleNames.split(', ') : [],
      signals: stringList(p.trackedSignals),
      quotaLabel: quotaLabelOf(p.quotaConfig),
      ruleLabel: rule?.event ? watchedSignalLabel(rule.source, rule.event) : null,
      // The rule's source when there is one, else the profile's first configured
      // channel — both real, and the rule is the more specific answer.
      sourceLabel: rule?.source
        ? titleCase(rule.source)
        : channels[0]
          ? titleCase(channels[0])
          : null,
      status: roleProfileStatus(Boolean(rule?.event)),
      // ⚠️ The EXISTING admin surface. This page does not edit.
      editHref: `/dashboard/role-profiles/${p.id}`
    };
  });

  const rules: AutomationRuleRow[] = ruleRows.map((r, index) => {
    const parsed = ruleOf(r.rule);
    const hasRule = Boolean(parsed.event);
    const cadence = r.cadence as Cadence;
    const fired = sampleFired(index, cadence, hasRule, now);

    return {
      id: r.id,
      task: recurringLabel(parsed.event),
      ownerName: r.ownerName,
      cadence,
      watchedSignal: watchedSignalLabel(parsed.source, parsed.event),
      fallbackManual: r.fallbackManual,
      firedCount: fired.firedCount,
      lastFiredLabel: fired.lastFiredLabel,
      status: ruleStatus(hasRule, r.fallbackManual)
    };
  });

  return {
    roleProfiles,
    rules,
    // ⚠️ Covers the fired count and last-fired time ONLY.
    firedIsSample: true,
    now: now.toISOString()
  };
}
