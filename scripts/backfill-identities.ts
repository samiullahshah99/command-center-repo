/**
 * Seed person_identity from the member lists we can actually read.
 *
 *   pnpm tsx scripts/backfill-identities.ts <clickup|slack|all> [--commit]
 *
 * Dry run by default: writing identities links real events to real people, and
 * a wrong link is quiet.
 *
 * ── Coverage, honestly ──────────────────────────────────────────────────────
 *   clickup   ✅ /team returns {id, username, email} — auto-links by email
 *   slack     ⚠️  users.list/users.info return an email ONLY with the
 *                `users:read.email` scope, which we do NOT hold. Without it this
 *                fails with an actionable error and NOTHING is linked.
 *   vision    ❌ no member-list API is exposed to us
 *   ugc       ❌ ditto
 *   fireflies ❌ ditto
 *
 * Vision, UGC and Fireflies identities can only arrive on events, so there is
 * nothing to backfill for them — they appear in the unresolved queue as their
 * users act, and (because both Vision and UGC send `actor.email: null` much of
 * the time) many will need linking by hand.
 */

import { loadEnvLocal } from './clickup/shared';

loadEnvLocal();

type Target = 'clickup' | 'slack' | 'all';
const TARGETS: Target[] = ['clickup', 'slack', 'all'];

type Candidate = {
  source: 'clickup' | 'slack';
  externalId: string;
  email: string | null;
  displayName: string | null;
};

function usage(message?: string): never {
  if (message) console.error(`\n  ❌ ${message}`);
  console.error(`
  Usage: pnpm tsx scripts/backfill-identities.ts <${TARGETS.join('|')}> [--commit]

    --commit   actually write person_identity rows (default is a dry run)
`);
  process.exit(1);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--')) as Target | undefined;
  const commit = args.includes('--commit');

  if (!target) usage('No target given.');
  if (!TARGETS.includes(target)) usage(`Unknown target "${target}".`);

  const { db, pool } = await import('../src/db');
  const { person } = await import('../src/db/schema');
  const { resolvePerson } = await import('../src/features/identity/resolve');

  const roster = await db.select({ id: person.id, name: person.name, email: person.email }).from(person);
  const withEmail = roster.filter((p) => p.email);

  console.log(`\n  mode      ${commit ? '⚠️  COMMIT' : 'dry run'}`);
  console.log(`  roster    ${roster.length} people, ${withEmail.length} with an email`);

  if (withEmail.length === 0) {
    // Worth stopping on: every candidate would land unresolved and the run would
    // look like the connector was at fault.
    console.log(`
  ⚠️  NO PERSON HAS AN EMAIL, so nothing can auto-link — every identity below
      will be recorded as UNRESOLVED regardless of what the source returns.
      Populate person.email first (see scripts/set-person-email.ts).`);
  }

  const candidates: Candidate[] = [];
  let failed = false;

  // ── ClickUp ───────────────────────────────────────────────────────────────
  if (target === 'clickup' || target === 'all') {
    try {
      const { getTeams } = await import('../src/features/connectors/clickup/client');
      const teams = await getTeams();
      for (const team of teams) {
        for (const member of team.members) {
          candidates.push({
            source: 'clickup',
            // ⚠️ ClickUp ids are JSON numbers; external_id is text.
            externalId: String(member.user.id),
            email: member.user.email ?? null,
            displayName: member.user.username ?? null
          });
        }
      }
      console.log(`  clickup   ${candidates.filter((c) => c.source === 'clickup').length} member(s)`);
    } catch (err) {
      failed = true;
      console.error(`  ❌ clickup: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Slack ─────────────────────────────────────────────────────────────────
  if (target === 'slack' || target === 'all') {
    try {
      const { listUsers, isLinkableSlackUser, requireEmailScope } = await import(
        '../src/features/connectors/slack/client'
      );
      const all = await listUsers();
      // ⚠️ Must come before anything else uses the result. Slack returns 200 and
      // simply omits every email when the scope is absent, so without this the
      // backfill would report success and link nobody.
      requireEmailScope(all, 'users.list');

      const users = all.filter(isLinkableSlackUser);
      for (const u of users) {
        candidates.push({
          source: 'slack',
          externalId: u.id,
          email: u.profile?.email ?? null,
          displayName: u.profile?.real_name ?? u.real_name ?? u.name ?? null
        });
      }
      console.log(`  slack     ${users.length} member(s)`);
    } catch (err) {
      failed = true;
      const { SlackScopeError } = await import('../src/features/connectors/slack/client');
      if (err instanceof SlackScopeError) {
        console.error(`\n  ❌ SLACK BACKFILL CANNOT RUN\n\n     ${err.message}\n`);
      } else {
        console.error(`  ❌ slack: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (candidates.length === 0) {
    console.log('\n  nothing to do.\n');
    await pool.end();
    return failed ? 1 : 0;
  }

  console.log(`\n  candidates ${candidates.length}`);
  for (const c of candidates) {
    console.log(
      `    ${c.source.padEnd(8)} ${c.externalId.padEnd(14)} ${c.email ?? '(no email)'} ${
        c.displayName ? `— ${c.displayName}` : ''
      }`
    );
  }

  if (!commit) {
    console.log('\n  dry run — nothing written. Re-run with --commit.\n');
    await pool.end();
    return failed ? 1 : 0;
  }

  // resolvePerson does the whole job: it records the identity either way and
  // links it when the email matches, so this loop needs no matching logic of its
  // own — and cannot drift from what the event path does.
  const tally = { exact: 0, email: 0, unresolved: 0 };
  for (const c of candidates) {
    const r = await resolvePerson({
      source: c.source,
      externalId: c.externalId,
      email: c.email,
      displayName: c.displayName
    });
    if (r.status === 'resolved') tally[r.confidence] += 1;
    else tally.unresolved += 1;
  }

  console.log(`\n  ✅ linked (exact) ${tally.exact}`);
  console.log(`  ✅ linked (email) ${tally.email}`);
  console.log(`  ⏳ unresolved     ${tally.unresolved}  → admin queue\n`);

  await pool.end();
  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
