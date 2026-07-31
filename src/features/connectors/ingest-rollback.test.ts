/**
 * Atomicity of ingestAndEnqueue: a failed enqueue must take the row with it.
 *
 * Separate file because vi.mock is hoisted and applies to the WHOLE module
 * graph of a file — mocking the queue here would otherwise disable the real
 * pg-boss that ingest.test.ts depends on.
 *
 * The DATABASE is real. Only sendParseJob is replaced, with a throw, so the
 * rollback being asserted is a genuine Postgres rollback of a genuine Drizzle
 * transaction — not a mock pretending to roll back.
 *
 *     pnpm test:db
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

const HAS_DB = Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL);
const describeDb = HAS_DB ? describe : describe.skip;

const h = vi.hoisted(() => ({ shouldThrow: { value: true }, calls: 0 }));

vi.mock('@/lib/queue', () => ({
  sendParseJob: async () => {
    h.calls += 1;
    if (h.shouldThrow.value) throw new Error('simulated queue outage');
    return 'job-id';
  }
}));

const EXTERNAL_ID = `itest-rollback-${process.pid}-${Date.now()}`;

describeDb('ingestAndEnqueue atomicity', () => {
  let db: typeof import('@/db').db;
  let pool: typeof import('@/db').pool;
  let ingestAndEnqueue: typeof import('./ingest').ingestAndEnqueue;

  beforeAll(async () => {
    ({ db, pool } = await import('@/db'));
    ({ ingestAndEnqueue } = await import('./ingest'));
  }, 30_000);

  afterAll(async () => {
    await db.execute(sql`delete from raw_event where external_id = ${EXTERNAL_ID}`);
    await pool.end();
  }, 30_000);

  it('rolls the raw_event row back when the enqueue throws', async () => {
    // Without the shared transaction this row would be committed and then
    // orphaned — stored forever, never processed, and invisible as a problem.
    await expect(
      ingestAndEnqueue({
        source: 'slack',
        payload: { probe: 'rollback' },
        externalId: EXTERNAL_ID
      })
    ).rejects.toThrow(/simulated queue outage/);

    expect(h.calls).toBe(1);

    const r = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from raw_event where external_id = ${EXTERNAL_ID}`
    );
    expect(r.rows[0].n).toBe(0);
  });

  it('the caller sees the throw, so the route can answer 500 and be retried', async () => {
    // This is what makes the rollback safe: the provider redelivers, and because
    // nothing was committed the retry re-does both halves cleanly.
    await expect(
      ingestAndEnqueue({ source: 'clickup', payload: {}, externalId: `${EXTERNAL_ID}-2` })
    ).rejects.toThrow();

    const r = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from raw_event where external_id = ${EXTERNAL_ID + '-2'}`
    );
    expect(r.rows[0].n).toBe(0);
  });
});
