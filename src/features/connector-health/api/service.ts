// ============================================================
// Connector Health Service — Data Access Layer
// ============================================================
// 'use server' is REQUIRED: queries.ts is consumed on both sides of the SSR
// handoff, so this must be callable as RPC from the browser. Every export is an
// async function; types live in ./types.ts for that reason.
//
// READ-ONLY. This feature has no mutations and must never gain one — it is a
// window onto raw_event and pgboss.job, nothing more.
// ============================================================

'use server';

import { auth } from '@clerk/nextjs/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { rawEvent } from '@/db/schema';
import { RAW_EVENT_SOURCES, type RawEventSource } from '@/db/schema/raw-event';
import { QUEUE_PREFIX } from '@/lib/queue/types';
import { STALE_AFTER_HOURS } from '../constants/thresholds';
import type { ConnectorHealth, ConnectorRow, QueueHealth } from './types';

async function requireUser(): Promise<void> {
  // Resource-based check, not a reliance on src/proxy.ts: a Server Action is its
  // own POST endpoint and `createRouteMatcher` is deprecated because its path
  // matching can diverge from how Next.js routes.
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
}

function emptyQueue(): QueueHealth {
  return { completed: 0, retry: 0, failed: 0, pending: 0 };
}

/**
 * Connector health for every source.
 *
 * ⚠️ THREE QUERIES TOTAL, each spanning ALL sources — never one per source. With
 * five sources an N+1 would be fifteen round trips, and because this re-runs in
 * the browser as an RPC those are network hops rather than local statements.
 *
 * ⚠️ `pgboss.job` is queried with RAW SQL on purpose. drizzle-kit is scoped to
 * the `public` schema via `schemaFilter`, so pg-boss's tables are deliberately
 * absent from the Drizzle models — adding them would put queue internals under
 * our migrations. Its columns are also snake_case (`created_on`, `retry_count`),
 * unlike our camelCase models, so they are spelled out here.
 */
export async function getConnectorHealth(): Promise<ConnectorHealth> {
  await requireUser();

  // Resolved ONCE. Both windows and every relative label derive from this.
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();

  // ── 1. raw_event, per source. One GROUP BY; the windows are FILTER clauses so
  //       three counts and a max come off a single scan. ──────────────────────
  const eventRows = await db
    .select({
      source: rawEvent.source,
      countTotal: sql<number>`count(*)::int`,
      count24h: sql<number>`count(*) filter (where ${rawEvent.receivedAt} >= ${since24h})::int`,
      count7d: sql<number>`count(*) filter (where ${rawEvent.receivedAt} >= ${since7d})::int`,
      countToday: sql<number>`count(*) filter (where ${rawEvent.receivedAt} >= ${todayStart})::int`,
      lastEventAt: sql<string | null>`max(${rawEvent.receivedAt})::text`,
      unprocessed: sql<number>`count(*) filter (where ${rawEvent.processed} = false)::int`,
      oldestUnprocessed: sql<
        string | null
      >`min(${rawEvent.receivedAt}) filter (where ${rawEvent.processed} = false)::text`
    })
    .from(rawEvent)
    .groupBy(rawEvent.source);

  // ── 2. pgboss.job by queue + state, last 7d. One GROUP BY across every queue.
  const jobRes = await db.execute(sql`
    select name, state, count(*)::int as n
    from pgboss.job
    where created_on >= ${since7d}::timestamptz
    group by name, state
  `);
  const jobRows = ((jobRes as unknown as { rows?: unknown[] }).rows ??
    (jobRes as unknown as unknown[])) as { name: string; state: string; n: number }[];

  // ── Fold ──────────────────────────────────────────────────────────────────

  const byQueue = new Map<string, QueueHealth>();
  let jobsFailed = 0;
  let deadLettered = 0;

  for (const r of jobRows) {
    if (!byQueue.has(r.name)) byQueue.set(r.name, emptyQueue());
    const q = byQueue.get(r.name)!;

    switch (r.state) {
      case 'completed':
        q.completed += r.n;
        break;
      case 'retry':
        q.retry += r.n;
        break;
      case 'failed':
        q.failed += r.n;
        // Counted across EVERY queue, including extract.action-items, because the
        // header answers "is anything broken anywhere", not "is one parser broken".
        jobsFailed += r.n;
        break;
      default:
        // created / active — still owed work.
        q.pending += r.n;
    }

    if (r.name === `${QUEUE_PREFIX}.dead-letter`) deadLettered += r.n;
  }

  const eventBySource = new Map(eventRows.map((r) => [r.source, r]));

  /**
   * ⚠️ Built from RAW_EVENT_SOURCES, not from the query results. A source that
   * has never delivered anything has no `raw_event` rows and would simply be
   * absent from a results-driven list — silently vanishing from a health page at
   * exactly the moment its absence is the finding. Every source always renders.
   */
  const sources: ConnectorRow[] = RAW_EVENT_SOURCES.map((source: RawEventSource) => {
    const e = eventBySource.get(source);
    return {
      source,
      lastEventAt: e?.lastEventAt ? new Date(e.lastEventAt).toISOString() : null,
      count24h: e?.count24h ?? 0,
      count7d: e?.count7d ?? 0,
      countTotal: e?.countTotal ?? 0,
      queue: byQueue.get(`${QUEUE_PREFIX}.${source}`) ?? emptyQueue(),
      staleAfterHours: STALE_AFTER_HOURS[source]
    };
  });

  const eventsToday = eventRows.reduce((s, r) => s + r.countToday, 0);
  const unprocessedCount = eventRows.reduce((s, r) => s + r.unprocessed, 0);
  // `toSorted`, not `sort` — ISO strings sort lexicographically, and the source
  // array must not be mutated.
  const oldestUnprocessed = eventRows
    .map((r) => r.oldestUnprocessed)
    .filter((v): v is string => Boolean(v))
    .toSorted()[0];

  return {
    sources,
    eventsToday,
    jobsFailed,
    deadLettered,
    oldestUnprocessedAt: oldestUnprocessed ? new Date(oldestUnprocessed).toISOString() : null,
    unprocessedCount,
    now: now.toISOString()
  };
}
