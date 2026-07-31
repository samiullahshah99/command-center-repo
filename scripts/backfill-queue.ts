/**
 * Enqueue raw_event rows that never got a parse job.
 *
 *   pnpm tsx scripts/backfill-queue.ts [flags]
 *
 * Flags
 *   --dry-run        list what would be enqueued, send nothing  (DEFAULT)
 *   --commit         actually enqueue
 *   --source=NAME    limit to one source (slack|clickup|fireflies|ugc|vision)
 *   --limit=N        cap the number of rows (default 500)
 *   --force          include rows already processed=true, and rows that already
 *                    have a job. Use when re-running a rewritten parser.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Rows ingested before the handlers were wired to the queue have no job and will
 * never be picked up. This is also the recovery path for the one window the
 * transactional enqueue cannot close: Fireflies deliberately stores its event
 * even when enqueuing fails, because its retry behaviour is undocumented.
 *
 * ── Why it is not a cron ────────────────────────────────────────────────────
 * With insert and enqueue sharing a transaction there is no drift to sweep for
 * the four HMAC connectors — a row without a job is now a real anomaly, not a
 * routine race. Running this on a schedule would paper over that signal. Run it
 * by hand, look at what it finds, and only then automate if it keeps finding
 * things.
 *
 * Defaults to --dry-run because enqueuing is a side effect on a shared queue.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { loadEnvLocal } from './clickup/shared';

loadEnvLocal();

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  const known = ['--dry-run', '--commit', '--force'];
  const unknown = args.filter(
    (a) => !known.includes(a) && !a.startsWith('--source=') && !a.startsWith('--limit=')
  );
  if (unknown.length > 0) {
    console.error(`\n  ❌ Unknown argument "${unknown[0]}".`);
    console.error('     Flags: --dry-run | --commit | --source=NAME | --limit=N | --force\n');
    return 1;
  }

  const commit = args.includes('--commit');
  const force = args.includes('--force');
  const sourceArg = args.find((a) => a.startsWith('--source='))?.slice('--source='.length);
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.slice('--limit='.length) ?? 500);

  if (!Number.isFinite(limit) || limit < 1) {
    console.error('\n  ❌ --limit must be a positive number.\n');
    return 1;
  }

  const { db, pool } = await import('../src/db');
  const { rawEvent, RAW_EVENT_SOURCES } = await import('../src/db/schema');
  const { queueNameFor, sendParseJob, getBoss, stopBoss } = await import('../src/lib/queue');

  if (sourceArg && !RAW_EVENT_SOURCES.includes(sourceArg as never)) {
    console.error(`\n  ❌ Unknown source "${sourceArg}". Known: ${RAW_EVENT_SOURCES.join(', ')}\n`);
    await pool.end();
    return 1;
  }

  type Src = (typeof RAW_EVENT_SOURCES)[number];
  const sources: Src[] = sourceArg ? [sourceArg as Src] : [...RAW_EVENT_SOURCES];

  // ── Which rows have a job PENDING right now? ──────────────────────────────
  // ⚠️ Only the non-terminal states count. pg-boss v12 keeps finished jobs in
  // pgboss.job with state 'completed' (there is no archive table — v11 had one,
  // v12 does not) until maintenance deletes them. Matching on any state would
  // treat "already ran once" as "already queued" and silently refuse to
  // re-enqueue a row that is still unprocessed — which is precisely the state
  // this script exists to fix.
  const queued = await db.execute<{ raw_event_id: string }>(sql`
    select distinct data->>'rawEventId' as raw_event_id
    from pgboss.job
    where name = any(${sql.param(sources.map(queueNameFor))})
      and state in ('created', 'active', 'retry')
      and data->>'rawEventId' is not null
  `);
  const alreadyQueued = new Set(queued.rows.map((r) => r.raw_event_id));

  // ── Candidate rows ────────────────────────────────────────────────────────
  const rows = await db
    .select({
      id: rawEvent.id,
      source: rawEvent.source,
      externalId: rawEvent.externalId,
      processed: rawEvent.processed,
      receivedAt: rawEvent.receivedAt
    })
    .from(rawEvent)
    .where(
      force
        ? inArray(rawEvent.source, sources as never[])
        : and(inArray(rawEvent.source, sources as never[]), eq(rawEvent.processed, false))
    )
    .orderBy(rawEvent.receivedAt)
    .limit(limit);

  const candidates = force ? rows : rows.filter((r) => !alreadyQueued.has(r.id));
  const skipped = rows.length - candidates.length;

  console.log(`\n  mode        ${commit ? '⚠️  COMMIT — jobs will be sent' : 'dry run'}`);
  console.log(`  sources     ${sources.join(', ')}`);
  console.log(`  limit       ${limit}${rows.length === limit ? '   ⚠️  HIT — more rows may remain' : ''}`);
  if (force) console.log('  force       on — ignoring processed and existing jobs');
  console.log(`  matched     ${rows.length} row(s)`);
  if (skipped > 0) console.log(`  skipped     ${skipped} (a job is already pending)`);
  console.log(`  to enqueue  ${candidates.length}\n`);

  if (candidates.length === 0) {
    console.log('  nothing to do.\n');
    await pool.end();
    return 0;
  }

  const bySource = new Map<string, number>();
  for (const r of candidates) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  for (const [s, n] of [...bySource].sort()) console.log(`    ${s.padEnd(10)} ${n}`);
  console.log('');

  if (!commit) {
    console.log('  dry run — nothing sent. Re-run with --commit to enqueue.\n');
    await pool.end();
    return 0;
  }

  // Ensures the queues exist before the first send; creating them is idempotent.
  await getBoss();

  let sent = 0;
  const failures: { id: string; message: string }[] = [];

  for (const row of candidates) {
    try {
      // No transaction here: the row is long since committed, so there is
      // nothing to be atomic with. Failures are collected, not thrown — one bad
      // row must not abandon the rest of the backfill.
      const jobId = await sendParseJob(row.source as Src, { rawEventId: row.id });
      if (jobId) sent += 1;
      else failures.push({ id: row.id, message: 'send() returned null' });
    } catch (err) {
      failures.push({ id: row.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(`  ✅ enqueued ${sent}/${candidates.length}`);
  if (failures.length > 0) {
    console.log(`  ❌ failed   ${failures.length}`);
    for (const f of failures.slice(0, 10)) console.log(`       ${f.id}  ${f.message}`);
    if (failures.length > 10) console.log(`       … and ${failures.length - 10} more`);
  }
  console.log('');

  await stopBoss({ graceful: false });
  await pool.end();
  return failures.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
