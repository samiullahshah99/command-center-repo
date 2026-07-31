/**
 * Fireflies webhook.
 *
 * https://docs.fireflies.ai/graphql-api/webhooks
 *
 *   header     x-hub-signature   ⚠️ NO "-256" suffix (not GitHub's convention)
 *   prefix     sha256=
 *   basestring rawBody only
 *   payload    { meetingId, eventType, clientReferenceId } — METADATA ONLY
 *
 * ⚠️ NO REPLAY PROTECTION. Fireflies sends no timestamp, so verifyBodyOnly is
 * used and idempotency on meetingId is the only defence.
 *
 * ⚠️ FIREFLIES' RETRY BEHAVIOUR IS UNDOCUMENTED. Slack and ClickUp both retry on
 * a non-2xx, which makes returning 500 a safe way to ask for redelivery. Their
 * docs say nothing about it, so a 500 here may mean the meeting is never
 * announced again. The recovery path is getTranscripts() backfill, not a retry
 * we cannot count on.
 *
 * The webhook carries no transcript — the worker fetches it over GraphQL.
 */

import { ingestRawEvent } from '@/features/connectors/ingest';
import { externalIdOf, verifyFirefliesRequest } from '@/features/connectors/fireflies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // ── 1. Raw body, read once ────────────────────────────────────────────────
  // Never req.json() first: it consumes the stream, and re-serialising changes
  // the bytes so the HMAC fails in a way that looks like a wrong secret.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // ── 2. Signature ──────────────────────────────────────────────────────────
  const verified = verifyFirefliesRequest({ rawBody, headers: req.headers });
  if (!verified.ok) {
    // Reason only. Never the secret, the signature, or the body.
    console.warn(`[fireflies-webhook] rejected: ${verified.reason}`);
    return new Response('Unauthorized', { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    console.warn('[fireflies-webhook] rejected: malformed_json');
    return new Response('Bad Request', { status: 400 });
  }

  // ── 3. Persist, THEN acknowledge ──────────────────────────────────────────
  // Store the notification verbatim. The transcript itself is fetched by the
  // worker and lands in the `transcript` table, not here.
  //
  // Unknown eventType values are stored like any other — the catalog is
  // expected to grow and rejecting unknown types would drop real signal.
  try {
    const result = await ingestRawEvent({
      source: 'fireflies',
      payload: parsed,
      externalId: externalIdOf(parsed)
    });

    if (result.duplicate) {
      console.warn('[fireflies-webhook] duplicate suppressed');
      // Already stored and already queued — nothing more to do.
      return new Response(null, { status: 200 });
    }

    // ── 4. Enqueue the transcript fetch ─────────────────────────────────────
    // AFTER the row is committed: the worker re-reads it, so enqueuing first
    // would race. Deliberately not fatal — see the catch.
    if (result.id) {
      try {
        const { sendParseJob } = await import('@/lib/queue');
        const { FIREFLIES_JOB_OPTIONS } = await import('@/features/connectors/fireflies');
        await sendParseJob('fireflies', { rawEventId: result.id }, FIREFLIES_JOB_OPTIONS);
      } catch (err) {
        // The event IS stored, so nothing is lost that a backfill cannot
        // recover. Returning 500 here would be worse: Fireflies may not retry,
        // and we would have thrown away a successful write for a queue blip.
        console.error(
          '[fireflies-webhook] stored the event but failed to enqueue the fetch:',
          err instanceof Error ? err.message : err
        );
      }
    }
  } catch (err) {
    console.error('[fireflies-webhook] ingest failed:', err instanceof Error ? err.message : err);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response(null, { status: 200 });
}

/** Reachability check for humans wiring the URL up. */
export function GET() {
  return Response.json(
    { ok: true, endpoint: 'fireflies-webhook', method: 'POST only' },
    { status: 200 }
  );
}
