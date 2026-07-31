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

  /**
   * ⚠️ Real payload SHAPES, not `{probe:true}`.
   *
   * The handlers no longer stub — they normalise. A placeholder payload is
   * unmappable, so it correctly leaves processed=false and these tests would be
   * asserting the failure path while looking like they assert the happy one.
   * PII scrubbed.
   */
  const PAYLOADS: Record<'slack' | 'clickup' | 'ugc' | 'vision', unknown> = {
    slack: {
      type: 'event_callback',
      event_id: 'Ev0TESTREGISTRY',
      team_id: 'T0TEST',
      event: {
        type: 'message',
        user: 'U0TESTREGISTRY',
        channel: 'C0TEST',
        ts: '1785508463.300799'
      }
    },
    clickup: {
      event: 'taskUpdated',
      task_id: 't-reg',
      team_id: '9',
      webhook_id: 'w',
      history_items: [{ id: 'h-reg', date: '1785489973755', field: 'status', user: { id: 42 } }]
    },
    ugc: {
      id: 'evt-reg',
      type: 'creator.approved',
      occurred_at: '2026-07-31T13:06:10.892563Z',
      actor: { id: 'user_2TESTREGISTRY', name: 'Test', email: null },
      entity: { type: 'creator', id: 'c-reg' }
    },
    vision: {
      id: 'vis-reg',
      event: 'brief.submitted',
      occurred_at: '2026-07-31T15:01:12.413115Z',
      actor: { user_id: 'user_3FTESTREGISTRY', name: 'Test', email: null, editor_name: null },
      subject: { id: 'b-reg', type: 'brief', label: 'Reg' }
    }
  };

  async function seed(source: 'slack' | 'clickup' | 'ugc' | 'vision', suffix: string) {
    const [row] = await db
      .insert(rawEvent)
      .values({ source, payload: PAYLOADS[source], externalId: `${RUN}-${suffix}` })
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
    'the %s handler normalises its row and marks it processed',
    async (source) => {
      const row = await seed(source, source);
      expect(row.processed).toBe(false);

      await HANDLERS[source]({ rawEventId: row.id }, { jobId: 'test-job', attempt: 0, source });

      await expect(processedOf(row.id)).resolves.toBe(true);

      // processed=true must mean a unified_event actually exists, not just that
      // a handler ran.
      const u = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from unified_event where raw_event_id = ${row.id}`
      );
      expect(u.rows[0].n).toBeGreaterThanOrEqual(1);
    }
  );

  it('⚠️ an UNMAPPABLE payload leaves processed=false, so it stays visible', async () => {
    const [row] = await db
      .insert(rawEvent)
      .values({
        source: 'vision',
        payload: { nothing: 'mappable' },
        externalId: `${RUN}-unmappable`
      })
      .returning({ id: rawEvent.id });

    await HANDLERS.vision(
      { rawEventId: row.id },
      { jobId: 'test-job', attempt: 0, source: 'vision' }
    );

    await expect(processedOf(row.id)).resolves.toBe(false);
  });

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
