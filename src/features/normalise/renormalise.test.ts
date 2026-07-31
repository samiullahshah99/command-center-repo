/**
 * normaliseRawEvent against a REAL Postgres.
 *
 * The properties under test are database properties: the (raw_event_id,
 * source_seq) unique key, the upsert that makes replaying safe, and the id
 * stability Week 2's extraction pipeline will depend on. A mocked Drizzle would
 * assert that the mock upserts.
 *
 * ⚠️ SKIPPED without DATABASE_URL. Run with `pnpm test:db`.
 * Rows are namespaced by RUN and removed afterwards.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const HAS_DB = Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL);
const describeDb = HAS_DB ? describe : describe.skip;

const RUN = `itest-norm-${process.pid}-${Date.now()}`;

describeDb('normaliseRawEvent', () => {
  let db: typeof import('@/db').db;
  let pool: typeof import('@/db').pool;
  let normaliseRawEvent: typeof import('./index').normaliseRawEvent;
  let attributeEventsForIdentity: typeof import('./index').attributeEventsForIdentity;
  let NORMALISER_VERSION: number;

  async function seedRaw(source: string, payload: unknown, externalId: string) {
    const { rawEvent } = await import('@/db/schema');
    const [row] = await db
      .insert(rawEvent)
      .values({
        source,
        payload,
        externalId: `${RUN}-${externalId}`,
        receivedAt: new Date('2026-08-01T09:00:00.000Z')
      })
      .returning({ id: rawEvent.id });
    return row.id;
  }

  /**
   * ⚠️ db.execute() with raw SQL returns timestamps as STRINGS — Drizzle only
   * maps column types when the query goes through the query builder. Calling
   * .getTime() on them throws, so they are parsed here rather than at every
   * call site.
   */
  async function unifiedFor(rawEventId: string) {
    const r = await db.execute<{
      id: string;
      source_seq: number;
      event_type: string;
      occurred_at: string;
      occurred_at_source: string;
      person_id: string | null;
      person_identity_id: string | null;
      normaliser_version: number;
      created_at: string;
      updated_at: string;
    }>(sql`select * from unified_event where raw_event_id = ${rawEventId} order by source_seq`);

    return r.rows.map((row) => ({
      ...row,
      occurredAt: new Date(row.occurred_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }

  const VISION = {
    id: 'vis-1',
    event: 'brief.submitted',
    occurred_at: '2026-07-31T15:01:12.413115Z',
    environment: 'production',
    actor: { user_id: `${RUN}-clerk`, name: 'Test Person', email: null, editor_name: null },
    subject: { id: 'b-1', type: 'brief', label: 'Test Brief' },
    metadata: {}
  };

  beforeAll(async () => {
    ({ db, pool } = await import('@/db'));
    const mod = await import('./index');
    normaliseRawEvent = mod.normaliseRawEvent;
    attributeEventsForIdentity = mod.attributeEventsForIdentity;
    NORMALISER_VERSION = mod.NORMALISER_VERSION;
  }, 30_000);

  afterAll(async () => {
    // unified_event cascades from raw_event.
    await db.execute(sql`delete from raw_event where external_id like ${RUN + '%'}`);
    await db.execute(sql`delete from person_identity where external_id like ${RUN + '%'}`);
    await db.execute(sql`delete from person where name like ${RUN + '%'}`);
    await pool.end();
  }, 30_000);

  it('writes a unified_event and marks the raw_event processed', async () => {
    const rawId = await seedRaw('vision', VISION, 'basic');
    const result = await normaliseRawEvent(rawId);

    expect(result).toMatchObject({ written: 1, unmappable: false });

    const rows = await unifiedFor(rawId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_type: 'brief.submitted',
      occurred_at_source: 'payload',
      normaliser_version: NORMALISER_VERSION
    });

    const p = await db.execute<{ processed: boolean }>(
      sql`select processed from raw_event where id = ${rawId}`
    );
    expect(p.rows[0].processed).toBe(true);
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it('⚠️ re-running does NOT create a duplicate', async () => {
    const rawId = await seedRaw('vision', VISION, 'idem');

    await normaliseRawEvent(rawId);
    await normaliseRawEvent(rawId);
    await normaliseRawEvent(rawId);

    const rows = await unifiedFor(rawId);
    expect(rows).toHaveLength(1);
  });

  it('⚠️ re-running PRESERVES unified_event.id — Week 2 will reference it', async () => {
    // Delete-and-reinsert would satisfy "no duplicates" while silently breaking
    // every foreign key the extraction pipeline holds.
    const rawId = await seedRaw('vision', VISION, 'stable-id');

    await normaliseRawEvent(rawId);
    const before = (await unifiedFor(rawId))[0];

    await normaliseRawEvent(rawId);
    const after = (await unifiedFor(rawId))[0];

    expect(after.id).toBe(before.id);
    // created_at is history and must not move; updated_at is how you see a rebuild.
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it('a re-run picks up changed mapping output in place', async () => {
    const rawId = await seedRaw('vision', VISION, 'refresh');
    await normaliseRawEvent(rawId);

    // Simulate the payload being re-read after a mapping change by editing the
    // stored event; the same row must be refreshed, not duplicated.
    await db.execute(
      sql`update raw_event set payload = ${JSON.stringify({ ...VISION, event: 'brief.updated' })}::jsonb where id = ${rawId}`
    );
    await normaliseRawEvent(rawId);

    const rows = await unifiedFor(rawId);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe('brief.updated');
  });

  it('⚠️ a batched ClickUp payload yields one row PER history_item', async () => {
    const rawId = await seedRaw(
      'clickup',
      {
        event: 'taskUpdated',
        task_id: 't-1',
        team_id: '9',
        webhook_id: 'w',
        history_items: [
          { id: 'h1', date: '1785489973755', field: 'status', user: { id: 1, email: null } },
          { id: 'h2', date: '1785489999999', field: 'assignee', user: { id: 1, email: null } }
        ]
      },
      'batched'
    );

    await normaliseRawEvent(rawId);
    const rows = await unifiedFor(rawId);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source_seq)).toEqual([0, 1]);

    // And re-running still yields exactly two.
    await normaliseRawEvent(rawId);
    expect(await unifiedFor(rawId)).toHaveLength(2);
  });

  // ── Attribution ───────────────────────────────────────────────────────────

  it('attributes the event when the actor email matches a person', async () => {
    const { person } = await import('@/db/schema');
    const email = `${RUN}-match@example.com`;
    const [p] = await db
      .insert(person)
      .values({ name: `${RUN} Matched`, email })
      .returning({ id: person.id });

    const rawId = await seedRaw(
      'ugc',
      {
        id: 'u-1',
        type: 'creator.approved',
        occurred_at: '2026-07-31T13:06:10.892563Z',
        actor: { id: `${RUN}-ugc-actor`, name: 'Test', email },
        entity: { type: 'creator', id: 'c-1' }
      },
      'attributed'
    );

    const result = await normaliseRawEvent(rawId);
    expect(result.attributed).toBe(1);
    expect((await unifiedFor(rawId))[0].person_id).toBe(p.id);
  });

  it('⚠️ an unattributable event is STILL written, with a null person_id', async () => {
    // Vision sends email: null on every real event. Holding these back would
    // make the feed under-report with no visible gap.
    const rawId = await seedRaw('vision', VISION, 'unattributed');
    const result = await normaliseRawEvent(rawId);

    expect(result).toMatchObject({ written: 1, attributed: 0 });
    const [row] = await unifiedFor(rawId);
    expect(row.person_id).toBeNull();
    // But the identity WAS recorded, so it reaches the admin queue.
    expect(row.person_identity_id).not.toBeNull();
  });

  it('⚠️ linking an identity later back-fills its events with ONE update', async () => {
    // The payoff of storing person_identity_id: no re-normalisation needed.
    const rawId = await seedRaw('vision', VISION, 'backfill');
    await normaliseRawEvent(rawId);
    const [before] = await unifiedFor(rawId);
    expect(before.person_id).toBeNull();

    const { person } = await import('@/db/schema');
    const [p] = await db
      .insert(person)
      .values({ name: `${RUN} Late Link`, email: `${RUN}-late@example.com` })
      .returning({ id: person.id });

    const updated = await attributeEventsForIdentity(before.person_identity_id!, p.id);

    // ⚠️ More than one, and that IS the point: every Vision seed in this file
    // shares one actor, so a single UPDATE attributes that account's whole
    // history at once. Re-normalising each event would have been the
    // alternative.
    expect(updated).toBeGreaterThanOrEqual(1);
    expect((await unifiedFor(rawId))[0].person_id).toBe(p.id);
  });

  // ── Unmappable payloads ───────────────────────────────────────────────────

  it('⚠️ an unmappable payload writes nothing and stays UNPROCESSED', async () => {
    // Left visible in `WHERE processed = false` rather than silently consumed.
    const rawId = await seedRaw(
      'fireflies',
      { meetingId: 'v1-shape', eventType: 'old' },
      'unmappable'
    );
    const result = await normaliseRawEvent(rawId);

    expect(result).toMatchObject({ written: 0, unmappable: true });
    expect(await unifiedFor(rawId)).toHaveLength(0);

    const p = await db.execute<{ processed: boolean }>(
      sql`select processed from raw_event where id = ${rawId}`
    );
    expect(p.rows[0].processed).toBe(false);
  });

  it('records the received_at fallback rather than hiding it', async () => {
    const rawId = await seedRaw('vision', { ...VISION, occurred_at: 'nonsense' }, 'fallback');
    await normaliseRawEvent(rawId);
    const [row] = await unifiedFor(rawId);

    expect(row.occurred_at_source).toBe('received_at');
    expect(row.occurredAt.toISOString()).toBe('2026-08-01T09:00:00.000Z');
  });

  it('a missing raw_event is reported, not thrown', async () => {
    const r = await normaliseRawEvent('00000000-0000-0000-0000-000000000000');
    expect(r).toMatchObject({ written: 0, unmappable: true });
  });
});
