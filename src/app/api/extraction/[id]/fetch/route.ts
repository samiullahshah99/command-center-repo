/**
 * POST /api/extraction/:id/fetch — fetch a Fireflies transcript and extract it.
 *
 * Three steps, all through production code:
 *
 *   1. ingestRawEvent()      the ONLY sanctioned write path into raw_event
 *   2. handleFirefliesJob()  the exact function the pg-boss worker runs —
 *                            normalise, GraphQL fetch, upsert on fireflies_id
 *   3. sendExtractionJob()   queue the LLM extraction
 *
 * ⚠️ Nothing here re-implements the fetch or the upsert. Step 2 IS the worker,
 * so the demo exercises the same path a real webhook does; a bug found in the
 * demo is a bug in production, which is the entire point of not writing a
 * bypass.
 *
 * ⚠️ The Fireflies API key is read inside handleFirefliesJob, on the server.
 * It never appears in a response body and never reaches the browser.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { desc, sql } from 'drizzle-orm';
import { unifiedEvent } from '@/db/schema';
import { externalIdOf } from '@/features/connectors/fireflies';
import { findRawEventByExternalId, ingestRawEvent } from '@/features/connectors/ingest';
import { handleFirefliesJob } from '@/features/connectors/fireflies/worker';
import { describeFirefliesError } from '@/features/extraction/api/service';
import { sendExtractionJob } from '@/lib/queue';
import type { FetchExtractResult } from '@/features/extraction/api/types';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse<FetchExtractResult>> {
  // ⚠️ Resource-based check, not a reliance on src/proxy.ts. This endpoint pulls
  // real meeting content and spends money; `createRouteMatcher` is deprecated
  // and its matching can diverge from how Next.js routes.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, reason: 'auth', message: 'Not authenticated' } as const, {
      status: 401
    });
  }

  const { id: firefliesId } = await ctx.params;
  if (!firefliesId) {
    return NextResponse.json(
      { ok: false, reason: 'error', message: 'Missing transcript id' } as const,
      { status: 400 }
    );
  }

  // The same v2 envelope Fireflies itself would deliver, so the worker sees a
  // shape it already understands rather than a demo-only one.
  const payload = {
    event: 'meeting.transcribed',
    meeting_id: firefliesId,
    timestamp: Date.now()
  };
  const externalId = externalIdOf(payload);

  try {
    // ON CONFLICT DO NOTHING on (source, external_id): a second click finds the
    // existing row rather than inserting a duplicate, so the button is safe to
    // press twice — which during a demo it will be.
    const ingested = await ingestRawEvent({ source: 'fireflies', payload, externalId });
    let rawEventId = ingested.id;
    if (!rawEventId && externalId) {
      rawEventId = (await findRawEventByExternalId('fireflies', externalId))?.id ?? null;
    }
    if (!rawEventId) {
      return NextResponse.json(
        { ok: false, reason: 'error', message: 'Could not record the fetch request' } as const,
        { status: 500 }
      );
    }

    await handleFirefliesJob(
      { rawEventId },
      { jobId: `ui-${firefliesId}`, attempt: 0, source: 'fireflies' }
    );
  } catch (err) {
    // ⚠️ The plan case lands here and must NOT read as a generic failure.
    // describeFirefliesError turns `paid_required` into the exact wording the
    // row shows. 200 is deliberate: the request itself worked, the upstream
    // simply will not serve this meeting on the current billing tier, and a 5xx
    // would put it in the browser console as an application error.
    const described = await describeFirefliesError(err);
    return NextResponse.json({ ok: false, ...described } as const, {
      status: described.reason === 'plan' ? 200 : 502
    });
  }

  const [event] = await db
    .select({ id: unifiedEvent.id })
    .from(unifiedEvent)
    .where(sql`${unifiedEvent.subjectId} = ${firefliesId} and ${unifiedEvent.source} = 'fireflies'`)
    .orderBy(desc(unifiedEvent.occurredAt))
    .limit(1);

  if (!event) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'error',
        message: 'Transcript stored but no unified_event was produced'
      } as const,
      { status: 500 }
    );
  }

  // Extraction is queued, never run inline: it is a multi-second LLM call and
  // holding the request open for it would time out behind a proxy and give the
  // UI no way to show progress. The client polls /status from here.
  const jobId = await sendExtractionJob({ unifiedEventId: event.id });

  return NextResponse.json({
    ok: true,
    firefliesId,
    unifiedEventId: event.id,
    jobId
  } as const);
}
