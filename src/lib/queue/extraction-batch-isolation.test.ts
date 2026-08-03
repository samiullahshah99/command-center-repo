/**
 * Extraction batch isolation — the same hazard as batch-isolation.test.ts, on
 * the queue where it costs money.
 *
 * batchSize=2 means work() receives an ARRAY, and pg-boss's default is to settle
 * the WHOLE array on whether the handler threw. On the parse queues that wastes
 * retries; here it also spends the innocent neighbour's LLM budget re-running an
 * extraction that already worked, three times over, before dead-lettering it.
 *
 * Separate file from batch-isolation.test.ts because that one mocks './registry'
 * for the whole module and this one needs '@/features/extraction/extract'
 * mocked instead — vi.mock is file-scoped.
 *
 * No database, no network: the extractor is mocked.
 */

import { describe, expect, it, vi } from 'vitest';
import type { JobWithMetadata } from 'pg-boss';
import type { ExtractJobData } from './types';

const POISON = '00000000-0000-4000-8000-0000000000ff';
const PERMANENT = '00000000-0000-4000-8000-0000000000fe';
const SKIPPED = '00000000-0000-4000-8000-0000000000fd';
const GOOD = '00000000-0000-4000-8000-000000000001';
const GOOD_2 = '00000000-0000-4000-8000-000000000002';

const h = vi.hoisted(() => ({ ran: [] as string[] }));

vi.mock('@/features/extraction/extract', () => ({
  extractActionItems: async (unifiedEventId: string) => {
    h.ran.push(unifiedEventId);

    if (unifiedEventId === POISON) {
      // What a malformed model response looks like from here.
      throw new Error('model response is not valid JSON: Unexpected token I');
    }
    if (unifiedEventId === PERMANENT) {
      const err = new Error('transcript is 900,000 chars, over the guard');
      (err as { permanent?: boolean }).permanent = true;
      throw err;
    }

    return {
      unifiedEventId,
      transcriptId: 'transcript-1',
      itemsExtracted: unifiedEventId === SKIPPED ? 0 : 2,
      itemsWritten: unifiedEventId === SKIPPED ? 0 : 2,
      itemsUpdated: 0,
      ownerBreakdown: {},
      usage: { promptTokens: 8000, completionTokens: 300, estimatedCostUsd: 0.0191 },
      ...(unifiedEventId === SKIPPED ? { skippedReason: 'no transcript stored' } : {})
    };
  }
}));

const { makeExtractionBatchHandler } = await import('./start-workers');

function job(id: string, unifiedEventId: unknown, retryCount = 0) {
  return { id, data: { unifiedEventId }, retryCount } as unknown as JobWithMetadata<ExtractJobData>;
}

function quiet() {
  // ⚠️ .mockClear() matters: vi.spyOn accumulates calls across tests in a file,
  // which has produced three separate false passes in this repo already.
  vi.spyOn(console, 'warn')
    .mockImplementation(() => {})
    .mockClear();
  vi.spyOn(console, 'error')
    .mockImplementation(() => {})
    .mockClear();
}

describe('makeExtractionBatchHandler', () => {
  it('⚠️ one failed extraction does NOT fail its innocent batch-mate', async () => {
    h.ran.length = 0;
    quiet();

    const results = await makeExtractionBatchHandler()([
      job('job-good', GOOD),
      job('job-poison', POISON)
    ]);

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.id === 'job-good')?.status).toBe('completed');
    expect(results.find((r) => r.id === 'job-poison')?.status).toBe('failed');

    // Both ran — the throw did not short-circuit the batch.
    expect(h.ran).toContain(GOOD);
    expect(h.ran).toContain(POISON);
  });

  it('never rejects, whatever the extractor does', async () => {
    // If it rejected, pg-boss would fall back to failing the whole batch and the
    // per-job statuses above would never be read.
    quiet();
    await expect(
      makeExtractionBatchHandler()([job('a', POISON), job('b', POISON)])
    ).resolves.toHaveLength(2);
  });

  it('order is preserved, so a status is never attributed to the wrong job', async () => {
    quiet();
    const results = await makeExtractionBatchHandler()([
      job('a', POISON),
      job('b', GOOD),
      job('c', PERMANENT),
      job('d', GOOD_2)
    ]);
    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(results.map((r) => r.status)).toEqual([
      'failed',
      'completed',
      'deadletter',
      'completed'
    ]);
  });

  it('a permanent failure dead-letters on the FIRST attempt', async () => {
    // Every retry is a paid LLM call. A transcript over the size guard will not
    // shrink on attempt three.
    quiet();
    const [result] = await makeExtractionBatchHandler()([job('a', PERMANENT)]);
    expect(result.status).toBe('deadletter');
    expect((result.output as { permanent?: boolean }).permanent).toBe(true);
  });

  it('malformed job data dead-letters WITHOUT calling the extractor', async () => {
    h.ran.length = 0;
    quiet();

    const results = await makeExtractionBatchHandler()([
      job('bad-missing', undefined),
      job('bad-type', 42),
      job('good', GOOD)
    ]);

    expect(results.map((r) => r.status)).toEqual(['deadletter', 'deadletter', 'completed']);
    // The two malformed jobs never reached the model — that is the point.
    expect(h.ran).toEqual([GOOD]);
  });

  it('a skipped extraction COMPLETES rather than failing', async () => {
    // A meeting with no stored transcript is a normal state, not an error, and
    // retrying will not conjure one.
    quiet();
    const [result] = await makeExtractionBatchHandler()([job('a', SKIPPED)]);
    expect(result.status).toBe('completed');
    expect((result.output as { skipped?: string }).skipped).toBe('no transcript stored');
  });

  it('reports cost on the job output, so spend is attributable per job', async () => {
    quiet();
    const [result] = await makeExtractionBatchHandler()([job('a', GOOD)]);
    expect((result.output as { costUsd?: number }).costUsd).toBeCloseTo(0.0191, 5);
    expect((result.output as { items?: number }).items).toBe(2);
  });
});
