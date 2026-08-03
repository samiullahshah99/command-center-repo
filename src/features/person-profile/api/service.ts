// ============================================================
// Person profile Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/tracker/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED — queries.ts is consumed on both sides of the SSR
// handoff. Every export must be an async function; types live in ./types.ts.
// ============================================================

'use server';

import { desc, eq, sql } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import {
  candidateActionItem,
  person,
  personIdentity,
  project,
  roleProfile,
  trackedItem,
  unifiedEvent
} from '@/db/schema';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import { getOrCreateSummary } from '../ai/summarise';
import type { SummaryPromptInput } from '../ai/prompt';
import type {
  ActivityGap,
  OwnerConfidence,
  PersonProfile,
  ProfileEvent,
  ProfileItem,
  RegenerateResult
} from './types';

/** Resource-based check on every export — a Server Action is its own endpoint. */
async function requireUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

const TERMINAL: TrackedItemStatus[] = ['done', 'cancelled'];

/** Most recent observed events shown in the strip. Capped per the brief. */
const ACTIVITY_LIMIT = 5;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDay(x: Date): number {
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

/**
 * Whole days `due` is before `now`, at UTC DAY granularity.
 *
 * Day-level, not instant-level: a task due today is not overdue at 09:00 merely
 * because it was created at 08:00. Matches formatDueDate's comparison so the
 * counter and the row label can never disagree.
 */
function overdueDays(due: Date, now: Date): number | null {
  const diff = Math.round((utcDay(now) - utcDay(due)) / 86_400_000);
  return diff > 0 ? diff : null;
}

/**
 * Everything the profile page needs, in one call.
 *
 * ⚠️ `now` is resolved ONCE here, server-side, and every overdue decision on the
 * page derives from it — including the ones baked into the prompt. Computing
 * overdue in a cell renderer would compare against a different instant on the
 * server than in the browser and mismatch on the boundary. See CLAUDE.md.
 */
export async function getPersonProfile(personId: string): Promise<PersonProfile | null> {
  await requireUser();

  const now = new Date();

  const [p] = await db
    .select({
      id: person.id,
      name: person.name,
      email: person.email,
      role: roleProfile.name
    })
    .from(person)
    .leftJoin(roleProfile, eq(roleProfile.id, person.roleProfileId))
    .where(eq(person.id, personId))
    .limit(1);

  if (!p) return null;

  const [{ linked }] = await db
    .select({ linked: sql<number>`count(*)::int` })
    .from(personIdentity)
    .where(eq(personIdentity.personId, personId));

  const rows = await db
    .select({
      id: trackedItem.id,
      title: trackedItem.title,
      projectId: trackedItem.projectId,
      projectName: project.name,
      status: trackedItem.status,
      dueDate: trackedItem.dueDate,
      riskFlag: trackedItem.riskFlag,
      lastUpdateAt: trackedItem.lastUpdateAt,
      originOwnerConfidence: candidateActionItem.ownerConfidence
    })
    .from(trackedItem)
    .leftJoin(project, eq(project.id, trackedItem.projectId))
    .leftJoin(candidateActionItem, eq(candidateActionItem.id, trackedItem.candidateActionItemId))
    .where(eq(trackedItem.ownerPersonId, personId))
    .orderBy(sql`${trackedItem.dueDate} asc nulls last`);

  const items: ProfileItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    projectId: r.projectId,
    projectName: r.projectName,
    status: r.status as TrackedItemStatus,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    originOwnerConfidence: (r.originOwnerConfidence as OwnerConfidence | null) ?? null,
    riskFlag: r.riskFlag,
    lastUpdateAt: r.lastUpdateAt ? r.lastUpdateAt.toISOString() : null
  }));

  const live = items.filter((i) => !TERMINAL.includes(i.status));
  const counts = {
    open: live.length,
    overdue: live.filter((i) => i.dueDate && overdueDays(new Date(i.dueDate), now) !== null).length,
    done: items.filter((i) => i.status === 'done').length,
    total: items.length
  };

  const eventRows = await db
    .select({
      id: unifiedEvent.id,
      source: unifiedEvent.source,
      eventType: unifiedEvent.eventType,
      occurredAt: unifiedEvent.occurredAt
    })
    .from(unifiedEvent)
    .where(eq(unifiedEvent.personId, personId))
    .orderBy(desc(unifiedEvent.occurredAt))
    .limit(ACTIVITY_LIMIT);

  const events: ProfileEvent[] = eventRows.map((e) => ({
    id: e.id,
    source: e.source,
    eventType: e.eventType,
    occurredAt: e.occurredAt.toISOString()
  }));

  // ⚠️ Two different empty states. "No linked accounts" is a fact about OUR data
  // with a fix the reader can act on; "no recent events" is a fact about them.
  // One message for both would hide a task.
  const activityGap: ActivityGap =
    events.length > 0 ? 'none' : linked === 0 ? 'no_identities' : 'no_recent_events';

  const promptInput: SummaryPromptInput = {
    name: p.name,
    role: p.role ?? 'no role profile',
    today: isoDay(now),
    openItems: live.map((i) => ({
      title: i.title ?? '(title held in the source system)',
      project: i.projectName ?? 'unfiled',
      status: i.status,
      dueDate: i.dueDate ? isoDay(new Date(i.dueDate)) : null,
      overdueDays: i.dueDate ? overdueDays(new Date(i.dueDate), now) : null
    })),
    recentlyCompleted: items
      .filter((i) => i.status === 'done')
      .slice(0, 5)
      .map((i) => ({
        title: i.title ?? '(untitled)',
        when: i.dueDate ? isoDay(new Date(i.dueDate)) : 'recently'
      })),
    events: events.map((e) => ({
      source: e.source,
      eventType: e.eventType,
      occurredAt: isoDay(new Date(e.occurredAt))
    }))
  };

  const outcome = await getOrCreateSummary(personId, promptInput);

  return {
    person: {
      id: p.id,
      name: p.name,
      initials: initialsOf(p.name),
      role: p.role,
      email: p.email,
      linkedIdentityCount: linked
    },
    counts,
    items,
    events,
    activityGap,
    summary: outcome.card,
    summaryUnavailable: outcome.unavailable
  };
}

