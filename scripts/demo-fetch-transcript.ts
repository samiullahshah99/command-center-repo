/**
 * Pull real Fireflies transcripts into the database for a demo.
 *
 *   pnpm tsx scripts/demo-fetch-transcript.ts <id> <id> <id>
 *   pnpm tsx scripts/demo-fetch-transcript.ts <id> --enqueue
 *
 * By default it prints the `pnpm extract:run` command per meeting rather than
 * queueing, because for a demo you want extraction to happen when you say so and
 * print in front of you. `--enqueue` hands the jobs to the worker instead — see
 * printExtractCommands() for why that is not the default.
 *
 * ── ⚠️ REAL MEETING CONTENT — DATABASE ONLY ─────────────────────────────────
 * This script writes to Postgres and NOTHING ELSE. It does not write to
 * fixtures/, does not cache to disk, and does not emit a file of any kind.
 *
 * This repo is PUBLIC. Real transcripts contain names, work emails, and things
 * people said out loud about clients, money, health and each other — a scrubbed
 * transcript in this repo once still carried a speaker's home city, which passed
 * every mechanical PII rule because it held no name and no email address. There
 * is no scrub good enough to make a real meeting safe to commit, so the safe
 * design is to have no file-writing code path here at all.
 *
 * To build committable eval fixtures, use the deliberate, scrubbing route:
 * `pnpm fireflies:fixture` — see fixtures/extraction-eval/README.md.
 *
 * ── Why this goes through the worker ────────────────────────────────────────
 * The whole point of a demo is to exercise the real pipeline, so this does not
 * fetch-and-insert on its own. It builds the same v2 webhook envelope Fireflies
 * would send, stores it through `ingestRawEvent()` (the ONLY sanctioned write
 * path into raw_event), then hands the row to `handleFirefliesJob()` — the exact
 * function the pg-boss worker calls. Normalisation, the transcript fetch, the
 * upsert, error classification and `processed` all happen in production code.
 *
 * It calls the handler DIRECTLY rather than enqueueing, for two reasons: the
 * script has to report what landed, which means running synchronously; and
 * enqueueing would require a worker process to be up, which on a laptop it is
 * not. Same function either way — the queue only decides *when* it runs.
 */

// ⚠️ FIRST IMPORT, and it must stay first. Side-effect module that loads
// .env.local — the documented usage is a bare `pnpm tsx ...` with no
// `--env-file`, so nothing else brings it in. See the note in _load-env.ts for
// why this cannot be a function call in the body of this file.
import './_load-env';

import { sql } from 'drizzle-orm';
import { db, pool } from '@/db';
import { findRawEventByExternalId, ingestRawEvent } from '@/features/connectors/ingest';
import { externalIdOf } from '@/features/connectors/fireflies';
import { handleFirefliesJob } from '@/features/connectors/fireflies/worker';
import { PermanentJobError } from '@/lib/queue/types';

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('--'));

/** Opt in to queueing. Off by default — see printExtractCommands() for why. */
const ENQUEUE = args.includes('--enqueue');

/**
 * Whether we ever opened a connection.
 *
 * `pool` is a lazy getter that THROWS when DATABASE_URL is unset, so an
 * unconditional `pool.end()` in a finally block blows up the usage/help path —
 * which never touched the database — and buries the actual message under a
 * stack trace. Only close what was opened.
 */
let usedDb = false;

/** The envelope Fireflies itself sends for a finished meeting. */
function envelopeFor(meetingId: string) {
  return {
    event: 'meeting.transcribed',
    meeting_id: meetingId,
    // Fireflies sends epoch MILLISECONDS. The worker classifies a
    // "not found" as transient vs permanent by the age of the raw_event, so a
    // fresh timestamp here means a genuinely-not-ready transcript is reported
    // as retryable rather than dead.
    timestamp: Date.now()
  };
}

