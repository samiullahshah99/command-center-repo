/**
 * Owner resolution, against a REAL Postgres.
 *
 * The roster and person_identity are read live, so mocking Drizzle would test
 * the mock. ⚠️ SKIPPED without DATABASE_URL. Run with `pnpm test:db`.
 *
 * ── A note on the names ─────────────────────────────────────────────────────
 * These are NOT prefixed with the run id, unlike every other integration test
 * here. They cannot be: the fuzzy matcher scores the whole `person.name`, so a
 * `itest-owner-123-` prefix would drag every similarity below threshold and the
 * tests would pass for the wrong reason.
 *
 * Instead the names are deliberately absurd enough that no real roster entry can
 * score near them, and every inserted id is tracked and deleted in afterAll.
 * Emails are still run-namespaced where the test does not depend on their shape.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, sql } from 'drizzle-orm';

const HAS_DB = Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL);
const describeDb = HAS_DB ? describe : describe.skip;

const RUN = `itest-owner-${process.pid}-${Date.now()}`;

/**
 * Every person name this file inserts. Kept in one list so the pre-run purge and
 * the post-run cleanup cannot drift apart — the drift is what leaves orphans.
 */
const SYNTHETIC_NAMES = [
  'Quorvax Blimberton',
  'Thessaly Yendlecroft',
  'Crenwick Vollabast',
  'Crenwick Vollabost'
] as const;

/**
 * The constraint name from a rejected statement.
 *
 * Drizzle wraps a pg failure in DrizzleQueryError whose own message is just the
 * SQL text — the constraint name lives on `.cause`. Asserting on the outer
 * message would pass for ANY failed query, including a typo in the test.
 */
async function constraintViolation(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause;
    return cause?.message ?? (err as Error).message;
  }
  throw new Error('expected the statement to be rejected, but it succeeded');
}

// ⚠️ ONE pool teardown for the whole file. Ending it inside the first
// describe's afterAll would close the connection before the second block runs.
if (HAS_DB) {
  afterAll(async () => {
    const { pool } = await import('@/db');
    await pool.end();
  });
}

