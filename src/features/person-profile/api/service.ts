// ============================================================
// Person profile Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/tracker/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED — queries.ts is consumed on both sides of the SSR
// handoff. Every export must be an async function; types live in ./types.ts.
// ============================================================

'use server';

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import {
  candidateActionItem,
  department,
  person,
  personIdentity,
  project,
  role,
  roleProfile,
  trackedItem,
  unifiedEvent
} from '@/db/schema';
import type { TrackedItemStatus } from '@/db/schema/tracked-item';
import { formatMeetingDate } from '@/lib/format-date';
import { getOrCreateSummary } from '../ai/summarise';
import type { SummaryPromptInput } from '../ai/prompt';
import type {
  ActivityGap,
  OwnerConfidence,
  PersonProfile,
  ProfileCalendar,
  ProfileEvent,
  ProfileEventStats,
  ProfileItem,
  ProfileMeetings,
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

/** The window the "Events (30d)" signal card counts over. */
const EVENT_WINDOW_DAYS = 30;

/**
 * Human labels for `tracked_item.source_type`.
 *
 * The column is a Postgres enum of ('meeting','slack','manual','system'); this is
 * the only place those four become display strings.
 */
const SOURCE_LABEL: Record<string, string> = {
  meeting: 'Meeting',
  slack: 'Slack',
  manual: 'Manual',
  system: 'System'
};

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

// ── Sample data ─────────────────────────────────────────────────────────────
//
// ⚠️⚠️ THE TWO FUNCTIONS BELOW RETURN INVENTED DATA. Both tabs they feed are
// marked `isSample: true`, and the UI renders a "Sample data" caption from that
// flag — the flag travels with the data precisely so a renderer cannot show one
// without the other.
//
// They live here, behind the existing service seam, rather than in the
// components, for one reason: this is the ONLY file that changes when the
// backends arrive. Mock data inside a component means the component is rewritten
// too, and the fake shape is what the real shape then gets bent to fit.
//
// ⚠️ CONTENT IS DELIBERATELY GENERIC. No real meeting titles, no real transcript
// prose, no real colleague names beyond the profile's own subject — this repo is
// PUBLIC, and a captured ClickUp response leaked a real work address once
// already. Attendees are role words, not people.
//
// ⚠️ EVERY DATE IS RELATIVE TO `now`. A hardcoded week stops being "this week"
// the following Monday, and a calendar showing last month reads as a broken
// integration rather than as sample data.

/** UTC midnight of the Monday of `now`'s week. */
function mondayOf(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  // getUTCDay: 0=Sun. Monday-start, so Sunday counts as the previous week.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

/**
 * TODO(backend): calendar integration.
 *
 * Confirmed in scope (frontend contract §4.1) but NO CODE EXISTS — no provider
 * client, no credentials, no `calendar_event` table. Audit §2.5 scopes it.
 * Replace this whole function with a real query and flip `isSample` to false;
 * nothing else on the page changes.
 */
function sampleCalendar(now: Date): ProfileCalendar {
  const monday = mondayOf(now);

  // Fixed shape per weekday, so the grid is stable across reloads rather than
  // reshuffling — a calendar that changes on refresh reads as live data.
  const perDay: { time: string; title: string; accent: number }[][] = [
    [
      { time: '09:30', title: 'Team standup', accent: 2 },
      { time: '14:00', title: 'Focus block', accent: 4 }
    ],
    [{ time: '11:00', title: 'Review session', accent: 1 }],
    [
      { time: '09:30', title: 'Team standup', accent: 2 },
      { time: '15:30', title: 'Planning', accent: 3 }
    ],
    [{ time: '13:00', title: 'Focus block', accent: 4 }],
    [{ time: '10:00', title: 'Weekly wrap-up', accent: 5 }]
  ];

  const days = perDay.map((blocks, i) => {
    const day = new Date(monday);
    day.setUTCDate(day.getUTCDate() + i);
    const key = day.toISOString().slice(0, 10);

    return {
      key,
      // Pinned locale + timezone, like everything else rendered here.
      label: day.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        timeZone: 'UTC'
      }),
      blocks: blocks.map((b, j) => ({
        id: `${key}-${j}`,
        time: b.time,
        title: b.title,
        accentVar: `var(--chart-${b.accent})`
      }))
    };
  });

  return { isSample: true, days };
}

/**
 * TODO(backend): fireflies attribution.
 *
 * The transcripts are REAL and already stored — six of them — but "this person's
 * meetings" cannot be queried: Fireflies webhooks carry a `meeting_id` and no
 * actor, so attribution sits at 0% of 10 events (audit D4). `speakers[]` is
 * `{id, name}` with no email, and name matching is never an auto-match at any
 * confidence level, so there is no honest join from a transcript to a person yet.
 *
 * When attribution lands, query `transcript` joined through the Fireflies
 * `unified_event`s for this person and flip `isSample` to false.
 */