type Landed = {
  meetingId: string;
  title: string | null;
  durationSeconds: number | null;
  meetingDate: Date | null;
  sentences: number;
  speakers: string[];
  unifiedEventId: string | null;
};

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return '(unknown)';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Read back what is actually on disk, rather than trusting the fetch response. */
async function readBack(meetingId: string): Promise<Landed | null> {
  const r = await db.execute<{
    title: string | null;
    duration_seconds: number | null;
    meeting_date: string | null;
    sentences: number;
    speakers: string[] | null;
    unified_event_id: string | null;
  }>(sql`
    select
      t.title,
      t.duration_seconds,
      t.meeting_date,
      jsonb_array_length(coalesce(t.payload->'sentences', '[]'::jsonb)) as sentences,
      (
        select coalesce(array_agg(distinct s->>'name'), '{}')
        from jsonb_array_elements(coalesce(t.payload->'speakers', '[]'::jsonb)) as s
        where s->>'name' is not null
      ) as speakers,
      (
        select ue.id from unified_event ue
        where ue.subject_id = t.fireflies_id and ue.source = 'fireflies'
        order by ue.occurred_at desc limit 1
      ) as unified_event_id
    from transcript t
    where t.fireflies_id = ${meetingId}
  `);

  const row = r.rows[0];
  if (!row) return null;

  return {
    meetingId,
    title: row.title,
    durationSeconds: row.duration_seconds,
    meetingDate: row.meeting_date ? new Date(row.meeting_date) : null,
    sentences: row.sentences,
    speakers: row.speakers ?? [],
    unifiedEventId: row.unified_event_id
  };
}

async function fetchOne(meetingId: string, index: number): Promise<Landed> {
  const payload = envelopeFor(meetingId);
  const externalId = externalIdOf(payload);

  // ingestRawEvent is ON CONFLICT DO NOTHING on (source, external_id), so a
  // second run of the same meeting inserts nothing and returns id: null. That
  // is correct behaviour, not a failure — look the existing row up and re-drive
  // the handler against it so the script stays re-runnable, which matters when
  // a demo is being rehearsed.
  const result = await ingestRawEvent({ source: 'fireflies', payload, externalId });

  let rawEventId = result.id;
  if (!rawEventId && externalId) {
    const existing = await findRawEventByExternalId('fireflies', externalId);
    rawEventId = existing?.id ?? null;
  }
  if (!rawEventId) {
    throw new Error(`could not create or find a raw_event for ${meetingId}`);
  }

  console.warn(
    `[demo] ${meetingId} raw_event=${rawEventId} ${result.duplicate ? '(already ingested, re-driving)' : '(new)'}`
  );

  // The real worker entrypoint: normalise -> fetch -> upsert -> mark processed.
  await handleFirefliesJob(
    { rawEventId },
    { jobId: `demo-${index + 1}`, attempt: 0, source: 'fireflies' }
  );

  const landed = await readBack(meetingId);
  if (!landed) {
    throw new Error(
      `handler completed but no transcript row exists for ${meetingId} — ` +
        `the webhook envelope was probably rejected as off-contract`
    );
  }
  return landed;
}

function print(l: Landed): void {
  console.log(`\n  ${l.title ?? '(untitled)'}`);
  console.log(`    fireflies id    ${l.meetingId}`);
  console.log(`    meeting date    ${l.meetingDate?.toISOString().slice(0, 16).replace('T', ' ') ?? '(unknown)'}`);
  console.log(`    duration        ${fmtDuration(l.durationSeconds)}`);
  console.log(`    sentences       ${l.sentences}`);
  console.log(`    speakers (${l.speakers.length})    ${l.speakers.join(', ') || '(none listed)'}`);
  console.log(`    unified_event   ${l.unifiedEventId ?? '(none — normalisation produced no row)'}`);
}

