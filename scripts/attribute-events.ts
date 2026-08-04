/**
 * Stamp `unified_event.person_id` from identities that are ALREADY linked.
 *
 *   pnpm events:attribute [--commit] [--source=NAME]
 *
 * Dry run by default: this rewrites who real work belongs to, and a wrong
 * attribution is silent.
 *
 * ── Why this exists, and why the neighbours do not cover it ─────────────────
 * `unified_event` carries BOTH `person_identity_id` (always) and `person_id` (a
 * denormalised convenience, stamped at normalisation time). An event normalised
 * BEFORE its identity was linked keeps `person_id = NULL` forever — nothing
 * re-examines it, because no new event necessarily follows.
 *
 *   • `identities:relink` selects `WHERE pi.person_id IS NULL`, so an identity
 *     linked BY HAND in the admin UI is excluded before it ever reaches that
 *     script's back-fill call. That is precisely the case this covers.
 *   • `identities:backfill` talks to the ClickUp/Slack APIs and cannot see
 *     Vision, UGC or Fireflies identities at all.
 *   • `renormalise` would work, but it re-does every mapping step to reach the
 *     same UPDATE — far more machinery, and it rewrites `unified_event` rows
 *     that `candidate_action_item` holds foreign keys to.
 *
 * ⚠️ NO ROWS ARE CREATED OR DELETED. This is one UPDATE per identity, in place —
 * which is the entire payoff of storing `person_identity_id` on the event.
 * `candidate_action_item.unified_event_id` FKs stay valid because the rows never
 * move.
 *
 * ⚠️ IDEMPOTENT by construction, not by convention: the shared
 * `attributeEventsForIdentity` filters `person_id IS NULL`, so a second run
 * matches nothing and reports 0. It also never overwrites an existing
 * attribution — a person_id already set by hand wins.
 *
 * ⚠️ Calls the SAME `attributeEventsForIdentity` the normaliser and
 * `identities:relink` use rather than writing its own UPDATE, so it cannot drift
 * from what the event path does.
 */

import { loadEnvLocal } from './clickup/shared';

loadEnvLocal();

type Row = {
  id: string;
  source: string;
  external_id: string;
  person_id: string;
  who: string | null;
  person_name: string | null;
  pending: number;
};

function usage(message?: string): never {
  if (message) console.error(`\n  ${message}`);
  console.error(`
  Stamp unified_event.person_id from already-linked identities.

    pnpm events:attribute                    dry run, all sources
    pnpm events:attribute --commit           write
    pnpm events:attribute --source=vision    one source only
`);
  process.exit(message ? 1 : 0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) usage();

  const commit = args.includes('--commit');
  const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1];

  const unknown = args.filter((a) => a !== '--commit' && !a.startsWith('--source='));
  if (unknown.length > 0) usage(`Unknown argument(s): ${unknown.join(', ')}`);

  const { db, pool } = await import('../src/db');
  const { sql } = await import('drizzle-orm');
  const { IDENTITY_SOURCES } = await import('../src/db/schema');
  const { attributeEventsForIdentity } = await import('../src/features/normalise');

  if (sourceArg && !IDENTITY_SOURCES.includes(sourceArg as never)) {
    usage(`Unknown source "${sourceArg}". Known: ${IDENTITY_SOURCES.join(', ')}`);
  }

  try {
    /**
     * Linked identities that still have unattributed events.
     *
     * The `pending > 0` filter via HAVING is what makes the report honest: an
     * identity whose events are all already stamped is not listed at all, so a
     * second run prints "nothing to do" rather than a wall of zeros.
     */
    const rows = (
      await db.execute<Row>(sql`
        select pi.id,
               pi.source,
               pi.external_id,
               pi.person_id,
               coalesce(pi.email, pi.display_name, pi.editor_name) as who,
               p.name as person_name,
               count(ue.id)::int as pending
        from person_identity pi
        join person p on p.id = pi.person_id
        join unified_event ue
          on ue.person_identity_id = pi.id
         and ue.person_id is null
        where pi.person_id is not null
          ${sourceArg ? sql`and pi.source = ${sourceArg}` : sql``}
        group by pi.id, pi.source, pi.external_id, pi.person_id, who, p.name
        order by pi.source, count(ue.id) desc
      `)
    ).rows;

    // Context: how much of unified_event is unattributed for reasons this script
    // CANNOT fix (identity exists but is linked to nobody, or no identity at all).
    const [{ total, unattributed, no_identity }] = (
      await db.execute<{ total: number; unattributed: number; no_identity: number }>(sql`
        select count(*)::int as total,
               count(*) filter (where person_id is null)::int as unattributed,
               count(*) filter (where person_identity_id is null)::int as no_identity
        from unified_event
      `)
    ).rows;

    console.log(`\n  mode          ${commit ? '⚠️  COMMIT' : 'dry run'}`);
    console.log(`  unified_event ${total} rows, ${unattributed} with person_id NULL`);
    console.log(`  fixable here  ${rows.reduce((a, r) => a + r.pending, 0)}\n`);

    if (rows.length === 0) {
      console.log('  Nothing to do — every linked identity already has its events stamped.');
      if (unattributed > 0) {
        console.log(
          `\n  ${unattributed} event(s) remain unattributed, but NOT for a reason this script fixes:`
        );
        console.log(`    ${no_identity} carry no person_identity_id at all (nothing to resolve from)`);
        console.log(
          `    the rest belong to identities not yet linked to a person — use /dashboard/identities,`
        );
        console.log('    then re-run this script.');
      }
      return;
    }

    const tally = new Map<string, { identities: number; events: number }>();
    let attributed = 0;

    for (const row of rows) {
      const acc = tally.get(row.source) ?? { identities: 0, events: 0 };
      acc.identities += 1;

      if (commit) {
        // The SAME helper the normaliser uses — one UPDATE, filtered to
        // person_id IS NULL, returning the rows it touched.
        const n = await attributeEventsForIdentity(row.id, row.person_id);
        acc.events += n;
        attributed += n;
      } else {
        acc.events += row.pending;
      }

      tally.set(row.source, acc);

      const label = `${row.who ?? row.external_id} → ${row.person_name}`;
      console.log(
        `  ${row.source.padEnd(10)} ${label.padEnd(44)} ${String(row.pending).padStart(4)} event(s)`
      );
    }

    console.log('\n  ── per source ──');
    for (const source of [...tally.keys()].sort()) {
      const t = tally.get(source)!;
      console.log(
        `     ${source.padEnd(10)} ${String(t.identities).padStart(3)} identity(ies)  ${String(t.events).padStart(4)} event(s) ${commit ? 'attributed' : 'would be attributed'}`
      );
    }

    if (commit) {
      const [{ still }] = (
        await db.execute<{ still: number }>(sql`
          select count(*) filter (where person_id is null)::int as still from unified_event
        `)
      ).rows;
      console.log(`\n  ── result ──`);
      console.log(`     attributed          ${attributed}`);
      console.log(`     still unattributed  ${still} (identities not yet linked, or no identity)`);
      // Proves the claim rather than asserting it: no rows created or destroyed.
      const [{ after }] = (
        await db.execute<{ after: number }>(sql`select count(*)::int as after from unified_event`)
      ).rows;
      console.log(`     unified_event rows  ${after} (was ${total} — unchanged, UPDATE in place)`);
    } else {
      console.log('\n  dry run — nothing written. Re-run with --commit.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('\n  FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