function sampleMeetings(now: Date, personName: string): ProfileMeetings {
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - n);
    d.setUTCHours(10, 0, 0, 0);
    return d.toISOString();
  };

  return {
    isSample: true,
    items: [
      {
        id: 'sample-meeting-1',
        title: 'Weekly sync',
        tool: 'Fireflies',
        when: formatMeetingDate(daysAgo(2)),
        attendees: [personName, 'Ops lead', 'Support manager'],
        aiSummary:
          'Sample summary. The team reviewed open work, agreed two follow-ups and flagged one dependency as blocking. Replace when Fireflies attribution lands.',
        actions: [
          {
            id: 'sample-action-1',
            text: 'Write up the dependency and who owns it',
            ownerName: personName,
            state: 'open'
          },
          {
            id: 'sample-action-2',
            text: 'Circulate the revised timeline',
            ownerName: 'Ops lead',
            state: 'in_progress'
          }
        ]
      },
      {
        id: 'sample-meeting-2',
        title: 'Planning review',
        tool: 'Fireflies',
        when: formatMeetingDate(daysAgo(6)),
        attendees: [personName, 'Ops lead'],
        aiSummary:
          'Sample summary. Scope for the next cycle was agreed and one item was deferred. Replace when Fireflies attribution lands.',
        actions: [
          {
            id: 'sample-action-3',
            text: 'Confirm the deferred item with its requester',
            ownerName: personName,
            state: 'done'
          }
        ]
      }
    ]
  };
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
      // ⚠️ TWO SEPARATE AXES, joined from two different tables. `role_profile` is
      // work config (signals + quota); `role` is access. See src/db/schema/role.ts
      // — merging them is the mistake that table's header exists to prevent.
      role: roleProfile.name,
      roleDisplayName: role.displayName,
      deptName: department.name
    })
    .from(person)
    .leftJoin(roleProfile, eq(roleProfile.id, person.roleProfileId))
    .leftJoin(role, eq(role.id, person.roleId))
    .leftJoin(department, eq(department.id, person.departmentId))
    .where(eq(person.id, personId))
    .limit(1);

  if (!p) return null;

  const [{ linked }] = await db
    .select({ linked: sql<number>`count(*)::int` })
    .from(personIdentity)
    .where(eq(personIdentity.personId, personId));

  /**
   * Slack handle, for the subtitle line.
   *
   * ⚠️ Ordered by `linkedAt` so a re-linked account wins over a stale one, and
   * LIMITed to 1: `person_identity` allows several Slack accounts per person
   * (the unique key is on `(source, external_id)`), and picking arbitrarily would
   * make the subtitle flicker between them across requests.
   */
  const [slack] = await db
    .select({ displayName: personIdentity.displayName })
    .from(personIdentity)
    .where(and(eq(personIdentity.personId, personId), eq(personIdentity.source, 'slack')))
    .orderBy(desc(personIdentity.linkedAt))
    .limit(1);

  const rows = await db
    .select({
      id: trackedItem.id,
      title: trackedItem.title,
      projectId: trackedItem.projectId,
      projectName: project.name,
      status: trackedItem.status,
      sourceType: trackedItem.sourceType,
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
    // Unknown enum values fall back to the raw string rather than to a blank
    // pill — a missing label is a mapping gap worth seeing, not worth hiding.
    sourceLabel: SOURCE_LABEL[r.sourceType] ?? r.sourceType,
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

  /**
   * 30-day totals for the signal card.
   *
   * ⚠️ A SEPARATE QUERY, not derived from `events` above — that list is LIMITed to
   * five for the activity strip, so counting it would report "5" for anyone busy
   * and silently cap the card at the strip's length. Counting the strip is the
   * kind of bug that looks plausible in every test fixture small enough to write.
   *
   * ⚠️ Attributed events only, because `unified_event.person_id` is the join. UGC
   * and Fireflies are at 0% attribution (audit D4), so this legitimately reads 0
   * for people whose work arrives only through those sources — a gap in our
   * linking, not in their activity. The sub-line names the sources so a zero is
   * not read as idleness.
   */
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - EVENT_WINDOW_DAYS);

  const statRows = await db
    .select({ source: unifiedEvent.source, count: sql<number>`count(*)::int` })
    .from(unifiedEvent)
    .where(and(eq(unifiedEvent.personId, personId), gte(unifiedEvent.occurredAt, windowStart)))
    .groupBy(unifiedEvent.source)
    .orderBy(desc(sql`count(*)`));

  const eventStats: ProfileEventStats = {
    last30d: statRows.reduce((sum, r) => sum + r.count, 0),
    bySource: statRows.map((r) => ({ source: r.source, count: r.count }))
  };

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
      roleDisplayName: p.roleDisplayName,
      deptName: p.deptName,
      slackHandle: slack?.displayName ?? null,
      email: p.email,
      linkedIdentityCount: linked
    },
    counts,
    eventStats,
    items,
    events,
    // ⚠️ BOTH ARE INVENTED — see the sample-data block above. The `isSample` flag
    // rides along so the UI cannot render either without its caption.
    calendar: sampleCalendar(now),
    meetings: sampleMeetings(now, p.name),
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
