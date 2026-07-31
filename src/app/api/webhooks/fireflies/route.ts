/**
 * Fireflies webhook.
 *
 * ⚠️ docs.fireflies.ai/graphql-api/webhooks documents the DEPRECATED v1 webhook
 * and is wrong on every payload field. This handler targets v2 (the Integrations
 * page), confirmed from live deliveries by `Fireflies-Webhook/2.0`.
 *
 *   header     x-hub-signature   ⚠️ NO "-256" suffix (not GitHub's convention)
 *   prefix     sha256=
 *   basestring rawBody only
 *   payload    { event, meeting_id, timestamp } — snake_case, METADATA ONLY
 *
 * ⚠️ NO REPLAY WINDOW IS ENFORCED. There is no timestamp HEADER, so nothing
 * enters the basestring and verifyBodyOnly stays correct. The BODY does carry a
 * millisecond `timestamp` which could bound replay — see the reasoning in
 * features/connectors/fireflies/index.ts for why it is deliberately not used.
 * Idempotency on (event, meeting_id) is the defence.
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
import {
  externalIdOf,
  FIREFLIES_DELIVERY_ID_HEADER,
  isUnsignedTestDelivery,
  verifyFirefliesRequest
} from '@/features/connectors/fireflies';

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

  // TODO(REMOVE ONCE REAL EVENTS ARE CONFIRMED SIGNED) — see
  // isUnsignedTestDelivery(). Narrow exception for Fireflies' UNSIGNED test
  // pings so their payload can be inspected. Real deliveries (no `test-`
  // prefix) fall straight through to the 401 below, unchanged.
  const unsignedTest = !verified.ok && isUnsignedTestDelivery(req.headers);

  if (!verified.ok && !unsignedTest) {
    // Reason only. Never the secret, the signature, or the body.
    console.warn(`[fireflies-webhook] rejected: ${verified.reason}`);

    // TODO(REMOVE): temporary contract diagnostics — see logRejectedRequest().
    logRejectedRequest(req, rawBody, verified.reason);

    return new Response('Unauthorized', { status: 401 });
  }

  if (unsignedTest) {
    // Loud on purpose: this line means signature verification was BYPASSED.
    // If it ever appears for something that is not a Fireflies setup ping, the
    // exception is being abused and must come out immediately.
    console.warn(
      `[fireflies-webhook] ⚠️⚠️ SIGNATURE CHECK BYPASSED — accepting UNSIGNED test delivery ` +
        `deliveryId=${JSON.stringify(req.headers.get(FIREFLIES_DELIVERY_ID_HEADER))} ` +
        `verifyReason=${verified.ok ? 'n/a' : verified.reason} ` +
        `— TEMPORARY, remove once real events are confirmed signed`
    );

    // Full header/body dump too: the whole point is to learn the real contract,
    // and a test ping is the only delivery we currently receive.
    logRejectedRequest(req, rawBody, 'unsigned_test_delivery_accepted');
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
  // Unknown `event` values are stored like any other — the catalog is
  // expected to grow and rejecting unknown types would drop real signal.
  try {
    const result = await ingestRawEvent({
      source: 'fireflies',
      payload: parsed,
      // TODO(REMOVE with the unsigned-test exception): test pings store with a
      // NULL key, matching how UGC and Vision handle theirs. Their ids are not
      // meeting ids, and deduplicating on them would make the second ping vanish
      // — during setup that is indistinguishable from a broken handler. A null
      // key also makes these rows trivial to find and purge afterwards.
      externalId: unsignedTest ? null : externalIdOf(parsed)
    });

    if (result.duplicate) {
      console.warn('[fireflies-webhook] duplicate suppressed');
      // Already stored and already queued — nothing more to do.
      return new Response(null, { status: 200 });
    }

    // TODO(REMOVE with the unsigned-test exception)
    // ⚠️ Stored, but deliberately NOT enqueued. The worker's job is to fetch the
    // transcript for a meeting_id over GraphQL; a test ping carries no real
    // meeting, so the fetch would fail and retry 3× on an API limited to 500
    // requests per DAY — spending real quota to learn nothing.
    if (unsignedTest) {
      console.warn(
        `[fireflies-webhook] unsigned test delivery stored raw_event=${result.id} — NOT enqueued (no real meeting_id to fetch)`
      );
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

// ════════════════════════════════════════════════════════════════════════════
// TODO(REMOVE ONCE THE FIREFLIES CONTRACT IS CONFIRMED)
//
// Delete this function and its single call site in POST. Nothing else depends
// on it, so removal is a clean two-hunk revert.
//
// ── Why it exists ───────────────────────────────────────────────────────────
// Our verifier follows docs.fireflies.ai/graphql-api/webhooks: header
// `x-hub-signature` (no -256), prefix `sha256=`, basestring = raw body, no
// timestamp. Those docs may describe the DEPRECATED Developer Settings webhook;
// Fireflies has since moved webhooks to the Integrations page and the header
// name or basestring may differ. A bare `rejected: signature_mismatch` cannot
// distinguish "wrong secret" from "wrong header" from "wrong basestring", so
// the real contract has to be read off an actual rejected delivery.
//
// ── Scope ───────────────────────────────────────────────────────────────────
// FAILURE PATH ONLY. A verified request logs nothing extra, so this cannot leak
// the contents of legitimate transcripts. Verification is unchanged and the
// response is still 401.
//
// ⚠️ This endpoint is public. Anything anyone POSTs to it is written to the logs
// verbatim, which is both a log-flooding vector and a log-injection one (a body
// can contain newlines that mimic further log lines). That is the main reason to
// remove this as soon as one real delivery has been captured.
//
// Nothing is redacted, deliberately — identifying the scheme means seeing the
// header names and values exactly as sent. FIREFLIES_WEBHOOK_SECRET is never
// part of an inbound request, so it cannot appear here; the signature that does
// appear is a digest and does not reveal it.
// ════════════════════════════════════════════════════════════════════════════
function logRejectedRequest(req: Request, rawBody: string, reason: string): void {
  const BODY_LIMIT = 500;

  // ⚠️ TWO LOG CALLS, AND NEITHER CONTAINS A NEWLINE.
  //
  // An earlier version emitted one console.warn holding a multi-line string.
  // That is still one call, but log shippers split on newlines, so each line
  // became its own record and other workers' output interleaved between the
  // "body (N bytes):" header and the body itself — losing exactly the part
  // worth reading. Each call below is a single unsplittable line.
  //
  // Both values go through JSON.stringify, which is what makes that guarantee
  // hold: a header value or a body containing a newline would otherwise
  // reintroduce the split. It also quotes empty values so they stay visible.
  //
  // console.warn, NOT console.log: next.config.ts strips console.* in
  // production except error and warn, and production is where Fireflies
  // actually delivers. A console.log here would print nothing where it matters.
  const headers = Object.fromEntries(req.headers.entries());

  console.warn(
    `[fireflies-webhook] DIAG reason=${reason} method=${req.method} url=${req.url} headers=${JSON.stringify(headers)}`
  );

  console.warn(
    `[fireflies-webhook] DIAG bodyBytes=${rawBody.length} truncated=${rawBody.length > BODY_LIMIT} body=${JSON.stringify(rawBody.slice(0, BODY_LIMIT))}`
  );
}

/** Reachability check for humans wiring the URL up. */
export function GET() {
  return Response.json(
    { ok: true, endpoint: 'fireflies-webhook', method: 'POST only' },
    { status: 200 }
  );
}
