/**
 * Queue integration tests.
 *
 * These run against a REAL Postgres and a REAL pg-boss. The behaviours Step 6
 * asks about — a job being picked up, a failure triggering a retry, exhaustion
 * routing to the dead-letter queue — are properties of pg-boss and the database,
 * not of our code. Mocking pg-boss would only assert that our mock behaves like
 * our mock.
 *
 * ⚠️ SKIPPED when DATABASE_PUBLIC_URL / DATABASE_URL is absent, because
 * vitest.config.ts deliberately does not load .env.local. Run them with:
 *
 *     pnpm test:queue
 *
 * Every test uses a uniquely-named throwaway queue and cleans up after itself,
 * so it never touches the real `parse.*` queues.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgBoss } from 'pg-boss';
import { isParseJobData, type ParseJobData } from './types';

const CONNECTION = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(CONNECTION);

/** Isolated schema so a test run can never disturb the real `pgboss` schema. */
const TEST_SCHEMA = 'pgboss_test';

const describeDb = HAS_DB ? describe : describe.skip;

/** Poll until a predicate holds, so tests never depend on a fixed sleep. */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 20_000, intervalMs = 200 } = {}
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

describeDb('queue integration', () => {
  let boss: PgBoss;
  const createdQueues: string[] = [];

  beforeAll(async () => {
    boss = new PgBoss({
      connectionString: CONNECTION!,
      schema: TEST_SCHEMA,
      ssl: { rejectUnauthorized: false },
      max: 3
    });
    boss.on('error', () => {
      /* surfaced by the assertions instead */
    });
    await boss.start();
  }, 60_000);

  afterAll(async () => {
    // Drop only the queues this run created, then stop.
    for (const q of createdQueues) {
      await boss.deleteQueue(q).catch(() => {});
    }
    await boss.stop({ graceful: false }).catch(() => {});
  }, 60_000);

  async function makeQueue(label: string, options: Record<string, unknown> = {}) {
    const name = `t-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await boss.createQueue(name, options as Parameters<typeof boss.createQueue>[1]);
    createdQueues.push(name);
    return name;
  }

  it('enqueues a job and a worker picks it up', async () => {
    const queue = await makeQueue('pickup');
    const seen: ParseJobData[] = [];

    await boss.work<ParseJobData>(queue, { batchSize: 1 }, async (jobs) => {
      for (const j of jobs) seen.push(j.data);
    });

    const jobId = await boss.send(queue, { rawEventId: 'raw-abc-123' } satisfies ParseJobData);
    expect(jobId).toBeTruthy();

    const picked = await waitFor(() => seen.length > 0);
    expect(picked).toBe(true);
    expect(seen[0]).toEqual({ rawEventId: 'raw-abc-123' });
  }, 40_000);

  it('carries ONLY the raw_event id — never the payload', async () => {
    const queue = await makeQueue('payload');
    const received: unknown[] = [];

    await boss.work<ParseJobData>(queue, { batchSize: 1 }, async (jobs) => {
      for (const j of jobs) received.push(j.data);
    });

    await boss.send(queue, { rawEventId: 'raw-xyz-789' } satisfies ParseJobData);
    await waitFor(() => received.length > 0);

    const data = received[0] as Record<string, unknown>;
    // The contract: exactly one key. A future change that starts embedding the
    // event body would double storage and let the two copies disagree.
    expect(Object.keys(data)).toEqual(['rawEventId']);
    expect(isParseJobData(data)).toBe(true);
  }, 40_000);

  it('a handler failure triggers a retry', async () => {
    const queue = await makeQueue('retry');
    let attempts = 0;

    await boss.work(queue, { batchSize: 1, includeMetadata: true }, async () => {
      attempts += 1;
      throw new Error('deliberate failure');
    });

    await boss.send(
      queue,
      { rawEventId: 'raw-retry' } satisfies ParseJobData,
      // 1s fixed delay so the test does not wait out real exponential backoff.
      { retryLimit: 2, retryDelay: 1, retryBackoff: false }
    );

    const retried = await waitFor(() => attempts >= 2, { timeoutMs: 25_000 });
    expect(retried).toBe(true);
    expect(attempts).toBeGreaterThanOrEqual(2);
  }, 45_000);

  it('exhausting retries moves the job to the dead-letter queue', async () => {
    const dlq = await makeQueue('dlq');
    const queue = await makeQueue('exhaust', { deadLetter: dlq });

    await boss.work(queue, { batchSize: 1 }, async () => {
      throw new Error('always fails');
    });

    await boss.send(queue, { rawEventId: 'raw-doomed' } satisfies ParseJobData, {
      retryLimit: 1,
      retryDelay: 1,
      retryBackoff: false
    });

    // The dead-lettered copy arrives on the DLQ in state 'created'.
    // v12 has no getQueueSize; fetch() is the supported way to see it.
    let dead: { data: ParseJobData } | undefined;
    const landed = await waitFor(
      async () => {
        const rows = await boss.fetch<ParseJobData>(dlq, { batchSize: 1 });
        if (rows.length > 0) {
          dead = rows[0];
          return true;
        }
        return false;
      },
      { timeoutMs: 30_000 }
    );

    expect(landed).toBe(true);
    // It still carries the original payload, so it can be replayed.
    expect(dead?.data).toEqual({ rawEventId: 'raw-doomed' });
  }, 60_000);

  it('the original job ends in state "failed" on its own queue', async () => {
    const dlq = await makeQueue('dlq2');
    const queue = await makeQueue('states', { deadLetter: dlq });

    await boss.work(queue, { batchSize: 1 }, async () => {
      throw new Error('always fails');
    });

    const jobId = await boss.send(queue, { rawEventId: 'raw-states' } satisfies ParseJobData, {
      retryLimit: 0
    });

    const failed = await waitFor(
      async () => {
        const job = await boss.getJobById(queue, jobId!);
        return job?.state === 'failed';
      },
      { timeoutMs: 30_000 }
    );

    // This is the state the operational SQL query in docs looks for.
    expect(failed).toBe(true);
  }, 60_000);
});

// ── Pure unit tests: always run, no database needed ─────────────────────────

describe('ParseJobData contract', () => {
  it('accepts a well-formed payload', () => {
    expect(isParseJobData({ rawEventId: 'abc' })).toBe(true);
  });

  it('rejects a missing id', () => {
    expect(isParseJobData({})).toBe(false);
  });

  it('rejects an empty id', () => {
    expect(isParseJobData({ rawEventId: '' })).toBe(false);
  });

  it('rejects a non-string id', () => {
    expect(isParseJobData({ rawEventId: 123 })).toBe(false);
  });

  it('rejects null and non-objects', () => {
    expect(isParseJobData(null)).toBe(false);
    expect(isParseJobData('raw-1')).toBe(false);
  });
});
