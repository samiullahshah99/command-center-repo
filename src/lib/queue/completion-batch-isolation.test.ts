/**
 * Completion batch isolation — the same hazard as batch-isolation.test.ts and
 * extraction-batch-isolation.test.ts, on the queue where it costs the most.
 *
 * batchSize=2 means work() receives an ARRAY, and pg-boss's default is to settle
 * the WHOLE array on whether the handler threw.
 *
 * ⚠️ THE STAKE IS HIGHER HERE THAN ON THE OTHER TWO QUEUES: two jobs in one batch
 * can belong to two different PEOPLE. Without isolation, one malformed rule would
 * fail an innocent colleague's completion, drag it through the retry ladder, and
 * dead-letter it — and the visible symptom is that person's recurring task
 * showing as not done. A queue bug would present as a colleague not doing their
 * work, which is exactly the confusion this engine exists to remove.
 *
 * Two mechanisms, BOTH required: `perJobResults: true` at the work() call, and
 * the handler never throwing.
 *
 * Separate file because vi.mock is file-scoped and this one needs
 * '@/features/completion/evaluate' mocked. No database, no network.
 */

import { describe, expect, it, vi } from 'vitest';
import type { JobWithMetadata } from 'pg-boss';
import type { CompletionJobData } from './types';

const POISON = '00000000-0000-4000-8000-0000000000ff';
const PERMANENT = '00000000-0000-4000-8000-0000000000fe';
/** A real, expected outcome: the window already had a completion. */
const ALREADY_CLOSED = '00000000-0000-4000-8000-0000000000fd';
const GOOD = '00000000-0000-4000-8000-000000000001';
const GOOD_2 = '00000000-0000-4000-8000-000000000002';

const h = vi.hoisted(() => ({ ran: [] as string[] }));

vi.mock('@/features/completion/evaluate', () => ({
  evaluateEvent: async (unifiedEventId: string) => {
    h.ran.push(unifiedEventId);

    if (unifiedEventId === POISON) {
      throw new Error('rule metadata is not an object');
    }
    if (unifiedEventId === PERMANENT) {
      const err = new Error('rule version 2 is not supported by this worker');
      (err as { permanent?: boolean }).permanent = true;
      throw err;
    }
    if (unifiedEventId === ALREADY_CLOSED) {
      return [
        {
          recurringTaskId: 'task-1',
          signal: 'standup_posted',
          windowStart: '2026-08-12',
          attribution: 'attributed' as const,
          recorded: false
        }
      ];
    }

    return [
      {
        recurringTaskId: 'task-1',
        signal: 'standup_posted',
        windowStart: '2026-08-12',
        attribution: 'attributed' as const,
        recorded: true
      }
    ];
  }
}));

const { makeCompletionBatchHandler } = await import('./start-workers');

function job(id: string, unifiedEventId: unknown, retryCount = 0) {
  return {
    id,
    data: { unifiedEventId },
    retryCount
  } as unknown as JobWithMetadata<CompletionJobData>;
}

describe('completion batch isolation', () => {
  it('a poison job does not take its batch-mate down', async () => {
    h.ran.length = 0;
    const handler = makeCompletionBatchHandler();

    const results = await handler([job('j1', POISON), job('j2', GOOD)]);

    // ⚠️ The handler RESOLVES rather than throwing — that is half the mechanism.
    expect(results).toEqual([
      { id: 'j1', status: 'failed' },
      { id: 'j2', status: 'completed' }
    ]);
    // The innocent neighbour actually ran.
    expect(h.ran).toContain(GOOD);
  });

  it('a permanent failure dead-letters immediately and spares the rest', async () => {
    h.ran.length = 0;
    const handler = makeCompletionBatchHandler();

    const results = await handler([job('j1', PERMANENT), job('j2', GOOD_2)]);

    expect(results).toEqual([
      { id: 'j1', status: 'deadletter' },
      { id: 'j2', status: 'completed' }
    ]);
  });

  /**
   * ⚠️ `recorded: false` IS NOT A FAILURE. It means the window already had a
   * completion — the normal answer for a duplicate signal, a queue redelivery, or
   * a `renormalise` replay. Marking it failed would retry work the unique index
   * has already, correctly, refused.
   */
  it('an already-closed window completes the job, never fails it', async () => {
    const handler = makeCompletionBatchHandler();
    const results = await handler([job('j1', ALREADY_CLOSED)]);
    expect(results).toEqual([{ id: 'j1', status: 'completed' }]);
  });

  it('malformed job data dead-letters without calling the evaluator', async () => {
    h.ran.length = 0;
    const handler = makeCompletionBatchHandler();

    const results = await handler([job('j1', 42), job('j2', GOOD)]);

    expect(results[0]).toEqual({ id: 'j1', status: 'deadletter' });
    expect(results[1]).toEqual({ id: 'j2', status: 'completed' });
    expect(h.ran).not.toContain(42 as unknown as string);
  });

  it('every job in a batch is evaluated, not just up to the first failure', async () => {
    h.ran.length = 0;
    const handler = makeCompletionBatchHandler();

    await handler([job('j1', POISON), job('j2', GOOD), job('j3', GOOD_2)]);

    expect(h.ran).toEqual(expect.arrayContaining([POISON, GOOD, GOOD_2]));
  });
});