describeDb('resolveOwner', () => {
  let db: typeof import('@/db').db;
  let resolveOwner: typeof import('./owner').resolveOwner;

  const personIds: string[] = [];
  const identityIds: string[] = [];
  let quorvaxId: string;
  let thessalyId: string;

  async function makePerson(name: string, email: string | null): Promise<string> {
    const { person } = await import('@/db/schema');
    const [row] = await db.insert(person).values({ name, email }).returning({ id: person.id });
    personIds.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    ({ db } = await import('@/db'));
    ({ resolveOwner } = await import('./owner'));

    const { personIdentity } = await import('@/db/schema');

    // ⚠️ Purge first. These names cannot be run-namespaced (see the file header),
    // so a previous run that crashed before its afterAll leaves rows behind and
    // the next run dies on person_email_lower_idx — a confusing failure that has
    // nothing to do with the code under test. Only the fixed synthetic names
    // below are touched; the real roster shares none of them.
    await db.execute(sql`
      delete from person
      where name = any(${sql.raw(`array[${SYNTHETIC_NAMES.map((n) => `'${n}'`).join(',')}]`)})
    `);

    quorvaxId = await makePerson('Quorvax Blimberton', `quorvax.blimberton@example.com`);
    thessalyId = await makePerson('Thessaly Yendlecroft', `${RUN}-thessaly@example.com`);

    // An already-LINKED identity. The exact path trusts this because a human or
    // an email match established it — the display name is only the lookup handle.
    const [ident] = await db
      .insert(personIdentity)
      .values({
        source: 'slack',
        externalId: `${RUN}-U01`,
        displayName: 'Grimwald Pfeffernuss',
        personId: quorvaxId,
        // The coherence CHECK requires all three together: a linked row must
        // carry a confidence AND a linkedAt.
        confidence: 'manual',
        linkedAt: new Date()
      })
      .returning({ id: personIdentity.id });
    identityIds.push(ident.id);
  });

  afterAll(async () => {
    const { person, personIdentity } = await import('@/db/schema');
    if (identityIds.length) {
      await db.delete(personIdentity).where(inArray(personIdentity.id, identityIds));
    }
    // Any identity the resolver may have created against these people.
    // inArray, not `any(${personIds})` — Drizzle expands a JS array into
    // separate bind params, which ANY() rejects as "requires array on right side".
    if (personIds.length) {
      await db.delete(personIdentity).where(inArray(personIdentity.personId, personIds));
    }
    if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  });

  it('EXACT — an already-linked identity display name resolves to its person', async () => {
    const r = await resolveOwner({ ownerName: 'Grimwald Pfeffernuss' });
    expect(r.ownerConfidence).toBe('exact');
    expect(r.ownerPersonId).toBe(quorvaxId);
  });

  it('EXACT is case-insensitive', async () => {
    const r = await resolveOwner({ ownerName: 'grimwald pfeffernuss' });
    expect(r.ownerConfidence).toBe('exact');
  });

  it('EMAIL — a participant email resolves when its local part resembles the name', async () => {
    const r = await resolveOwner({
      ownerName: 'Quorvax Blimberton',
      meetingEmails: ['quorvax.blimberton@example.com']
    });
    expect(r.ownerPersonId).toBe(quorvaxId);
    // 'exact' would also be acceptable if an identity happened to match; what
    // matters is that it is not a guess.
    expect(['email', 'exact']).toContain(r.ownerConfidence);
  });

  it('⚠️ EMAIL is NOT taken by position in participants[]', async () => {
    // Fireflies' speakers[] carries {id, name} and nothing links a speaker to an
    // entry in participants[] — the orders are not guaranteed to correspond.
    // Trusting position would attribute one person's commitments to another.
    const r = await resolveOwner({
      ownerName: 'Thessaly Yendlecroft',
      // The only email present belongs to somebody else entirely.
      meetingEmails: ['quorvax.blimberton@example.com']
    });
    expect(r.ownerPersonId).not.toBe(quorvaxId);
  });

  it('FUZZY — a near-miss spelling is offered as a suggestion, not a link', async () => {
    const r = await resolveOwner({ ownerName: 'Thessaly Yendlecroff' });
    expect(r.ownerConfidence).toBe('fuzzy');
    expect(r.ownerPersonId).toBe(thessalyId);
    expect(r.reason).toMatch(/UNVERIFIED/);
  });

  it('UNRESOLVED — a name nobody on the roster resembles', async () => {
    const r = await resolveOwner({ ownerName: 'Bartholomew Kzynthrop' });
    expect(r.ownerConfidence).toBe('unresolved');
    expect(r.ownerPersonId).toBeNull();
  });

  it('UNRESOLVED — an empty owner name', async () => {
    const r = await resolveOwner({ ownerName: '   ' });
    expect(r.ownerConfidence).toBe('unresolved');
    expect(r.ownerPersonId).toBeNull();
  });

  it('⚠️ AMBIGUITY resolves to unresolved, NOT to the marginally better score', async () => {
    // Two people whose names differ by one character. A reviewer skimming a
    // queue tends to accept whatever is pre-filled, so a coin-flip suggestion is
    // worse than none: it launders a guess into an approval.
    const a = await makePerson('Crenwick Vollabast', null);
    const b = await makePerson('Crenwick Vollabost', null);
    expect(a).not.toBe(b);

    const r = await resolveOwner({ ownerName: 'Crenwick Vollabust' });
    expect(r.ownerConfidence).toBe('unresolved');
    expect(r.ownerPersonId).toBeNull();
    expect(r.reason).toMatch(/ambiguous/i);
  });

  it('⚠️ never returns a confidence person_identity would accept for a name match', async () => {
    // person_identity's CHECK has no 'fuzzy' value, deliberately. This asserts
    // the value stays confined to candidate_action_item, which is a review queue.
    const r = await resolveOwner({ ownerName: 'Thessaly Yendlecroff' });
    expect(r.ownerConfidence).toBe('fuzzy');
    // linked_at is supplied so the row is otherwise coherent — the rejection must
    // come from the confidence CHECK specifically, not from the coherence one,
    // which would make this test pass for the wrong reason.
    const violation = await constraintViolation(
      db.execute(sql`
        insert into person_identity (source, external_id, confidence, person_id, linked_at)
        values ('slack', ${`${RUN}-reject`}, 'fuzzy', ${thessalyId}, now())
      `)
    );
    expect(violation).toMatch(/person_identity_confidence_ck/);
  });

  it('a resolved owner and a null owner are never both reported as linkable', async () => {
    const resolved = await resolveOwner({ ownerName: 'Grimwald Pfeffernuss' });
    const missing = await resolveOwner({ ownerName: 'Bartholomew Kzynthrop' });
    expect(resolved.ownerPersonId).not.toBeNull();
    expect(missing.ownerPersonId).toBeNull();
  });
});
