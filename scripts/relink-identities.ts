/**
 * Re-run resolution over identities already in the table.
 *
 *   pnpm tsx scripts/relink-identities.ts [--commit] [--source=NAME]
 *
 * Dry run by default: linking attributes real work to real people, and a wrong
 * link is silent.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * resolvePerson runs when an EVENT arrives. An identity seen before its person
 * had an email is recorded unresolved and then never re-examined, because no new
 * event necessarily follows. Adding emails to the roster therefore does nothing
 * retroactively — this closes that gap.
 *
 * Not covered by the neighbours:
 *   - `renormalise` re-resolves only identities that appear in a raw_event, and
 *     re-does all the mapping work to get there.
 *   - `identities:backfill` fetches from the ClickUp/Slack APIs; it cannot see
 *     Vision, UGC or Fireflies identities, which arrive only via events.
 *
 * ⚠️ Calls the REAL resolvePerson rather than reimplementing the match, so this
 * cannot drift from what the event path does. In particular it inherits the rule
 * that display_name and editor_name are NEVER matched on.
 */

import { loadEnvLocal } from './clickup/shared';

loadEnvLocal();

type Outcome = 'linked' | 'already-linked' | 'no_email' | 'no_person_for_email';

type Row = {
  id: string;
  source: string;
  external_id: string;
  email: string | null;
  display_name: string | null;
  editor_name: string | null;
  events: number;
};

