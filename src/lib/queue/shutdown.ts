/**
 * Graceful shutdown for the queue workers.
 *
 * Railway sends SIGTERM on every redeploy, then SIGKILLs after a grace period.
 * Without handling it, the process dies mid-job and those jobs sit in `active`
 * until pg-boss's maintenance sweep expires them — so a redeploy silently stalls
 * work for minutes rather than seconds.
 *
 * `boss.stop({ graceful: true })` stops fetching new jobs and waits for in-flight
 * handlers to finish. Anything still running when the wait times out is left in
 * `active` and later returned to the queue by pg-boss maintenance, so a job is
 * never lost — worst case it is retried.
 */

import { stopBoss } from './index';

/**
 * How long to let in-flight jobs finish.
 *
 * Must be comfortably UNDER Railway's SIGTERM→SIGKILL grace period, or the
 * process is killed mid-wait and the graceful stop achieves nothing. Railway's
 * default is 30s, so this defaults to 20s and leaves headroom for the HTTP
 * server to drain too.
 */
export const SHUTDOWN_GRACE_SECONDS = Number(process.env.QUEUE_SHUTDOWN_GRACE_SECONDS ?? 20);

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

type Global = typeof globalThis & { commandCenterShutdownWired?: boolean };
const g = globalThis as Global;

let shuttingDown = false;

export async function shutdownQueue(reason: string): Promise<void> {
  // A second signal must not start a second stop — Railway can send SIGTERM
  // more than once, and re-entering would race the first drain.
  if (shuttingDown) {
    console.warn(`[queue] shutdown already in progress, ignoring ${reason}`);
    return;
  }
  shuttingDown = true;

  const startedAt = Date.now();
  console.warn(
    `[queue] ${reason} received — draining in-flight jobs (max ${SHUTDOWN_GRACE_SECONDS}s)`
  );

  try {
    await stopBoss({ graceful: true, timeoutSeconds: SHUTDOWN_GRACE_SECONDS });
    console.warn(`[queue] drained cleanly in ${Date.now() - startedAt}ms`);
  } catch (err) {
    // Log and continue: anything still active is returned to the queue by
    // pg-boss maintenance, so exiting here loses nothing.
    console.error(
      `[queue] shutdown error after ${Date.now() - startedAt}ms:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Register signal handlers. Idempotent, and cached on globalThis so a dev hot
 * reload does not stack listeners until Node warns about a leak.
 *
 * ⚠️ Deliberately does NOT call process.exit(). Next.js has its own SIGTERM
 * handling for draining HTTP connections; exiting here would cut that short and
 * drop in-flight requests. We drain the queue and let Next own the exit.
 */
export function registerShutdownHandlers(): void {
  if (g.commandCenterShutdownWired) return;
  g.commandCenterShutdownWired = true;

  for (const signal of SIGNALS) {
    process.on(signal, () => {
      void shutdownQueue(signal);
    });
  }

  console.warn(`[queue] shutdown handlers registered for ${SIGNALS.join(', ')}`);
}

/** Test seam. */
export function resetShutdownStateForTests(): void {
  shuttingDown = false;
  g.commandCenterShutdownWired = false;
}
