import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Worker tests live in their OWN file because vi.mock is HOISTED: mocking
 * ./client alongside the client's own tests would replace the real module for
 * those too, and they would silently be asserting against the mock.
 */

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', 'fireflies', name), 'utf8');
}
const json = (name: string) => JSON.parse(fixture(name));

const w = vi.hoisted(() => ({
  rawEvent: null as unknown,
  transcriptFetch: { impl: null as null | (() => Promise<unknown>) },
  inserted: [] as unknown[],
  processedIds: [] as string[]
}));

vi.mock('@/lib/queue/registry', async (orig) => {
  const actual = await orig<typeof import('@/lib/queue/registry')>();
  return { ...actual, loadRawEvent: async () => w.rawEvent };
});

vi.mock('./client', async (orig) => {
  const actual = await orig<typeof import('./client')>();
  return {
    ...actual,
    getTranscript: async () => {
      if (!w.transcriptFetch.impl) throw new Error('no fetch impl configured');
      return w.transcriptFetch.impl();
    }
  };
});

vi.mock('@/db', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: async () => {
          w.inserted.push(v);
        }
      })
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          w.processedIds.push('marked');
        }
      })
    })
  }
}));

const { handleFirefliesJob } = await import('./worker');
const { FirefliesGraphQLError: GqlErr } = await import('./client');

describe('fireflies worker', () => {
  const ctx = { jobId: 'job-1', attempt: 0, source: 'fireflies' as const };

  beforeEach(() => {
    w.inserted.length = 0;
    w.processedIds.length = 0;
    w.rawEvent = {
      id: 'raw-1',
      source: 'fireflies',
      payload: json('webhook-transcription-completed.json'),
      externalId: '01JQFF1TESTMEETING000001',
      processed: false,
      receivedAt: new Date()
    };
    w.transcriptFetch.impl = async () => json('graphql-transcript.json').data.transcript;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('fetches the transcript and stores it linked to the raw event', async () => {
    await handleFirefliesJob({ rawEventId: 'raw-1' }, ctx);

    expect(w.inserted).toHaveLength(1);
    const row = w.inserted[0] as Record<string, unknown>;
    expect(row.firefliesId).toBe('01JQFF1TESTMEETING000001');
    expect(row.rawEventId).toBe('raw-1');
    expect(row.title).toBe('Weekly Sync (test fixture)');
    expect(row.durationSeconds).toBe(1832);
  });

  it('marks the raw_event processed only after a successful store', async () => {
    await handleFirefliesJob({ rawEventId: 'raw-1' }, ctx);
    expect(w.processedIds).toHaveLength(1);
  });

  it('RETHROWS when the transcript is not ready — this is what triggers backoff', async () => {
    // The case the whole retry budget exists for: Fireflies fires the webhook
    // before the transcript is queryable.
    w.transcriptFetch.impl = async () => {
      throw new GqlErr([{ message: 'Transcript not found' }], 'transcript');
    };

    await expect(handleFirefliesJob({ rawEventId: 'raw-1' }, ctx)).rejects.toThrow(GqlErr);
    // Nothing stored, nothing marked processed — the retry starts clean.
    expect(w.inserted).toHaveLength(0);
    expect(w.processedIds).toHaveLength(0);
  });

  it('rethrows other fetch failures too, so they reach the dead-letter queue', async () => {
    w.transcriptFetch.impl = async () => {
      throw new Error('network exploded');
    };
    await expect(handleFirefliesJob({ rawEventId: 'raw-1' }, ctx)).rejects.toThrow(
      /network exploded/
    );
  });

  it('does NOT retry a missing raw_event — it will still be missing', async () => {
    w.rawEvent = null;
    await expect(handleFirefliesJob({ rawEventId: 'gone' }, ctx)).resolves.toBeUndefined();
    expect(w.inserted).toHaveLength(0);
  });

  it('does NOT retry an off-contract payload', async () => {
    w.rawEvent = {
      id: 'raw-2',
      payload: json('webhook-off-contract.json'),
      externalId: null,
      processed: false
    };
    await expect(handleFirefliesJob({ rawEventId: 'raw-2' }, ctx)).resolves.toBeUndefined();
    expect(w.inserted).toHaveLength(0);
  });

  it('upserts on fireflies_id so a retry after partial success does not duplicate', async () => {
    await handleFirefliesJob({ rawEventId: 'raw-1' }, ctx);
    await handleFirefliesJob({ rawEventId: 'raw-1' }, { ...ctx, attempt: 1 });
    // Two calls, both routed through onConflictDoUpdate on the UNIQUE column.
    expect(w.inserted).toHaveLength(2);
    expect((w.inserted[0] as Record<string, unknown>).firefliesId).toBe(
      (w.inserted[1] as Record<string, unknown>).firefliesId
    );
  });
});
