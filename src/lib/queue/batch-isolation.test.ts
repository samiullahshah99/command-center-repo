/**
 * Batch isolation: one poison job must not take its batch-mates down with it.
 *
 * batchSize=2 means work() receives an ARRAY. pg-boss's default is to settle the
 * WHOLE array on whether the handler threw, so without care a single malformed
 * event drags an innocent neighbour through the full retry ladder and into the
 * dead-letter queue. Two mechanisms prevent that (`perJobResults: true`, and a
 * per-job try/catch); this file tests the second directly and the first in
 * queue.test.ts against real pg-boss.
 *
 * No database: HANDLERS is mocked, so this runs in the default `pnpm test` lane.
 */

import { describe, expect, it, vi } from 'vitest';
import type { JobWithMetadata } from 'pg-boss';
import type { ParseJobData } from './types';

const POISON = 'raw-poison';
const PERMANENT = 'raw-permanent';

const h = vi.hoisted(() => ({ handled: [] as string[] }));

vi.mock('./registry', () => ({
  HANDLERS: {
    slack: async (data: ParseJobData) => {
      h.handled.push(data.rawEventId);
      if (data.rawEventId === PERMANENT) {
        // Mirrors what the Fireflies worker throws on a paid-plan or auth error.
        const err = new Error('cannot succeed (paid_plan_required)');
        (err as { permanent?: boolean }).permanent = true;
        throw err;
      }
      if (data.rawEventId === POISON) throw new Error('poison event');
    },
    clickup: async () => {},
    fireflies: async () => {},
    ugc: async () => {},
    vision: async () => {}
  },
  loadRawEvent: async () => null
}));

const { makeBatchHandler } = await import('./start-workers');

/** Minimal shape of what pg-boss hands the handler. */
function job(id: string, rawEventId: unknown, retryCount = 0) {
  return { id, data: { rawEventId }, retryCount } as unknown as JobWithMetadata<ParseJobData>;
}

describe('makeBatchHandler', () => {
  it('⚠️ one job throwing does NOT fail its batch-mate', async () => {
    h.handled.length = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const results = await makeBatchHandler('slack')([
      job('job-good', 'raw-good'),
      job('job-poison', POISON)
    ]);

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.id === 'job-good')?.status).toBe('completed');
    expect(results.find((r) => r.id === 'job-poison')?.status).toBe('failed');

    // Both ran: the throw did not short-circuit the batch.
    expect(h.handled).toContain('raw-good');
    expect(h.handled).toContain(POISON);
  });

  it('never rejects, whatever the handler does', async () => {
    // If this rejected, pg-boss would fall back to failing the whole batch and
    // the per-job statuses above would never be read.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      makeBatchHandler('slack')([job('a', POISON), job('b', POISON)])
    ).resolves.toHaveLength(2);
  });

  it('order is preserved, so a status is never attributed to the wrong job', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const results = await makeBatchHandler('slack')([
      job('first', POISON),
      job('second', 'raw-ok')
    ]);
    expect(results[0].id).toBe('first');
    expect(results[0].status).toBe('failed');
    expect(results[1].id).toBe('second');
    expect(results[1].status).toBe('completed');
  });

  it('⚠️ a PermanentJobError becomes deadletter, NOT failed — retries are skipped', async () => {
    // 'failed' would send it back round the ladder: six attempts, six identical
    // log lines, and real API quota spent relearning an answer that cannot change.
    // 'deadletter' is pg-boss's documented way to fail terminally at once.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const results = await makeBatchHandler('slack')([job('perm', PERMANENT)]);

    expect(results[0]).toMatchObject({ id: 'perm', status: 'deadletter' });
    expect((results[0].output as { permanent?: boolean }).permanent).toBe(true);
  });

  it('an ordinary error is still failed, so backoff still applies', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results = await makeBatchHandler('slack')([job('ordinary', POISON)]);
    expect(results[0].status).toBe('failed');
  });

  it('a permanent failure does not take its batch-mate down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results = await makeBatchHandler('slack')([
      job('perm', PERMANENT),
      job('fine', 'raw-fine')
    ]);
    expect(results[0].status).toBe('deadletter');
    expect(results[1].status).toBe('completed');
  });

  it('dead-letters malformed job data without retrying, and spares the batch', async () => {
    // Malformed data cannot improve on retry, so burning the ladder is pointless
    // — but it still must not affect the other job in the array.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const results = await makeBatchHandler('slack')([
      job('malformed', 42), // rawEventId is not a string
      job('healthy', 'raw-fine')
    ]);

    expect(results[0]).toMatchObject({ id: 'malformed', status: 'deadletter' });
    expect(results[1]).toMatchObject({ id: 'healthy', status: 'completed' });
  });
});