async function main() {
  if (ids.length === 0) {
    console.error(
      'Usage: pnpm tsx scripts/demo-fetch-transcript.ts <transcriptId> [<transcriptId> ...] [--enqueue]\n\n' +
        'Fetches each transcript from Fireflies and stores it in the DATABASE only.\n' +
        'Nothing is written to fixtures/ — these are real meetings and must not be committed.\n\n' +
        '  --enqueue   queue an extraction job per transcript instead of printing the\n' +
        '              command. Jobs run on the worker that owns this database, not here.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nFetching ${ids.length} transcript(s) from Fireflies into the database.\n` +
      `⚠️  Real meeting content. Database only — nothing is written to disk.\n` +
      `    Fireflies allows 500 API requests per DAY; this run uses ~${ids.length}.`
  );

  usedDb = true;

  const landed: Landed[] = [];
  const failed: { id: string; reason: string; permanent: boolean }[] = [];

  for (const [i, id] of ids.entries()) {
    try {
      landed.push(await fetchOne(id, i));
    } catch (err) {
      // One bad id must not abandon the rest — a demo set is usually assembled
      // from ids pasted by hand, and one typo should cost one transcript.
      const permanent = err instanceof PermanentJobError;
      failed.push({
        id,
        reason: err instanceof Error ? err.message : String(err),
        permanent
      });
      console.error(`[demo] ${id} FAILED${permanent ? ' (permanent)' : ' (transient)'}`);
    }
  }

  if (landed.length > 0) {
    console.log(`\n${'─'.repeat(72)}\nLANDED — ${landed.length} transcript(s)`);
    landed.forEach(print);
  }

  if (failed.length > 0) {
    console.log(`\n${'─'.repeat(72)}\nFAILED — ${failed.length}`);
    for (const f of failed) {
      console.log(`\n  ${f.id}`);
      console.log(`    ${f.permanent ? 'PERMANENT' : 'TRANSIENT'}  ${f.reason}`);
      if (f.permanent) {
        console.log(
          `    A permanent failure will not fix itself. Usual causes: the id is wrong,\n` +
            `    the transcript belongs to another workspace, or the plan does not cover it.`
        );
      } else {
        console.log(
          `    Transient — Fireflies can announce a meeting before the transcript is\n` +
            `    queryable. Wait a few minutes and re-run; this script is idempotent.`
        );
      }
    }
    process.exitCode = 1;
  }

  const extractable = landed.filter((l) => l.unifiedEventId);
  if (extractable.length === 0) {
    console.log();
    return;
  }

  if (ENQUEUE) {
    await enqueueAll(extractable);
  } else {
    printExtractCommands(extractable);
  }
  console.log();
}

/**
 * The DEFAULT: print the command instead of queueing.
 *
 * ⚠️ Deliberately the default, and the reason is where the work would actually
 * run. `.env.local` points DATABASE_URL at the Railway proxy — the production
 * database — and the queue lives in that same Postgres. Nothing consumes it
 * locally (workers boot from `src/instrumentation.ts`, inside the Next server).
 * So enqueueing from a laptop hands the job to the PRODUCTION worker: it runs
 * minutes later, on another machine, spending real LLM credit, with the output
 * in production logs rather than on the screen in front of you.
 *
 * For a demo that is exactly backwards — you want the extraction to happen when
 * you say so and print where people can see it. `pnpm extract:run` does that
 * synchronously through the same extractor.
 */
function printExtractCommands(items: Landed[]): void {
  console.log(`\n${'─'.repeat(72)}\nNOT ENQUEUED — printing the commands instead.\n`);

  console.log(`  Run extraction HERE, now, printing the items (recommended for a demo):\n`);
  for (const l of items) {
    console.log(`    pnpm extract:run ${l.unifiedEventId}    # ${l.title ?? l.meetingId}`);
  }

  console.log(`\n  Or ENQUEUE for the worker instead:\n`);
  console.log(
    `    pnpm tsx scripts/demo-fetch-transcript.ts ${items.map((l) => l.meetingId).join(' ')} --enqueue`
  );
  console.log(
    `\n  ⚠️  Enqueueing runs the extraction on whichever worker consumes this\n` +
      `      database's queue — the deployed app, not this terminal. The output\n` +
      `      goes to that worker's logs, minutes later. That is why printing is\n` +
      `      the default: a demo wants the result on screen when you ask for it.`
  );
}

/** `--enqueue`: hand each meeting to the extraction queue. */
async function enqueueAll(items: Landed[]): Promise<void> {
  const { sendExtractionJob, EXTRACTION_QUEUE } = await import('@/lib/queue');
  const { stopBoss } = await import('@/lib/queue');

  console.log(`\n${'─'.repeat(72)}\nENQUEUEING ${items.length} extraction job(s)\n`);
  console.log(
    `  ⚠️  These run on whichever worker consumes ${EXTRACTION_QUEUE} in this\n` +
      `      database — which is the deployed app, not this terminal. Each job is a\n` +
      `      paid LLM call. Output goes to that worker's logs.\n`
  );

  try {
    for (const l of items) {
      const jobId = await sendExtractionJob({ unifiedEventId: l.unifiedEventId! });
      console.log(
        jobId
          ? `  queued  ${jobId}  ${l.title ?? l.meetingId}`
          : `  NOT QUEUED  ${l.title ?? l.meetingId} — send() returned null`
      );
    }
  } finally {
    // pg-boss holds its own pool; without this the process hangs after the last
    // job is sent and the script looks wedged rather than finished.
    await stopBoss({ graceful: false });
  }

  console.log(
    `\n  Watch them with:  select id, state, output from pgboss.job\n` +
      `                    where name = '${EXTRACTION_QUEUE}' order by created_on desc;`
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (usedDb) await pool.end();
  });
