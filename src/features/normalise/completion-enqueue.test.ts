/**
 * The completion enqueue is GATED ON A GENUINE INSERT.
 *
 * ⚠️⚠️ THE FAILURE THIS PREVENTS IS NOT HYPOTHETICAL, AND IT IS BIG.
 * `unified_event` upserts on `(raw_event_id, source_seq)`, so
 * `pnpm renormalise` re-runs this exact path for EVERY row — 604 of them today.
 * An ungated enqueue would fire a completion job for all of them on every
 * renormalise, flooding the queue to re-derive completions the unique index then
 * rejects one by one.
 *
 * Design §1.2 names this explicitly, and `ingestAndEnqueue` gates its parse
 * enqueue on `result.inserted` for the identical reason (providers retry
 * routinely).
 *
 * ⚠️ REQUIRES A REAL POSTGRES: the property under test is `xmax = 0`, which is how
 * an upsert reports insert-vs-update. There is no way to mock that meaningfully —
 * a mock would assert that the mock returns what the mock returns.
 *
 * Run with `pnpm test:db`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const HAS_DB = Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL);
const describeDb = HAS_DB ? describe : describe.skip;

const RUN = `itest-cenq-${process.pid}-${Date.now()}`;

/** Every completion enqueue the normaliser attempts, captured. */
const h = vi.hoisted(() => ({ enqueued: [] as string[] }));

vi.mock('@/lib/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queue')>();
  return {
    ...actual,
    sendCompletionJob: async (data: { unifiedEventId: string }) => {
      h.enqueued.push(data.unifiedEventId);
      return 'job-id';
    }
  };
});

describeDb('completion enqueue gating', () => {
  let db: typeof import('@/db').db;
  let pool: typeof import('@/db').pool;
  let normaliseRawEvent: typeof import('./index').normaliseRawEvent;
  let rawEventId: string;

  async function insertRawEvent(externalId: string, eventTime: number): Promise<string> {
    const rows = await db.execute(sql`
      insert into raw_event (source, external_id, payload)
      values ('slack', ${externalId}, ${JSON.stringify({
        type: 'event_callback',
        event_id: externalId,
        event_time: eventTime,
        event: {
          type: 'message',
          user: 'U0TEST',
          channel: 'C0TEST',
          ts: `${eventTime}.000100`,
          text: 'standup: shipped the thing'
        }
      })}::jsonb)
      returning id`);
    return (rows as unknown as { rows: { id: string }[] }).rows[0].id;
  }

  beforeAll(async () => {
    ({ db, pool } = await import('@/db'));
    ({ normaliseRawEvent } = await import('./index'));

    rawEventId = await insertRawEvent(`${RUN}-evt`, 1786000000);
  });

  afterAll(async () => {
    await db.execute(sql`delete from raw_event where external_id like ${`${RUN}%`}`);
    await pool.end();
  });

  it('the FIRST normalisation enqueues a completion job', async () => {
    h.enqueued.length = 0;

    const result = await normaliseRawEvent(rawEventId);
    expect(result.written).toBeGreaterThan(0);
    expect(h.enqueued).toHaveLength(result.written);
  });

  /**
   * ⚠️ THE HEADLINE ASSERTION. Re-normalising the same row is an UPDATE via
   * ON CONFLICT, so `xmax != 0`, so nothing is enqueued. This is what stops
   * `pnpm renormalise` from queueing 604 jobs.
   */
  it('re-normalising the SAME row enqueues NOTHING', async () => {
    h.enqueued.length = 0;

    const result = await normaliseRawEvent(rawEventId);

    // The row is still written — renormalise is meant to refresh it.
    expect(result.written).toBeGreaterThan(0);
    // But no job. This is the gate.
    expect(h.enqueued).toEqual([]);
  });

  it('a third run also enqueues nothing — the gate is not a one-shot', async () => {
    h.enqueued.length = 0;
    await normaliseRawEvent(rawEventId);
    expect(h.enqueued).toEqual([]);
  });

  /**
   * ⚠️⚠️ A QUEUE FAILURE ROLLS THE ROW BACK — and that is the CORRECTION, not the
   * original behaviour.
   *
   * The first version enqueued outside the transaction and swallowed the error, on
   * the reasoning that `unified_event` is re-derivable so a lost job is cheap. That
   * reasoning had a hole, and the `xmax` gate is what made it unrecoverable: if the
   * process died between the row write and the enqueue, the ROW would exist, the
   * next `pnpm renormalise` would take the UPDATE path, `xmax != 0` would suppress
   * the enqueue, and that event's completion would be lost PERMANENTLY — the sweep
   * never catches up completions by design.
   *
   * In one transaction the crash rolls the row back, so the next normalise takes
   * the INSERT path and enqueues. These two tests pin exactly that recovery.
   */
  it('a failing enqueue ROLLS BACK the unified_event row', async () => {
    const boomId = await insertRawEvent(`${RUN}-boom`, 1786000001);

    const queue = await import('@/lib/queue');
    const spy = vi
      .spyOn(queue, 'sendCompletionJob')
      .mockRejectedValueOnce(new Error('queue unreachable'));

    // The throw propagates: the worker turns it into a failed job with retries.
    await expect(normaliseRawEvent(boomId)).rejects.toThrow(/queue unreachable/);

    // ⚠️ THE ROW IS GONE. Nothing was half-written.
    const stored = await db.execute(
      sql`select count(*)::int as n from unified_event where raw_event_id = ${boomId}`
    );
    expect((stored as unknown as { rows: { n: number }[] }).rows[0].n).toBe(0);

    spy.mockRestore();

    // ⚠️ AND IT SELF-HEALS: because the row is absent, the retry takes the INSERT
    // path and enqueues. Under the old out-of-transaction version this event's
    // completion would have been lost forever.
    h.enqueued.length = 0;
    const result = await normaliseRawEvent(boomId);

    expect(result.written).toBeGreaterThan(0);
    expect(h.enqueued).toHaveLength(result.written);

    const after = await db.execute(
      sql`select count(*)::int as n from unified_event where raw_event_id = ${boomId}`
    );
    expect((after as unknown as { rows: { n: number }[] }).rows[0].n).toBeGreaterThan(0);
  });
});
