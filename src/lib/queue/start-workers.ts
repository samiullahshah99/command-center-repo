/**
 * Worker entrypoint.
 *
 * Called from src/instrumentation.ts, which Next.js invokes ONCE per server
 * process at boot, before requests are served. Verified empirically on a
 * standalone build: one invocation, `nodejs` runtime only, not per request.
 *
 * ⚠️ Written as a standalone entrypoint on purpose. Moving workers to a separate
 * Railway service later means calling startWorkers() from a small script and
 * dropping the instrumentation hook — no handler changes.
 */

import type { JobResult, JobWithMetadata } from 'pg-boss';
import { RAW_EVENT_SOURCES, type RawEventSource } from '@/db/schema';
import { getBoss, RETRY_LIMIT } from './index';
import { HANDLERS } from './registry';
import { registerShutdownHandlers } from './shutdown';
import {
  EXTRACTION_QUEUE,
  isExtractJobData,
  isParseJobData,
  isPermanentJobError,
  queueNameFor,
  type ExtractJobData,
  type ParseJobData
} from './types';

/** Jobs fetched per poll, per queue. Modest: this shares the web container. */
const BATCH_SIZE = Number(process.env.QUEUE_BATCH_SIZE ?? 2);

let started = false;

export async function startWorkers(): Promise<void> {
  // Guard against a double boot (dev hot reload, or a future second caller).
  // Not a correctness problem — pg-boss tolerates many consumers — but it makes
  // concurrency unpredictable and the logs confusing.
  if (started) {
    console.warn('[queue] startWorkers() called twice — ignoring the second call');
    return;
  }
  started = true;

  const boss = await getBoss();

  // Wire SIGTERM/SIGINT before the first job can be picked up, so a redeploy
  // during startup still drains rather than killing an in-flight handler.
  registerShutdownHandlers();

  for (const source of RAW_EVENT_SOURCES) {
    await boss.work(
      queueNameFor(source),
      {
        batchSize: BATCH_SIZE,
        // retryCount lives on the metadata, and per-attempt logging needs it.
        includeMetadata: true,
        // ⚠️ Essential. work() hands the handler a BATCH, and by default throwing
        // fails EVERY job in it — one poison event would drag its batch-mates
        // through the whole retry ladder with it. perJobResults settles each job
        // on its own outcome.
        perJobResults: true
      },
      makeBatchHandler(source)
    );
  }

  // ── Extraction ────────────────────────────────────────────────────────────
  // Same options as the parse queues, and for the same reason: perJobResults
  // plus a per-job try/catch is what stops one poison transcript failing its
  // batch-mate. See makeExtractionBatchHandler.
  await boss.work(
    EXTRACTION_QUEUE,
    { batchSize: BATCH_SIZE, includeMetadata: true, perJobResults: true },
    makeExtractionBatchHandler()
  );

  console.warn(
    `[queue] workers started for ${RAW_EVENT_SOURCES.length + 1} queues ` +
      `(batchSize=${BATCH_SIZE}, retryLimit=${RETRY_LIMIT})`
  );
}

/**
 * Turns one queue's batch into per-job outcomes.
 *
 * ⚠️ THE BATCH IS THE HAZARD. batchSize=2 means work() is handed an ARRAY, and a
 * handler that throws fails EVERY job in that array — a malformed event would
 * drag its innocent batch-mate through the entire retry ladder and into the
 * dead-letter queue with it. Two things prevent that, and BOTH are required:
 *
 *   1. `perJobResults: true` on the work() options, so pg-boss settles each job
 *      on its own returned status instead of on whether the handler threw.
 *   2. This function never throwing — runOne() catches per job, so one failure
 *      becomes one 'failed' entry in the array and the rest still report
 *      'completed'.
 *
 * Exported so the isolation guarantee is testable directly; there is no other
 * way to exercise it without racing a live worker for the same queues.
 */
export function makeBatchHandler(source: RawEventSource) {
  return async (jobs: JobWithMetadata<ParseJobData>[]): Promise<JobResult[]> =>
    Promise.all(jobs.map((job) => runOne(source, job)));
}

/**
 * The extraction queue's batch handler.
 *
 * ⚠️ Identical isolation guarantees to makeBatchHandler, and for the same
 * reason: batchSize=2 means work() receives an ARRAY, and a handler that throws
 * fails EVERY job in it. One transcript whose model response will not parse
 * must not drag an unrelated meeting through the retry ladder with it.
 *
 * Two mechanisms, both required — `perJobResults: true` at the work() call, and
 * this function never throwing.
 */
export function makeExtractionBatchHandler() {
  return async (jobs: JobWithMetadata<ExtractJobData>[]): Promise<JobResult[]> =>
    Promise.all(jobs.map((job) => runExtraction(job)));
}

/**
 * The extractor module, imported once.
 *
 * Deferred rather than imported at the top of this file because extract.ts pulls
 * in the AI client and the extraction schemas, and nothing else in the worker
 * boot path needs them.
 *
 * ⚠️ Memoised, not re-imported per job. A batch calls runExtraction concurrently,
 * and two simultaneous `import()` calls of the same specifier are two separate
 * module resolutions until one settles — which surfaced as a test where the
 * second job in a batch bypassed a mocked module entirely. One shared promise
 * makes every job in the batch see the same module, always.
 *
 * The rejection is NOT cached, for the same reason getBoss() does not cache one:
 * a transient failure must cost one job, not the process lifetime.
 */
