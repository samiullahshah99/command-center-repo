import { PgBoss } from 'pg-boss';
import { ALL_QUEUE_NAMES, DEAD_LETTER_QUEUE, queueNameFor, type ParseJobData } from './types';
import type { RawEventSource } from '@/db/schema';

/**
 * pg-boss accessor.
 *
 * ⚠️ Everything here is a FUNCTION, never a module-level constant. A constant is
 * evaluated at import time, which means during `next build`, where DATABASE_URL
 * does not exist — the exact mistake that broke the Docker build once (see the
 * note in src/db/index.ts). Importing this module costs nothing; only calling
 * getBoss() connects.
 */

/**
 * Dedicated schema so pg-boss's ~9 tables cannot collide with Drizzle's.
 * drizzle-kit is scoped to `public` via schemaFilter in drizzle.config.ts, so it
 * will never introspect, alter, or drop anything in here.
 */
export const PGBOSS_SCHEMA = 'pgboss';

/** Retry policy. Applied per job at send time; see sendParseJob(). */
export const RETRY_LIMIT = Number(process.env.QUEUE_RETRY_LIMIT ?? 5);
export const RETRY_DELAY_SECONDS = Number(process.env.QUEUE_RETRY_DELAY_SECONDS ?? 5);
export const RETRY_DELAY_MAX_SECONDS = Number(process.env.QUEUE_RETRY_DELAY_MAX_SECONDS ?? 3600);

type Global = typeof globalThis & {
  commandCenterBoss?: PgBoss;
  commandCenterBossReady?: Promise<PgBoss>;
};
const g = globalThis as Global;

function connectionString(): string {
  // Runtime uses DATABASE_URL (Railway internal). DATABASE_PUBLIC_URL exists for
  // local runs and migrations, which cannot reach *.railway.internal.
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL;
  if (!url) {
    throw new Error(
      'Neither DATABASE_URL nor DATABASE_PUBLIC_URL is set. The queue needs a Postgres connection at RUNTIME only — if you see this during `next build`, something is starting the queue at build time.'
    );
  }
  return url;
}

function createBoss(): PgBoss {
  return new PgBoss({
    connectionString: connectionString(),
    schema: PGBOSS_SCHEMA,
    // Railway's proxy presents a cert that does not chain to a public root.
    ssl: { rejectUnauthorized: false },
    // Keep the queue's pool small — it shares the container with the web server's
    // own pool (max 10 in src/db/index.ts).
    max: 4
  });
}

/**
 * Start (or reuse) the pg-boss instance.
 *
 * Cached on globalThis so a dev hot-reload does not open a second instance, and
 * the in-flight promise is cached too so concurrent callers share one start.
 */
export function getBoss(): Promise<PgBoss> {
  if (g.commandCenterBossReady) return g.commandCenterBossReady;

  g.commandCenterBossReady = (async () => {
    const boss = createBoss();

    boss.on('error', (err: unknown) => {
      // Never throw from here — an unhandled 'error' event would take down the
      // web process along with the worker.
      console.error('[queue] pg-boss error:', err instanceof Error ? err.message : err);
    });

    await boss.start();

    // v12 requires queues to exist before send() or work(). Creating them is
    // idempotent, so this is safe on every boot.
    await boss.createQueue(DEAD_LETTER_QUEUE);
    for (const name of ALL_QUEUE_NAMES) {
      // createQueue takes Omit<Queue,'name'> — passing `name` again is a type error.
      await boss.createQueue(name, {
        // Exhausted jobs land here instead of vanishing.
        deadLetter: DEAD_LETTER_QUEUE
      });
    }

    g.commandCenterBoss = boss;
    return boss;
  })();

  return g.commandCenterBossReady;
}

/**
 * Enqueue a parse job.
 *
 * Called by webhook handlers AFTER the raw_event row is committed — the worker
 * re-reads that row, so enqueuing first would race.
 */
export async function sendParseJob(
  source: RawEventSource,
  data: ParseJobData
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(queueNameFor(source), data, {
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    // Exponential with jitter. pg-boss computes roughly
    //   min(retryDelayMax, retryDelay * 2^retryCount)  (plus jitter)
    retryBackoff: true,
    retryDelayMax: RETRY_DELAY_MAX_SECONDS
  });
}

/** Graceful shutdown, for scripts. The long-running server never calls this. */
export async function stopBoss(): Promise<void> {
  if (g.commandCenterBoss) {
    await g.commandCenterBoss.stop({ graceful: true });
    g.commandCenterBoss = undefined;
    g.commandCenterBossReady = undefined;
  }
}

export { DEAD_LETTER_QUEUE, queueNameFor, ALL_QUEUE_NAMES };
export type { ParseJobData };
