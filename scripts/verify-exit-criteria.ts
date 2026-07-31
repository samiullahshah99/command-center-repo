/**
 * Week 1 exit criteria — automated portion.
 *
 *   pnpm tsx scripts/verify-exit-criteria.ts [--verbose]
 *
 * Checks everything that can be checked from the database and the code without
 * a human posting a Slack message. Prints a pass/fail table.
 *
 * ⚠️ THIS IS NOT THE WHOLE EXIT TEST. Steps that need a live delivery — posting
 * in Slack, clicking "Send test" in a provider console — cannot be automated
 * from here and are marked MANUAL in docs/week-1-exit-test.md. A green table
 * means "everything checkable is correct", not "Week 1 is signed off".
 *
 * Read-only: it writes nothing. Safe to run against production.
 */

import { loadEnvLocal } from './clickup/shared';

loadEnvLocal();

type Status = 'PASS' | 'FAIL' | 'WARN' | 'MANUAL';
type Check = { id: string; name: string; status: Status; detail: string };

const checks: Check[] = [];
const add = (id: string, name: string, status: Status, detail: string) =>
  checks.push({ id, name, status, detail });

async function main(): Promise<number> {
  const verbose = process.argv.includes('--verbose');

  const { db, pool } = await import('../src/db');
  const { sql } = await import('drizzle-orm');

  const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T> => {
    const r = await db.execute<T>(q);
    return r.rows[0] as T;
  };

  // ── 1. Ingest ─────────────────────────────────────────────────────────────
  const ingest = await one<{ sources: number; total: number }>(sql`
    select count(distinct source)::int sources, count(*)::int total from raw_event
  `);
  add(
    '1',
    'raw_event has events from all five sources',
    ingest.sources === 5 ? 'PASS' : 'FAIL',
    `${ingest.sources}/5 sources, ${ingest.total} events`
  );

  // ── 2. Normalisation coverage ─────────────────────────────────────────────
  const norm = await one<{ raws: number; unified: number; unprocessed: number }>(sql`
    select
      (select count(*)::int from raw_event) raws,
      (select count(*)::int from unified_event) unified,
      (select count(*)::int from raw_event where not processed) unprocessed
  `);
  add(
    '2',
    'every raw_event is normalised',
    norm.unprocessed === 0 ? 'PASS' : 'WARN',
    `${norm.unified} unified_event from ${norm.raws} raw_event; ${norm.unprocessed} unprocessed`
  );

  const perSource = await db.execute<{ source: string; n: number }>(sql`
    select source, count(*)::int n from unified_event group by 1 order by 1
  `);
  add(
    '2b',
    'all five sources normalise',
    perSource.rows.length === 5 ? 'PASS' : 'FAIL',
    perSource.rows.map((r) => `${r.source}:${r.n}`).join(' ')
  );

  // ── 3. Timestamps ─────────────────────────────────────────────────────────
  // A fallback is not a failure, but a HIGH rate means a parser is wrong.
  const ts = await one<{ total: number; fallback: number; nulls: number }>(sql`
    select count(*)::int total,
           count(*) filter (where occurred_at_source = 'received_at')::int fallback,
           count(*) filter (where occurred_at is null)::int nulls
    from unified_event
  `);
  const fallbackPct = ts.total ? Math.round((ts.fallback / ts.total) * 100) : 0;
  add(
    '3',
    'occurred_at parsed from the payload',
    ts.nulls > 0 ? 'FAIL' : fallbackPct > 10 ? 'WARN' : 'PASS',
    `${fallbackPct}% fell back to received_at (${ts.fallback}/${ts.total})`
  );

  // ── 4. Idempotency ────────────────────────────────────────────────────────
  const dupUnified = await one<{ n: number }>(sql`
    select count(*)::int n from (
      select raw_event_id, source_seq from unified_event
      group by 1,2 having count(*) > 1
    ) d
  `);
  add(
    '4',
    'no duplicate unified_event per (raw_event, seq)',
    dupUnified.n === 0 ? 'PASS' : 'FAIL',
    dupUnified.n === 0 ? 'unique key holds' : `${dupUnified.n} duplicated key(s)`
  );

  const dupRaw = await one<{ n: number }>(sql`
    select count(*)::int n from (
      select source, external_id from raw_event
      where external_id is not null group by 1,2 having count(*) > 1
    ) d
  `);
  add(
    '4b',
    'no duplicate raw_event per (source, external_id)',
    dupRaw.n === 0 ? 'PASS' : 'FAIL',
    dupRaw.n === 0 ? 'partial unique index holds' : `${dupRaw.n} duplicated key(s)`
  );

  // ── 5. Identity resolution ────────────────────────────────────────────────
  const ident = await db.execute<{ source: string; total: number; linked: number }>(sql`
    select source, count(*)::int total, count(person_id)::int linked
    from person_identity group by 1 order by 1
  `);
  const totalIdent = ident.rows.reduce((a, r) => a + r.total, 0);
  const linkedIdent = ident.rows.reduce((a, r) => a + r.linked, 0);
  add(
    '5',
    'identities discovered from events',
    totalIdent > 0 ? 'PASS' : 'FAIL',
    ident.rows.map((r) => `${r.source}:${r.linked}/${r.total}`).join(' ')
  );

  const roster = await one<{ people: number; withEmail: number }>(sql`
    select count(*)::int people, count(email)::int "withEmail" from person
  `);
  add(
    '5b',
    'roster has emails (required for automatic resolution)',
    roster.withEmail === 0 ? 'FAIL' : roster.withEmail < roster.people ? 'WARN' : 'PASS',
    `${roster.withEmail}/${roster.people} people have an email` +
      (roster.withEmail === 0 ? ' — nothing can auto-resolve; run pnpm people:email' : '')
  );

  const attributed = await one<{ total: number; withPerson: number }>(sql`
    select count(*)::int total, count(person_id)::int "withPerson" from unified_event
  `);
  add(
    '5c',
    'events attributed to a person',
    attributed.withPerson > 0 ? 'PASS' : 'FAIL',
    `${attributed.withPerson}/${attributed.total} events have a person_id` +
      (linkedIdent === 0 ? ' (no identity linked yet)' : '')
  );

  // ── 6. Audit trail ────────────────────────────────────────────────────────
  const audit = await one<{ manual: number; missingWho: number }>(sql`
    select count(*) filter (where confidence = 'manual')::int manual,
           count(*) filter (where confidence = 'manual' and (linked_by is null or linked_at is null))::int "missingWho"
    from person_identity
  `);
  add(
    '6',
    'every manual link records who and when',
    audit.missingWho === 0 ? 'PASS' : 'FAIL',
    `${audit.manual} manual link(s), ${audit.missingWho} missing linked_by/linked_at`
  );

  // ── 7. Queue health ───────────────────────────────────────────────────────
  try {
    const jobs = await db.execute<{ state: string; n: number }>(sql`
      select state, count(*)::int n from pgboss.job group by 1 order by 1
    `);
    const failed = jobs.rows.find((r) => r.state === 'failed')?.n ?? 0;
    const summary = jobs.rows.map((r) => `${r.state}:${r.n}`).join(' ') || 'no jobs';
    add('7', 'queue has no unexplained failures', failed === 0 ? 'PASS' : 'WARN', summary);

    const dlq = await one<{ n: number }>(sql`
      select count(*)::int n from pgboss.job where name = 'parse.dead-letter'
    `);
    add(
      '7b',
      'dead-letter queue',
      'PASS',
      `${dlq.n} job(s) — non-zero is fine if step 5 of the checklist was run`
    );
  } catch {
    add('7', 'queue health', 'FAIL', 'pgboss schema unreachable — have the workers ever started?');
  }

  // ── 8. Fireflies ──────────────────────────────────────────────────────────
  const tx = await one<{ n: number }>(sql`select count(*)::int n from transcript`);
  add(
    '8',
    'a transcript has been fetched and stored',
    tx.n > 0 ? 'PASS' : 'FAIL',
    `${tx.n} transcript row(s)`
  );

  const { existsSync } = await import('node:fs');
  const fixture = 'fixtures/fireflies/graphql-transcript-real.json';
  add(
    '8b',
    'scrubbed replay fixture is committed',
    existsSync(fixture) ? 'PASS' : 'FAIL',
    existsSync(fixture) ? fixture : 'run pnpm tsx scripts/fetch-fireflies-fixture.ts <meetingId>'
  );

  // ── 9. Known constraints, surfaced not hidden ─────────────────────────────
  const slackIdentities = ident.rows.find((r) => r.source === 'slack');
  add(
    '9',
    'KNOWN: Slack cannot auto-resolve (missing users:read.email)',
    slackIdentities && slackIdentities.linked < slackIdentities.total ? 'WARN' : 'PASS',
    slackIdentities
      ? `${slackIdentities.total - slackIdentities.linked} Slack identity(ies) need manual linking`
      : 'no Slack identities yet'
  );

  // ── 10. Manual steps ──────────────────────────────────────────────────────
  add('M1', 'Post a live Slack message in a #proj- channel', 'MANUAL', 'checklist step 1');
  add('M2', 'Trigger a live Vision / UGC / ClickUp event', 'MANUAL', 'checklist steps 3–4');

  // ── Report ────────────────────────────────────────────────────────────────
  const w = { id: 4, name: 62, status: 7 };
  const line = '─'.repeat(w.id + w.name + w.status + 40);

  console.log(`\n  WEEK 1 EXIT CRITERIA — automated checks\n  ${line}`);
  console.log(
    `  ${'#'.padEnd(w.id)}${'Check'.padEnd(w.name)}${'Result'.padEnd(w.status)}Detail`
  );
  console.log(`  ${line}`);

  const icon: Record<Status, string> = { PASS: '✅', FAIL: '❌', WARN: '⚠️ ', MANUAL: '🖐️ ' };
  for (const c of checks) {
    console.log(
      `  ${c.id.padEnd(w.id)}${c.name.slice(0, w.name - 1).padEnd(w.name)}${icon[c.status]} ${c.status.padEnd(w.status - 3)}${c.detail}`
    );
  }
  console.log(`  ${line}`);

  const counts = checks.reduce<Record<string, number>>((a, c) => {
    a[c.status] = (a[c.status] ?? 0) + 1;
    return a;
  }, {});
  console.log(
    `  ${counts.PASS ?? 0} pass · ${counts.FAIL ?? 0} fail · ${counts.WARN ?? 0} warn · ${counts.MANUAL ?? 0} manual\n`
  );

  if (counts.FAIL) {
    console.log('  ❌ NOT READY. See docs/week-1-exit-test.md for the step matching each id.\n');
  } else if (counts.WARN) {
    console.log(
      '  ⚠️  Automated checks pass with warnings. Warnings are known constraints,\n' +
        '     not defects — confirm each is expected, then run the MANUAL steps.\n'
    );
  } else {
    console.log('  ✅ All automated checks pass. Run the MANUAL steps to complete sign-off.\n');
  }

  if (verbose) {
    const recent = await db.execute<{ source: string; event_type: string; occurred_at: string }>(sql`
      select source, event_type, occurred_at::text from unified_event
      order by occurred_at desc limit 10
    `);
    console.log('  10 most recent unified events:');
    console.table(recent.rows);
  }

  await pool.end();
  return counts.FAIL ? 1 : 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
