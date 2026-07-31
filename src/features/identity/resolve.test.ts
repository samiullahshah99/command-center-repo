/**
 * Identity resolution, against a REAL Postgres.
 *
 * The behaviours under test are database behaviours — a partial unique index, a
 * functional lower(email) index, CHECK constraints, ON CONFLICT. Mocking Drizzle
 * would assert that the mock behaves like the mock and would not catch a
 * constraint that rejects a row the code believes is fine.
 *
 * ⚠️ SKIPPED without DATABASE_URL. Run with `pnpm test:db`.
 *
 * Every row this file creates is namespaced by RUN and deleted afterwards, so it
 * cannot disturb the real roster or the unresolved queue.
 *
 * Actor shapes are taken from the REAL payloads stored in raw_event, not from
 * fixtures written against a guess. PII is scrubbed: emails use example.com and
 * names are synthetic.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const HAS_DB = Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL);
const describeDb = HAS_DB ? describe : describe.skip;

const RUN = `itest-ident-${process.pid}-${Date.now()}`;
const ext = (s: string) => `${RUN}-${s}`;
const mail = (s: string) => `${RUN}-${s}@example.com`.toLowerCase();

/**
 * The constraint name from a rejected statement.
 *
 * Drizzle wraps a pg failure in DrizzleQueryError, whose own message is just the
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

describeDb('resolvePerson', () => {
  let db: typeof import('@/db').db;
  let pool: typeof import('@/db').pool;
  let resolvePerson: typeof import('./resolve').resolvePerson;
  let unresolvedApi: typeof import('./unresolved');

  /** A throwaway person, cleaned up with the rest. */
  async function makePerson(label: string, email: string | null) {
    const { person } = await import('@/db/schema');
    const [row] = await db
      .insert(person)
      .values({ name: `${RUN} ${label}`, email })
      .returning({ id: person.id });
    return row.id;
  }

  async function identityRow(source: string, externalId: string) {
    const r = await db.execute<{
      person_id: string | null;
      confidence: string | null;
      linked_by: string | null;
      email: string | null;
      display_name: string | null;
    }>(sql`
      select person_id, confidence, linked_by, email, display_name
      from person_identity where source = ${source} and external_id = ${externalId}
    `);
    return r.rows[0] ?? null;
  }

  beforeAll(async () => {
    ({ db, pool } = await import('@/db'));
    ({ resolvePerson } = await import('./resolve'));
    unresolvedApi = await import('./unresolved');
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`delete from person_identity where external_id like ${RUN + '%'}`);
  });

  afterAll(async () => {
    await db.execute(sql`delete from person_identity where external_id like ${RUN + '%'}`);
    await db.execute(sql`delete from person where name like ${RUN + '%'}`);
    await pool.end();
  }, 30_000);

  // ── 1. EXACT ──────────────────────────────────────────────────────────────

  it('EXACT: an existing link resolves without touching email', async () => {
    const personId = await makePerson('exact', mail('exact'));
    const externalId = ext('vision-exact');

    const first = await resolvePerson({ source: 'vision', externalId, email: mail('exact') });
    expect(first).toMatchObject({ status: 'resolved', confidence: 'email', personId });

    // Second call finds the link from step 1 — note NO email is supplied, which
    // is the normal Vision case.
    const second = await resolvePerson({ source: 'vision', externalId });
    expect(second).toMatchObject({ status: 'resolved', confidence: 'exact', personId });
  });

  // ── 2. EMAIL ──────────────────────────────────────────────────────────────

  it('EMAIL: a match CREATES the link, so later events short-circuit at EXACT', async () => {
    const personId = await makePerson('email', mail('email'));
    const externalId = ext('clickup-228140872');

    const r = await resolvePerson({
      source: 'clickup',
      externalId,
      email: mail('email'),
      displayName: 'Test Member'
    });

    expect(r).toMatchObject({ status: 'resolved', confidence: 'email', personId });

    const row = await identityRow('clickup', externalId);
    expect(row).toMatchObject({ person_id: personId, confidence: 'email' });
    // Nobody confirmed it, so linked_by stays null — that is what distinguishes
    // an automatic link from a human decision.
    expect(row?.linked_by).toBeNull();
  });

  it('EMAIL matching is case-insensitive in both directions', async () => {
    const personId = await makePerson('case', `MiXeD-${RUN}@Example.COM`);
    const r = await resolvePerson({
      source: 'ugc',
      externalId: ext('ugc-case'),
      email: `mixed-${RUN}@example.com`.toUpperCase()
    });
    expect(r).toMatchObject({ status: 'resolved', confidence: 'email', personId });
  });

  // ── 3. UNRESOLVED ─────────────────────────────────────────────────────────

  it('UNRESOLVED: email present but no person has it — and the identity is STORED', async () => {
    const externalId = ext('vision-nomatch');
    const r = await resolvePerson({
      source: 'vision',
      externalId,
      email: mail('nobody-has-this')
    });

    expect(r).toMatchObject({ status: 'unresolved', reason: 'no_person_for_email' });

    // The point of the whole design: not dropped.
    const row = await identityRow('vision', externalId);
    expect(row).not.toBeNull();
    expect(row?.person_id).toBeNull();
    expect(row?.confidence).toBeNull();
  });

  it('UNRESOLVED: email null — the real Vision case — and the identity is STORED', async () => {
    // Verbatim actor shape from a real stored Vision event:
    //   {"name":"…","role":"admin","email":null,"user_id":"user_3F…","editor_name":null}
    const externalId = ext('user_3FENkTESTCLERKID');
    const r = await resolvePerson({
      source: 'vision',
      externalId,
      email: null,
      displayName: 'Test Person',
      editorName: null
    });

    expect(r).toMatchObject({ status: 'unresolved', reason: 'no_email' });

    const row = await identityRow('vision', externalId);
    expect(row?.person_id).toBeNull();
    expect(row?.display_name).toBe('Test Person');
  });

  it('an empty-string email counts as absent, not as a value', async () => {
    const r = await resolvePerson({ source: 'ugc', externalId: ext('ugc-empty'), email: '   ' });
    expect(r).toMatchObject({ status: 'unresolved', reason: 'no_email' });
  });

  // ── The three-Clerk-instances case ────────────────────────────────────────

  it('⚠️ the SAME external_id under two sources resolves INDEPENDENTLY', async () => {
    // Vision, UGC and Command Centre are separate Clerk instances. Ids from one
    // are unrelated strings to ids from another and may collide outright.
    // Matching on external_id alone would attribute one person's work to another.
    const visionPerson = await makePerson('vision-side', mail('vision-side'));
    const ugcPerson = await makePerson('ugc-side', mail('ugc-side'));

    const collidingId = ext('user_COLLIDING_CLERK_ID');

    const v = await resolvePerson({
      source: 'vision',
      externalId: collidingId,
      email: mail('vision-side')
    });
    const u = await resolvePerson({
      source: 'ugc',
      externalId: collidingId,
      email: mail('ugc-side')
    });

    expect(v).toMatchObject({ status: 'resolved', personId: visionPerson });
    expect(u).toMatchObject({ status: 'resolved', personId: ugcPerson });
    expect(v.status === 'resolved' && u.status === 'resolved' && v.personId).not.toBe(
      u.status === 'resolved' ? u.personId : null
    );

    // Two distinct rows, not one overwritten twice.
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from person_identity where external_id = ${collidingId}`
    );
    expect(rows.rows[0].n).toBe(2);
  });

  // ── Name matching must never resolve ──────────────────────────────────────

  it('⚠️ display_name NEVER auto-resolves, even on an exact name match', async () => {
    // A name collision would silently attribute one person's work to another,
    // and nobody goes looking for that. Names are a Phase 3 SUGGESTION only.
    const personId = await makePerson('Distinctive Name', mail('named'));
    const [p] = await db
      .select()
      .from((await import('@/db/schema')).person)
      .where(sql`id = ${personId}`);

    const r = await resolvePerson({
      source: 'slack',
      externalId: ext('U0TESTSLACKID'),
      email: null,
      // Byte-identical to the person's name.
      displayName: p.name
    });

    expect(r.status).toBe('unresolved');
    expect(r).toMatchObject({ reason: 'no_email' });
  });

  it('⚠️ editor_name NEVER auto-resolves either', async () => {
    const personId = await makePerson('Editor Person', mail('editor'));
    const [p] = await db
      .select()
      .from((await import('@/db/schema')).person)
      .where(sql`id = ${personId}`);

    const r = await resolvePerson({
      source: 'vision',
      externalId: ext('vision-editorname'),
      email: null,
      editorName: p.name
    });

    expect(r.status).toBe('unresolved');
  });

  // ── Durability of a learned email ─────────────────────────────────────────

  it('⚠️ a later event with a NULL email does not erase a known one', async () => {
    // Vision sends email: null routinely. If the upsert assigned rather than
    // COALESCEd, the second event would wipe the address and un-resolve an
    // account that was already linked.
    const personId = await makePerson('durable', mail('durable'));
    const externalId = ext('vision-durable');

    await resolvePerson({ source: 'vision', externalId, email: mail('durable') });
    const second = await resolvePerson({ source: 'vision', externalId, email: null });

    expect(second).toMatchObject({ status: 'resolved', personId });
    const row = await identityRow('vision', externalId);
    expect(row?.email).toBe(mail('durable'));
  });

  it('an email learned LATER resolves an identity first seen without one', async () => {
    const personId = await makePerson('late', mail('late'));
    const externalId = ext('ugc-late');

    const first = await resolvePerson({ source: 'ugc', externalId, email: null });
    expect(first.status).toBe('unresolved');

    const second = await resolvePerson({ source: 'ugc', externalId, email: mail('late') });
    expect(second).toMatchObject({ status: 'resolved', confidence: 'email', personId });
  });

  // ── The unresolved queue ──────────────────────────────────────────────────

  it('unresolved identities appear in the queue and leave it once linked', async () => {
    const externalId = ext('slack-queue');
    const r = await resolvePerson({ source: 'slack', externalId, displayName: 'Queued User' });
    expect(r.status).toBe('unresolved');

    const queue = await unresolvedApi.listUnresolvedIdentities({ source: 'slack' });
    expect(queue.some((q) => q.externalId === externalId)).toBe(true);

    const personId = await makePerson('manual-target', mail('manual-target'));
    const linked = await unresolvedApi.linkIdentityToPerson({
      identityId: r.identityId,
      personId,
      linkedBy: 'tester@example.com'
    });
    expect(linked.linked).toBe(true);

    const after = await unresolvedApi.listUnresolvedIdentities({ source: 'slack' });
    expect(after.some((q) => q.externalId === externalId)).toBe(false);

    const row = await identityRow('slack', externalId);
    expect(row).toMatchObject({ confidence: 'manual', linked_by: 'tester@example.com' });
  });

  it('a manual link is not overwritten by a later automatic email match', async () => {
    // Someone decided; an address match must not silently override them.
    const manualPerson = await makePerson('manual-wins', mail('manual-wins'));
    const emailPerson = await makePerson('email-loses', mail('email-loses'));
    const externalId = ext('vision-manualwins');

    const r = await resolvePerson({ source: 'vision', externalId });
    await unresolvedApi.linkIdentityToPerson({
      identityId: r.identityId,
      personId: manualPerson,
      linkedBy: 'human@example.com'
    });

    const again = await resolvePerson({
      source: 'vision',
      externalId,
      email: mail('email-loses')
    });

    expect(again).toMatchObject({ status: 'resolved', personId: manualPerson });
    expect(emailPerson).not.toBe(manualPerson);
    const row = await identityRow('vision', externalId);
    expect(row?.confidence).toBe('manual');
  });

  it('a manual link requires linkedBy', async () => {
    const r = await resolvePerson({ source: 'slack', externalId: ext('slack-nolinker') });
    await expect(
      unresolvedApi.linkIdentityToPerson({
        identityId: r.identityId,
        personId: await makePerson('x', mail('x')),
        linkedBy: '  '
      })
    ).rejects.toThrow(/linkedBy/);
  });

  // ── Constraints are structural, not conventional ──────────────────────────

  it('the provenance CHECK rejects a link with no confidence', async () => {
    const personId = await makePerson('ck', mail('ck'));
    const msg = await constraintViolation(
      db.execute(sql`
        insert into person_identity (person_id, source, external_id, confidence, linked_at)
        values (${personId}, 'slack', ${ext('ck-bad')}, null, null)
      `)
    );
    expect(msg).toMatch(/person_identity_link_provenance_ck/);
  });

  it('the provenance CHECK also rejects a confidence with no link', async () => {
    const msg = await constraintViolation(
      db.execute(sql`
        insert into person_identity (source, external_id, confidence, linked_at)
        values ('slack', ${ext('ck-bad2')}, 'exact', now())
      `)
    );
    expect(msg).toMatch(/person_identity_link_provenance_ck/);
  });

  it('the confidence CHECK rejects a "name" tier — there is deliberately none', async () => {
    const personId = await makePerson('ck-name', mail('ck-name'));
    const msg = await constraintViolation(
      db.execute(sql`
        insert into person_identity (person_id, source, external_id, confidence, linked_at)
        values (${personId}, 'slack', ${ext('ck-name')}, 'name', now())
      `)
    );
    expect(msg).toMatch(/person_identity_confidence_ck/);
  });

  it('the source CHECK rejects an unknown system', async () => {
    const msg = await constraintViolation(
      db.execute(sql`
        insert into person_identity (source, external_id) values ('notion', ${ext('ck-src')})
      `)
    );
    expect(msg).toMatch(/person_identity_source_ck/);
  });

  it('(source, external_id) is unique', async () => {
    await resolvePerson({ source: 'slack', externalId: ext('dupe') });
    const msg = await constraintViolation(
      db.execute(sql`
        insert into person_identity (source, external_id) values ('slack', ${ext('dupe')})
      `)
    );
    expect(msg).toMatch(/person_identity_source_external_id_key/);
  });
});
