import { PgBoss, type Db as PgBossDb } from 'pg-boss';
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

  const ready = (async () => {
    const boss = createBoss();

    boss.on('error', (err: unknown) => {
      // Never throw from here — an unhandled 'error' event would take down the
      // web process along with the worker.
      console.error('[queue] pg-boss error:', err instanceof Error ? err.message : err);
    });

    await boss.start();

    // v12 requires queues to exist before send() or work(). Creating them is
    // idempotent, so this is safe on every boot. The name is named in the error
    // because pg-boss's own validation message does not say WHICH name it
    // rejected, which makes a startup failure needlessly hard to place.
    await createQueueOrExplain(boss, DEAD_LETTER_QUEUE);
    for (const name of ALL_QUEUE_NAMES) {
      // createQueue takes Omit<Queue,'name'> — passing `name` again is a type error.
      await createQueueOrExplain(boss, name, {
        // Exhausted jobs land here instead of vanishing.
        deadLetter: DEAD_LETTER_QUEUE
      });
    }

    g.commandCenterBoss = boss;
    return boss;
  })();

  // ⚠️ Cache the promise, but DROP IT IF IT REJECTS.
  //
  // Caching the rejected promise instead is a trap that already bit us: the dev
  // server failed to create a queue once at boot, the rejection stayed on
  // globalThis, and every webhook for the next two hours answered 500 with that
  // same stale error — long after the underlying fault was irrelevant. A startup
  // fault must cost one request, not the whole process lifetime.
  //
  // The `catch` runs before any caller's own handler, so by the time a caller
  // sees the rejection the slot is already clear and the next call retries.
  g.commandCenterBossReady = ready;
  ready.catch(() => {
    if (g.commandCenterBossReady === ready) {
      g.commandCenterBossReady = undefined;
      g.commandCenterBoss = undefined;
    }
  });

  return ready;
}

/** createQueue, but the failure says which queue. */
async function createQueueOrExplain(
  boss: PgBoss,
  name: string,
  options?: Parameters<PgBoss['createQueue']>[1]
): Promise<void> {
  try {
    await boss.createQueue(name, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[queue] createQueue(${JSON.stringify(name)}) failed: ${message}`, {
      cause: err
    });
  }
}

/**
 * Enqueue a parse job.
 *
 * Ordering rule: the worker re-reads the raw_event row by id, so the job must
 * never become visible before that row does. Two ways to satisfy that —
 *
 *   1. Pass `db` (preferred). The job INSERT joins the caller's transaction, so
 *      row and job commit together and neither can exist without the other.
 *   2. Omit it, and enqueue only after the row is committed.
 *
 * See ingestAndEnqueue() in src/features/connectors/ingest.ts for (1).
 */
export type ParseJobOptions = {
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  retryDelayMax?: number;
  /**
   * An external transaction to enqueue within, as pg-boss's IDatabase.
   *
   * Build it with `fromDrizzle(tx, sql)` from 'pg-boss' — a first-party adapter
   * (v12 ships fromKnex/fromKysely/fromDrizzle/fromPrisma/fromPglite). Verified
   * against the live database: rolling the transaction back removes the job as
   * well as the row; committing persists both.
   */
  db?: PgBossDb;
};

export async function sendParseJob(
  source: RawEventSource,
  data: ParseJobData,
  // Per-source override. Fireflies uses a smaller budget with longer delays
  // because its API is rate-limited per DAY and a transcript may legitimately
  // not be ready yet — see FIREFLIES_JOB_OPTIONS.
  options: ParseJobOptions = {}
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(queueNameFor(source), data, {
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    // Exponential with jitter. pg-boss computes roughly
    //   min(retryDelayMax, retryDelay * 2^retryCount)  (plus jitter)
    retryBackoff: true,
    retryDelayMax: RETRY_DELAY_MAX_SECONDS,
    ...options
  });
}

/**
 * Stop pg-boss.
 *
 * `graceful: true` stops fetching new jobs and waits for in-flight handlers.
 * `timeout` is MILLISECONDS (pg-boss StopOptions), so callers passing seconds
 * must convert — see shutdown.ts.
 *
 * Anything still running when the timeout elapses stays `active` and is returned
 * to the queue by pg-boss maintenance, so no job is lost; worst case it retries.
 */
export async function stopBoss(
  opts: { graceful?: boolean; timeoutSeconds?: number } = {}
): Promise<void> {
  if (!g.commandCenterBoss) return;

  await g.commandCenterBoss.stop({
    graceful: opts.graceful ?? true,
    ...(opts.timeoutSeconds !== undefined ? { timeout: opts.timeoutSeconds * 1000 } : {})
  });

  g.commandCenterBoss = undefined;
  g.commandCenterBossReady = undefined;
}

export { DEAD_LETTER_QUEUE, queueNameFor, ALL_QUEUE_NAMES };
export type { ParseJobData };
