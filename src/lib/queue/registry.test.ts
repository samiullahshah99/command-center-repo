/**
 * Registry handler tests.
 *
 * Calls the registered handlers directly against a REAL row, rather than
 * enqueuing and waiting for a worker. That is deliberate: a running dev server
 * consumes the same queues, so an end-to-end assertion races another consumer
 * and can pass or fail on timing rather than on behaviour.
 *
 * ⚠️ SKIPPED without DATABASE_URL / DATABASE_PUBLIC_URL. Run with:
 *
 *     pnpm test:db
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

const HAS_DB = Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL);
const describeDb = HAS_DB ? describe : describe.skip;

const RUN = `itest-registry-${process.pid}-${Date.now()}`;

describeDb('HANDLERS', () => {
  let db: typeof import('@/db').db;
  let pool: typeof import('@/db').pool;
  let rawEvent: typeof import('@/db/schema').rawEvent;
  let RAW_EVENT_SOURCES: typeof import('@/db/schema').RAW_EVENT_SOURCES;
  let HANDLERS: typeof import('./registry').HANDLERS;

  beforeAll(async () => {
    ({ db, pool } = await import('@/db'));
    ({ rawEvent, RAW_EVENT_SOURCES } = await import('@/db/schema'));
    ({ HANDLERS } = await import('./registry'));
  }, 30_000);

  afterAll(async () => {
    await db.execute(sql`delete from raw_event where external_id like ${RUN + '%'}`);
    await pool.end();
  }, 30_000);

  async function seed(source: 'slack' | 'clickup' | 'ugc' | 'vision', suffix: string) {
    const [row] = await db
      .insert(rawEvent)
      .values({ source, payload: { probe: true }, externalId: `${RUN}-${suffix}` })
      .returning({ id: rawEvent.id, processed: rawEvent.processed });
    return row;
  }

  async function processedOf(id: string) {
    const [row] = await db
      .select({ processed: rawEvent.processed })
      .from(rawEvent)
      .where(eq(rawEvent.id, id));
    return row?.processed;
  }

  it.each(['slack', 'clickup', 'ugc', 'vision'] as const)(
    'the %s stub marks its row processed',
    async (source) => {
      const row = await seed(source, source);
      expect(row.processed).toBe(false);

      await HANDLERS[source]({ rawEventId: row.id }, { jobId: 'test-job', attempt: 0, source });

      await expect(processedOf(row.id)).resolves.toBe(true);
    }
  );

  it('is a no-op, not a throw, when the row is gone', async () => {
    // A missing row will still be missing next attempt, so throwing would burn
    // the whole retry ladder and dead-letter a job that can never succeed.
    await expect(
      HANDLERS.slack(
        { rawEventId: '00000000-0000-0000-0000-000000000000' },
        { jobId: 'test-job', attempt: 0, source: 'slack' }
      )
    ).resolves.toBeUndefined();
  });

  it('covers every raw_event source', () => {
    // A source added to the schema without a handler would throw
    // "HANDLERS[source] is not a function" at run time, inside a worker.
    for (const source of RAW_EVENT_SOURCES) {
      expect(typeof HANDLERS[source]).toBe('function');
    }
  });
});
