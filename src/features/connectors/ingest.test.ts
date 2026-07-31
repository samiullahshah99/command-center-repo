/**
 * ingestAndEnqueue integration tests.
 *
 * These run against a REAL Postgres and a REAL pg-boss, for the same reason the
 * queue tests do: the properties under test — ON CONFLICT DO NOTHING suppressing
 * a duplicate, and a job INSERT joining our transaction via fromDrizzle — belong
 * to Postgres and pg-boss. A mocked queue would only assert that the mock
 * implements the gate, which is exactly the circularity the route-level mocks
 * already have.
 *
 * ⚠️ SKIPPED without DATABASE_URL / DATABASE_PUBLIC_URL, because vitest.config.ts
 * deliberately does not load .env.local. Run them with:
 *
 *     pnpm test:db
 *
 * Every row is written with a unique `itest-` external id and deleted afterwards,
 * along with any job it queued, so the real backlog is never disturbed.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const HAS_DB = Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL);
const describeDb = HAS_DB ? describe : describe.skip;

/** Unique per run, so concurrent runs cannot collide. */
const RUN = `itest-${process.pid}-${Date.now()}`;
const key = (suffix: string) => `${RUN}-${suffix}`;

describeDb('ingestAndEnqueue', () => {
  let db: typeof import('@/db').db;
  let pool: typeof import('@/db').pool;
  let ingestAndEnqueue: typeof import('./ingest').ingestAndEnqueue;
  let stopBoss: typeof import('@/lib/queue').stopBoss;

  /** Jobs currently queued for a given raw_event id. */
  async function jobsFor(rawEventId: string): Promise<number> {
    const r = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from pgboss.job
      where data->>'rawEventId' = ${rawEventId}
    `);
    return r.rows[0]?.n ?? 0;
  }

  async function rowsFor(externalId: string): Promise<number> {
    const r = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from raw_event where external_id = ${externalId}
    `);
    return r.rows[0]?.n ?? 0;
  }

  beforeAll(async () => {
    ({ db, pool } = await import('@/db'));
    ({ ingestAndEnqueue } = await import('./ingest'));
    const queue = await import('@/lib/queue');
    stopBoss = queue.stopBoss;
    // Queues must exist before send(); creating them is idempotent.
    await queue.getBoss();
  }, 30_000);

  afterAll(async () => {
    await db.execute(sql`
      delete from pgboss.job
      where data->>'rawEventId' in (select id::text from raw_event where external_id like ${RUN + '%'})
    `);
    await db.execute(sql`delete from raw_event where external_id like ${RUN + '%'}`);
    await stopBoss({ graceful: false });
    await pool.end();
  }, 30_000);

  it('persists the row and queues exactly one job', async () => {
    const externalId = key('single');
    const result = await ingestAndEnqueue({
      source: 'slack',
      payload: { probe: true, externalId },
      externalId
    });

    expect(result.inserted).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.enqueued).toBe(true);
    expect(result.id).not.toBeNull();
    await expect(jobsFor(result.id!)).resolves.toBe(1);
  });

  it('⚠️ a duplicate delivery queues NO second job', async () => {
    // The requirement: providers retry routinely, and an ungated enqueue would
    // do the downstream work again on every retry.
    const externalId = key('dupe');
    const first = await ingestAndEnqueue({
      source: 'slack',
      payload: { n: 1 },
      externalId
    });
    const second = await ingestAndEnqueue({
      source: 'slack',
      payload: { n: 2 },
      externalId
    });

    expect(first.inserted).toBe(true);
    expect(first.enqueued).toBe(true);

    expect(second.inserted).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.enqueued).toBe(false);
    expect(second.id).toBeNull();

    // One row, and still only the one job from the first delivery.
    await expect(rowsFor(externalId)).resolves.toBe(1);
    await expect(jobsFor(first.id!)).resolves.toBe(1);
  });

  it('a null external id inserts and enqueues every time', async () => {
    // Setup test events (UGC test.ping, Vision control_center.test) take this
    // path deliberately, so each ping must land AND get its own job.
    const a = await ingestAndEnqueue({ source: 'ugc', payload: { ping: 1 }, externalId: null });
    const b = await ingestAndEnqueue({ source: 'ugc', payload: { ping: 2 }, externalId: null });

    expect(a.id).not.toBe(b.id);
    expect(a.enqueued).toBe(true);
    expect(b.enqueued).toBe(true);
    await expect(jobsFor(a.id!)).resolves.toBe(1);
    await expect(jobsFor(b.id!)).resolves.toBe(1);

    // Null-keyed rows are not matched by the `like` cleanup, so remove them here.
    await db.execute(sql`delete from pgboss.job where data->>'rawEventId' in (${a.id}, ${b.id})`);
    await db.execute(sql`delete from raw_event where id in (${a.id}, ${b.id})`);
  });

  it('the job names the row id and carries no payload', async () => {
    const externalId = key('shape');
    const result = await ingestAndEnqueue({
      source: 'vision',
      payload: { secret: 'should-not-be-copied-into-the-job' },
      externalId
    });

    const job = await db.execute<{ data: unknown }>(sql`
      select data from pgboss.job where data->>'rawEventId' = ${result.id}
    `);
    expect(job.rows).toHaveLength(1);
    expect(job.rows[0].data).toEqual({ rawEventId: result.id });
  });
});
