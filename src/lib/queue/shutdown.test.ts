import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Shutdown tests. No database needed — stopBoss is mocked, because what is being
 * tested is OUR signal handling, not pg-boss's drain.
 */

const h = vi.hoisted(() => ({
  stopCalls: [] as { graceful?: boolean; timeoutSeconds?: number }[],
  shouldThrow: { value: false }
}));

vi.mock('./index', () => ({
  stopBoss: async (opts: { graceful?: boolean; timeoutSeconds?: number } = {}) => {
    h.stopCalls.push(opts);
    if (h.shouldThrow.value) throw new Error('drain exploded');
  }
}));

const {
  SHUTDOWN_GRACE_SECONDS,
  registerShutdownHandlers,
  shutdownQueue,
  resetShutdownStateForTests
} = await import('./shutdown');

describe('queue shutdown', () => {
  beforeEach(() => {
    h.stopCalls.length = 0;
    h.shouldThrow.value = false;
    resetShutdownStateForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    vi.restoreAllMocks();
  });

  it('drains gracefully with a bounded timeout', async () => {
    await shutdownQueue('SIGTERM');
    expect(h.stopCalls).toHaveLength(1);
    expect(h.stopCalls[0].graceful).toBe(true);
    expect(h.stopCalls[0].timeoutSeconds).toBe(SHUTDOWN_GRACE_SECONDS);
  });

  it('the grace period stays under Railway’s 30s SIGKILL deadline', () => {
    // If this ever exceeds ~30s the process is killed mid-drain and the graceful
    // stop achieves nothing — the whole point of the handler.
    expect(SHUTDOWN_GRACE_SECONDS).toBeLessThan(30);
    expect(SHUTDOWN_GRACE_SECONDS).toBeGreaterThan(0);
  });

  it('ignores a second signal rather than racing the first drain', async () => {
    // Railway can send SIGTERM more than once.
    await Promise.all([shutdownQueue('SIGTERM'), shutdownQueue('SIGTERM')]);
    expect(h.stopCalls).toHaveLength(1);
  });

  it('swallows a drain error — in-flight jobs return to the queue anyway', async () => {
    h.shouldThrow.value = true;
    await expect(shutdownQueue('SIGTERM')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('registers handlers for SIGTERM and SIGINT', () => {
    const before = {
      term: process.listenerCount('SIGTERM'),
      int: process.listenerCount('SIGINT')
    };
    registerShutdownHandlers();
    expect(process.listenerCount('SIGTERM')).toBe(before.term + 1);
    expect(process.listenerCount('SIGINT')).toBe(before.int + 1);
  });

  it('is idempotent — a second call does not stack listeners', () => {
    registerShutdownHandlers();
    const after1 = process.listenerCount('SIGTERM');
    registerShutdownHandlers();
    registerShutdownHandlers();
    // Otherwise a dev hot-reload accumulates listeners until Node warns of a leak.
    expect(process.listenerCount('SIGTERM')).toBe(after1);
  });

  it('does NOT call process.exit — Next.js owns draining HTTP connections', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await shutdownQueue('SIGTERM');
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it('an actual SIGTERM triggers the drain', async () => {
    registerShutdownHandlers();
    process.emit('SIGTERM');
    // Handler is fire-and-forget; give the microtask queue a turn.
    await new Promise((r) => setTimeout(r, 20));
    expect(h.stopCalls).toHaveLength(1);
  });
});