/**
 * Manual regenerate.
 *
 * Bypasses BOTH staleness gates but still writes the fresh input_hash, so the
 * next automatic check compares against what was actually summarised rather
 * than against a stale fingerprint.
 */
export async function regeneratePersonSummary(personId: string): Promise<RegenerateResult> {
  // Its own auth check — this one spends money.
  await requireUser();

  const profile = await getPersonProfile(personId);
  if (!profile) return { ok: false, message: 'Person not found' };

  const now = new Date();
  const live = profile.items.filter((i) => !TERMINAL.includes(i.status));

  const outcome = await getOrCreateSummary(
    personId,
    {
      name: profile.person.name,
      role: profile.person.role ?? 'no role profile',
      today: isoDay(now),
      openItems: live.map((i) => ({
        title: i.title ?? '(title held in the source system)',
        project: i.projectName ?? 'unfiled',
        status: i.status,
        dueDate: i.dueDate ? isoDay(new Date(i.dueDate)) : null,
        overdueDays: i.dueDate ? overdueDays(new Date(i.dueDate), now) : null
      })),
      recentlyCompleted: profile.items
        .filter((i) => i.status === 'done')
        .slice(0, 5)
        .map((i) => ({
          title: i.title ?? '(untitled)',
          when: i.dueDate ? isoDay(new Date(i.dueDate)) : 'recently'
        })),
      events: profile.events.map((e) => ({
        source: e.source,
        eventType: e.eventType,
        occurredAt: isoDay(new Date(e.occurredAt))
      }))
    },
    { force: true }
  );

  if (!outcome.card) {
    return {
      ok: false,
      message:
        outcome.unavailable === 'no_data'
          ? 'Nothing tracked for this person yet — no summary to generate.'
          : 'Could not generate a summary just now.'
    };
  }
  return { ok: true, summary: outcome.card };
}

/** The roster, for cross-navigation between profiles. */
export async function getRoster(): Promise<{ id: string; name: string; initials: string }[]> {
  await requireUser();
  const rows = await db
    .select({ id: person.id, name: person.name })
    .from(person)
    .orderBy(person.name);
  return rows.map((r) => ({ ...r, initials: initialsOf(r.name) }));
}