function usage(message?: string): never {
  if (message) console.error(`\n  ❌ ${message}`);
  console.error(`
  Usage: pnpm tsx scripts/relink-identities.ts [--commit] [--source=NAME]

    --commit        actually link (default: dry run)
    --source=NAME   slack | clickup | vision | ugc | fireflies | portal
`);
  process.exit(1);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--commit' && !a.startsWith('--source='));
  if (unknown.length > 0) usage(`Unknown argument "${unknown[0]}".`);

  const commit = args.includes('--commit');
  const sourceArg = args.find((a) => a.startsWith('--source='))?.slice('--source='.length);

  const { db, pool } = await import('../src/db');
  const { sql } = await import('drizzle-orm');
  const { IDENTITY_SOURCES } = await import('../src/db/schema');
  const { resolvePerson } = await import('../src/features/identity/resolve');
  const { attributeEventsForIdentity } = await import('../src/features/normalise');

  if (sourceArg && !IDENTITY_SOURCES.includes(sourceArg as never)) {
    usage(`Unknown source "${sourceArg}". Known: ${IDENTITY_SOURCES.join(', ')}`);
  }

  const rows = (
    await db.execute<Row>(sql`
      select pi.id, pi.source, pi.external_id, pi.email, pi.display_name, pi.editor_name,
             (select count(*)::int from unified_event ue where ue.person_identity_id = pi.id) events
      from person_identity pi
      where pi.person_id is null
        ${sourceArg ? sql`and pi.source = ${sourceArg}` : sql``}
      order by pi.source, pi.created_at
    `)
  ).rows;

  const [{ n: peopleWithEmail }] = (
    await db.execute<{ n: number }>(sql`select count(*)::int n from person where email is not null`)
  ).rows;

  console.log(`\n  mode        ${commit ? '⚠️  COMMIT' : 'dry run'}`);
  console.log(`  roster      ${peopleWithEmail} person row(s) have an email to match against`);
  console.log(`  unresolved  ${rows.length} identity(ies)${sourceArg ? ` in ${sourceArg}` : ''}\n`);

  if (rows.length === 0) {
    console.log('  nothing to do.\n');
    await pool.end();
    return 0;
  }

  // source -> outcome -> rows
  const tally = new Map<string, Map<Outcome, Row[]>>();
  const record = (row: Row, outcome: Outcome) => {
    if (!tally.has(row.source)) tally.set(row.source, new Map());
    const bySource = tally.get(row.source)!;
    if (!bySource.has(outcome)) bySource.set(outcome, []);
    bySource.get(outcome)!.push(row);
  };

  let attributedTotal = 0;

  for (const row of rows) {
    // ── Decide BEFORE writing anything ────────────────────────────────────
    //
    // ⚠️ resolvePerson cannot be used to ask "would this link?", because its
    // first act is an UPSERT that bumps `updated_at` whether or not anything
    // changes. `updated_at` is exposed as `lastSeenAt` in the admin queue, so a
    // re-run would make every long-stale identity look freshly seen and destroy
    // the signal a human triages by. Measured before this guard existed: three
    // consecutive --commit runs produced three different row fingerprints.
    //
    // Idempotent has to mean more than "links the same rows twice" — a second
    // run must leave the database byte-identical.
    //
    // The cost is one duplicated predicate (`lower(email) = …`). The LINK itself
    // is still performed by resolvePerson, so confidence, linked_at and the
    // concurrent-link race guard cannot drift from the event path.
    if (!row.email?.trim()) {
      record(row, 'no_email');
      continue;
    }

    const match = (
      await db.execute<{ id: string }>(sql`
        select id from person where lower(email) = ${row.email.trim().toLowerCase()} limit 1
      `)
    ).rows[0];

    if (!match) {
      record(row, 'no_person_for_email');
      continue;
    }

    if (!commit) {
      record(row, 'linked');
      continue;
    }

    // Only now is a write justified: something will actually change.
    const resolution = await resolvePerson({
      source: row.source as (typeof IDENTITY_SOURCES)[number],
      externalId: row.external_id,
      email: row.email,
      displayName: row.display_name,
      editorName: row.editor_name
    });

    if (resolution.status === 'resolved') {
      // Back-fill the events this identity already produced — one UPDATE,
      // because unified_event stores person_identity_id.
      attributedTotal += await attributeEventsForIdentity(row.id, resolution.personId);
      record(row, resolution.confidence === 'email' ? 'linked' : 'already-linked');
    } else {
      record(row, resolution.reason);
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const LABEL: Record<Outcome, string> = {
    linked: '✅ linked by email',
    'already-linked': '✅ already linked (resolved at EXACT)',
    no_email: '⏳ unresolved — SOURCE SENT NO EMAIL',
    no_person_for_email: '⏳ unresolved — email matches nobody on the roster'
  };

  for (const source of [...tally.keys()].sort()) {
    const bySource = tally.get(source)!;
    const total = [...bySource.values()].reduce((a, r) => a + r.length, 0);
    console.log(`  ── ${source} (${total}) ──`);

    for (const outcome of [
      'linked',
      'already-linked',
      'no_email',
      'no_person_for_email'
    ] as Outcome[]) {
      const list = bySource.get(outcome);
      if (!list?.length) continue;
      console.log(`     ${LABEL[outcome]}: ${list.length}`);
      for (const r of list) {
        const ev = r.events > 0 ? `  [${r.events} event${r.events === 1 ? '' : 's'}]` : '';
        const who = r.email ?? r.display_name ?? r.editor_name ?? '—';
        console.log(`       ${r.external_id.padEnd(28)} ${who}${ev}`);
      }
    }
    console.log('');
  }

  const count = (o: Outcome) =>
    [...tally.values()].reduce((a, m) => a + (m.get(o)?.length ?? 0), 0);

  console.log('  ── totals ──');
  console.log(`     linked                        ${count('linked') + count('already-linked')}`);
  console.log(`     still unresolved: no email    ${count('no_email')}`);
  console.log(`     still unresolved: no match    ${count('no_person_for_email')}`);
  if (commit) console.log(`     historical events attributed  ${attributedTotal}`);

  if (!commit) {
    console.log('\n  dry run — nothing written. Re-run with --commit.');
  }

  // The two remaining categories have DIFFERENT fixes, so they are named
  // separately rather than lumped into one "unresolved" number.
  if (count('no_email') > 0) {
    console.log(`
  ⏳ ${count('no_email')} identity(ies) carry no email. Nothing can link these
     automatically — the source never sent one. Slack event envelopes never do
     (run \`pnpm identities:backfill slack --commit\` to fetch addresses from
     users.list), and Vision sends actor.email: null on most events. The rest
     need a human at /dashboard/identities.`);
  }
  if (count('no_person_for_email') > 0) {
    console.log(`
  ⏳ ${count('no_person_for_email')} identity(ies) have an email that matches nobody.
     Either that person is not on the roster, or they are on it under a
     different address — one person can hold only ONE person.email, so a second
     address must be linked by hand at /dashboard/identities.`);
  }
  console.log('');

  await pool.end();
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
