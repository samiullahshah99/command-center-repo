/**
 * Rebuild unified_event from raw_event.
 *
 *   pnpm tsx scripts/renormalise.ts [flags]
 *
 * Flags
 *   --commit              actually write (default is a dry run)
 *   --source=NAME         one source only
 *   --since=ISO|7d|24h    only raw_events received since then
 *   --stale               only rows whose normaliser_version is behind
 *   --unprocessed         only raw_events with processed = false
 *   --limit=N             cap the batch (default 1000)
 *
 * ── When you need this ──────────────────────────────────────────────────────
 * Every time mapping logic changes. raw_event is the source of truth and
 * unified_event is derived, so a mapping fix is applied by replaying, not by
 * patching rows by hand.
 *
 * ⚠️ Replaying UPSERTS on (raw_event_id, source_seq). It never duplicates and it
 * never changes a unified_event.id — Week 2's extraction pipeline will reference
 * those ids, so rebuilding must not invalidate them. `created_at` is preserved;
 * only `updated_at` moves, which is how you tell what was rebuilt.
 *
 * The typical flow after changing a normaliser:
 *   1. bump NORMALISER_VERSION in src/features/normalise/index.ts
 *   2. pnpm tsx scripts/renormalise.ts --stale            (see what is behind)
 *   3. pnpm tsx scripts/renormalise.ts --stale --commit
 */

import { loadEnvLocal } from './clickup/shared';

loadEnvLocal();

/** "7d" / "24h" / "30m" / an ISO date. */
function parseSince(value: string): Date | null {
  const rel = /^(\d+)([dhm])$/.exec(value.trim());
  if (rel) {
    const n = Number(rel[1]);
    const ms = rel[2] === 'd' ? 86_400_000 : rel[2] === 'h' ? 3_600_000 : 60_000;
    return new Date(Date.now() - n * ms);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function usage(message?: string): never {
  if (message) console.error(`\n  ❌ ${message}`);
  console.error(`
  Usage: pnpm tsx scripts/renormalise.ts [flags]

    --commit            write (default: dry run)
    --source=NAME       slack | clickup | vision | ugc | fireflies
    --since=ISO|7d|24h  only events received since then
    --stale             only rows behind the current NORMALISER_VERSION
    --unprocessed       only raw_events with processed = false
    --limit=N           default 1000
`);
  process.exit(1);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const known = ['--commit', '--stale', '--unprocessed'];
  const unknown = args.filter(
    (a) => !known.includes(a) && !/^--(source|since|limit)=/.test(a)
  );
  if (unknown.length > 0) usage(`Unknown argument "${unknown[0]}".`);

  const commit = args.includes('--commit');
  const staleOnly = args.includes('--stale');
  const unprocessedOnly = args.includes('--unprocessed');
  const valueOf = (f: string) => args.find((a) => a.startsWith(f))?.slice(f.length);

  const sourceArg = valueOf('--source=');
  const sinceArg = valueOf('--since=');
  const limit = Number(valueOf('--limit=') ?? 1000);
  if (!Number.isFinite(limit) || limit < 1) usage('--limit must be a positive number.');

  const since = sinceArg ? parseSince(sinceArg) : null;
  if (sinceArg && !since) usage(`Could not read --since="${sinceArg}". Use 7d, 24h, 30m or an ISO date.`);

  const { db, pool } = await import('../src/db');
  const { rawEvent, unifiedEvent, RAW_EVENT_SOURCES } = await import('../src/db/schema');
  const { normaliseRawEvent, NORMALISER_VERSION } = await import('../src/features/normalise');
  const { and, eq, gte, sql, inArray, desc } = await import('drizzle-orm');

  if (sourceArg && !RAW_EVENT_SOURCES.includes(sourceArg as never)) {
    usage(`Unknown source "${sourceArg}". Known: ${RAW_EVENT_SOURCES.join(', ')}`);
  }
  const sources = sourceArg ? [sourceArg] : [...RAW_EVENT_SOURCES];

  const clauses = [inArray(rawEvent.source, sources as never[])];
  if (since) clauses.push(gte(rawEvent.receivedAt, since));
  if (unprocessedOnly) clauses.push(eq(rawEvent.processed, false));

  // --stale: raw_events whose derived rows are behind, INCLUDING those that have
  // no derived row at all (a left join with a null id) — a row that never
  // normalised is as stale as one built by old logic.
  const rows = staleOnly
    ? await db
        .selectDistinct({ id: rawEvent.id, source: rawEvent.source, receivedAt: rawEvent.receivedAt })
        .from(rawEvent)
        .leftJoin(unifiedEvent, eq(unifiedEvent.rawEventId, rawEvent.id))
        .where(
          and(
            ...clauses,
            sql`(${unifiedEvent.id} IS NULL OR ${unifiedEvent.normaliserVersion} < ${NORMALISER_VERSION})`
          )
        )
        .orderBy(desc(rawEvent.receivedAt))
        .limit(limit)
    : await db
        .select({ id: rawEvent.id, source: rawEvent.source, receivedAt: rawEvent.receivedAt })
        .from(rawEvent)
        .where(and(...clauses))
        .orderBy(desc(rawEvent.receivedAt))
        .limit(limit);

  console.log(`\n  mode        ${commit ? '⚠️  COMMIT' : 'dry run'}`);
  console.log(`  version     ${NORMALISER_VERSION}`);
  console.log(`  sources     ${sources.join(', ')}`);
  if (since) console.log(`  since       ${since.toISOString()}`);
  if (staleOnly) console.log('  filter      stale only (missing or behind current version)');
  if (unprocessedOnly) console.log('  filter      unprocessed only');
  console.log(
    `  matched     ${rows.length} raw_event(s)${rows.length === limit ? '   ⚠️  HIT LIMIT — more may remain' : ''}`
  );

  const bySource = new Map<string, number>();
  for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  for (const [s, n] of [...bySource].sort()) console.log(`    ${s.padEnd(10)} ${n}`);

  if (rows.length === 0) {
    console.log('\n  nothing to do.\n');
    await pool.end();
    return 0;
  }

  if (!commit) {
    console.log('\n  dry run — nothing written. Re-run with --commit.\n');
    await pool.end();
    return 0;
  }

  let written = 0;
  let attributed = 0;
  let unmappable = 0;
  const failures: { id: string; message: string }[] = [];

  for (const row of rows) {
    try {
      const r = await normaliseRawEvent(row.id);
      if (r.unmappable) unmappable += 1;
      written += r.written;
      attributed += r.attributed;
    } catch (err) {
      // Collected, not thrown: one bad row must not abandon the rest of a
      // rebuild that may be thousands long.
      failures.push({ id: row.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(`\n  ✅ unified_event rows written/refreshed  ${written}`);
  console.log(`  ✅ attributed to a person                ${attributed}`);
  if (unmappable > 0) {
    console.log(`  ⏭️  unmappable (left unprocessed)         ${unmappable}`);
  }
  if (failures.length > 0) {
    console.log(`  ❌ failed                                ${failures.length}`);
    for (const f of failures.slice(0, 10)) console.log(`       ${f.id}  ${f.message}`);
    if (failures.length > 10) console.log(`       … and ${failures.length - 10} more`);
  }
  console.log('');

  await pool.end();
  return failures.length > 0 ? 1 : 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
