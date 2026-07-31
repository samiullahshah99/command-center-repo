/**
 * getBoss() must not cache a rejection.
 *
 * Regression test for a real incident: the dev server failed to create a queue
 * once at boot, the rejected promise stayed on globalThis, and every webhook for
 * the next two hours returned 500 quoting that same stale error. A startup fault
 * must cost one request, not the process lifetime.
 *
 * pg-boss is mocked so the failure is deterministic and no database is needed —
 * the behaviour under test is our caching, not pg-boss's.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  starts: 0,
  failStart: { value: false },
  failCreateQueue: { value: false }
}));

vi.mock('pg-boss', () => {
  class FakePgBoss {
    on() {}
    async start() {
      h.starts += 1;
      if (h.failStart.value) throw new Error('connection refused');
      return this;
    }
    async createQueue(name: string) {
      if (h.failCreateQueue.value) {
        throw new Error('Name can only contain alphanumeric characters, underscores');
      }
      void name;
    }
    async stop() {}
    async send() {
      return 'job-1';
    }
  }
  return { PgBoss: FakePgBoss };
});

type Global = typeof globalThis & {
  commandCenterBoss?: unknown;
  commandCenterBossReady?: unknown;
};

describe('getBoss caching', () => {
  let getBoss: typeof import('./index').getBoss;

  beforeEach(async () => {
    h.starts = 0;
    h.failStart.value = false;
    h.failCreateQueue.value = false;
    const g = globalThis as Global;
    g.commandCenterBoss = undefined;
    g.commandCenterBossReady = undefined;
    process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/db';
    ({ getBoss } = await import('./index'));
  });

  it('reuses one instance across concurrent callers', async () => {
    const [a, b] = await Promise.all([getBoss(), getBoss()]);
    expect(a).toBe(b);
    expect(h.starts).toBe(1);
  });

  it('⚠️ a failed start does NOT poison later calls', async () => {
    h.failStart.value = true;
    await expect(getBoss()).rejects.toThrow(/connection refused/);

    // The fault clears; the very next call must try again rather than replay
    // the cached rejection.
    h.failStart.value = false;
    await expect(getBoss()).resolves.toBeDefined();
    expect(h.starts).toBe(2);
  });

  it('a failed createQueue also clears the cache, and names the queue', async () => {
    h.failCreateQueue.value = true;
    // The wrapper adds which queue failed — pg-boss's own message does not say.
    await expect(getBoss()).rejects.toThrow(/createQueue\("parse\.dead-letter"\)/);

    h.failCreateQueue.value = false;
    await expect(getBoss()).resolves.toBeDefined();
  });

  it('a rejection does not leave a half-built instance behind', async () => {
    h.failStart.value = true;
    await expect(getBoss()).rejects.toThrow();
    const g = globalThis as Global;
    expect(g.commandCenterBossReady).toBeUndefined();
    expect(g.commandCenterBoss).toBeUndefined();
  });
});