let extractorModule: Promise<typeof import('@/features/extraction/extract')> | null = null;

function loadExtractor(): Promise<typeof import('@/features/extraction/extract')> {
  if (extractorModule) return extractorModule;

  const loading = import('@/features/extraction/extract');
  extractorModule = loading;
  loading.catch(() => {
    if (extractorModule === loading) extractorModule = null;
  });
  return loading;
}

async function runExtraction(job: JobWithMetadata<ExtractJobData>): Promise<JobResult> {
  const attempt = job.retryCount ?? 0;
  const label = `${attempt + 1}/${RETRY_LIMIT + 1}`;

  if (!isExtractJobData(job.data)) {
    // Malformed data will not improve on retry.
    console.error(
      `[queue:extract] job=${job.id} attempt=${label} MALFORMED job data — dead-lettering without retry`
    );
    return { id: job.id, status: 'deadletter', output: { reason: 'malformed_job_data' } };
  }

  const startedAt = Date.now();
  console.warn(
    `[queue:extract] job=${job.id} attempt=${label} start unifiedEventId=${job.data.unifiedEventId}`
  );

  try {
    const { extractActionItems } = await loadExtractor();
    const result = await extractActionItems(job.data.unifiedEventId);

    if (result.skippedReason) {
      // Not an error: a meeting with no stored transcript is a normal state, and
      // retrying will not conjure one.
      console.warn(
        `[queue:extract] job=${job.id} attempt=${label} skipped — ${result.skippedReason}`
      );
      return { id: job.id, status: 'completed', output: { skipped: result.skippedReason } };
    }

    console.warn(
      `[queue:extract] job=${job.id} attempt=${label} ok in ${Date.now() - startedAt}ms — ` +
        `${result.itemsExtracted} item(s), $${result.usage.estimatedCostUsd.toFixed(5)}`
    );
    return {
      id: job.id,
      status: 'completed',
      output: {
        items: result.itemsExtracted,
        written: result.itemsWritten,
        updated: result.itemsUpdated,
        costUsd: result.usage.estimatedCostUsd
      }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (isPermanentJobError(err)) {
      console.error(
        `[queue:extract] job=${job.id} attempt=${label} PERMANENT failure — dead-lettering: ${message}`
      );
      return { id: job.id, status: 'deadletter', output: { message, permanent: true } };
    }

    console.error(
      `[queue:extract] job=${job.id} attempt=${label} FAILED after ${Date.now() - startedAt}ms: ${message}`
    );
    return { id: job.id, status: 'failed', output: { message, attempt } };
  }
}

async function runOne(
  source: RawEventSource,
  job: JobWithMetadata<ParseJobData>
): Promise<JobResult> {
  // retryCount is 0 on the first run. Reported as "N/total" so the numbers read
  // the way a human counts attempts.
  const attempt = job.retryCount ?? 0;
  const label = `${attempt + 1}/${RETRY_LIMIT + 1}`;

  if (!isParseJobData(job.data)) {
    // Malformed data will not improve on retry. Dead-letter it immediately
    // rather than burning the ladder on something that cannot succeed.
    console.error(
      `[queue:${source}] job=${job.id} attempt=${label} MALFORMED job data — dead-lettering without retry`
    );
    return { id: job.id, status: 'deadletter', output: { reason: 'malformed_job_data' } };
  }

  const startedAt = Date.now();
  console.warn(
    `[queue:${source}] job=${job.id} attempt=${label} start rawEventId=${job.data.rawEventId}`
  );

  try {
    await HANDLERS[source](job.data, { jobId: job.id, attempt, source });
    console.warn(
      `[queue:${source}] job=${job.id} attempt=${label} ok in ${Date.now() - startedAt}ms`
    );
    return { id: job.id, status: 'completed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // PERMANENT: the handler has already determined this cannot succeed — a
    // revoked key, a plan that does not include the endpoint, a resource that is
    // genuinely gone. Retrying spends real API quota to relearn the same answer
    // and buries the one useful log line under five identical ones.
    if (isPermanentJobError(err)) {
      console.error(
        `[queue:${source}] job=${job.id} attempt=${label} PERMANENT failure after ${Date.now() - startedAt}ms — ` +
          `dead-lettering immediately, no retry: ${message}`
      );
      return {
        id: job.id,
        status: 'deadletter',
        output: { message, attempt, permanent: true }
      };
    }

    const willRetry = attempt < RETRY_LIMIT;

    console.error(
      `[queue:${source}] job=${job.id} attempt=${label} FAILED after ${Date.now() - startedAt}ms: ${message}` +
        (willRetry
          ? ' — retrying with exponential backoff'
          : ' — retries exhausted, routing to the dead-letter queue')
    );

    // 'failed' lets pg-boss apply the retry policy; it dead-letters on its own
    // once retryLimit is exhausted.
    return { id: job.id, status: 'failed', output: { message, attempt } };
  }
}

export type { RawEventSource };
