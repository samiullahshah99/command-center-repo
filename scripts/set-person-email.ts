/**
 * Set a person's email — the bootstrap for automatic identity resolution.
 *
 *   pnpm tsx scripts/set-person-email.ts "Ardin" ardin@luckyfours.com
 *   pnpm tsx scripts/set-person-email.ts --list
 *
 * ── Why a script and not the seed ───────────────────────────────────────────
 * THIS REPO IS PUBLIC. Hardcoding six real work addresses into src/db/seed.ts
 * would commit real identities, which CLAUDE.md forbids and which we have
 * already had to scrub once from the ClickUp fixtures. Addresses are supplied at
 * run time and never enter git.
 *
 * ── Why this matters ────────────────────────────────────────────────────────
 * Email is the ONLY automatic cross-system join key: three separate Clerk
 * instances make ids incomparable, and names are display-only by decision. Until
 * a person has an email here, every identity belonging to them arrives
 * UNRESOLVED and needs linking by hand.
 */

import { loadEnvLocal } from './clickup/shared';

loadEnvLocal();

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const { db, pool } = await import('../src/db');
  const { person } = await import('../src/db/schema');
  const { eq, sql } = await import('drizzle-orm');

  if (args.includes('--list') || args.length === 0) {
    const rows = await db
      .select({ name: person.name, email: person.email })
      .from(person)
      .orderBy(person.name);
    console.log('\n  roster:');
    for (const r of rows) console.log(`    ${r.name.padEnd(12)} ${r.email ?? '— no email —'}`);
    console.log(`
  Set one with:
    pnpm tsx scripts/set-person-email.ts "<name>" <email>
`);
    await pool.end();
    return 0;
  }

  const [name, email] = args.filter((a) => !a.startsWith('--'));
  if (!name || !email) {
    console.error('\n  ❌ Usage: set-person-email.ts "<name>" <email>\n');
    await pool.end();
    return 1;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`\n  ❌ "${email}" does not look like an email address.\n`);
    await pool.end();
    return 1;
  }

  const updated = await db
    .update(person)
    // Stored as given; person_email_lower_idx enforces uniqueness on lower().
    .set({ email, updatedAt: new Date() })
    .where(eq(sql`lower(${person.name})`, name.toLowerCase()))
    .returning({ id: person.id, name: person.name, email: person.email });

  if (updated.length === 0) {
    console.error(`\n  ❌ No person named "${name}".  --list to see the roster.\n`);
    await pool.end();
    return 1;
  }

  console.log(`\n  ✅ ${updated[0].name} → ${updated[0].email}`);
  console.log('     Identities matching this address will now auto-link on their next event.\n');

  await pool.end();
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    // The functional unique index surfaces here when two people share an address.
    if (/person_email_lower_idx/.test(msg)) {
      console.error('\n  ❌ Another person already has that email — addresses must be unique.\n');
    } else {
      console.error(`\n  ❌ ${msg}\n`);
    }
    process.exit(1);
  });
