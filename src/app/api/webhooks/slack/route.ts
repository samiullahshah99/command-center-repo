/**
 * Slack Events API webhook.
 *
 * Publicly reachable by design: src/proxy.ts protects /dashboard(.*) only, and
 * Slack posts with no session cookie. Authentication is the request signature.
 *
 * All logic lives in src/features/connectors/slack/ — this file is ordering and
 * HTTP concerns only. No parsing of event meaning anywhere in this path.
 *
 * ── Why the write is SYNCHRONOUS ────────────────────────────────────────────
 * Slack retries only on a FAILED delivery: non-2xx, a timeout over 3 seconds, or
 * a connection error. Once a 200 is flushed it considers the event delivered and
 * discards it — there is no retry.
 *
 * So a write deferred to after() that then fails is lost permanently and
 * silently. Persisting before responding means a failure returns 500, Slack
 * retries (immediately, then +1min, then +5min), and the idempotency index
 * suppresses the duplicate if an earlier attempt actually did land.
 *
 * The cost is small: the insert is one INSERT … ON CONFLICT DO NOTHING, measured
 * at a ~295ms median over Railway's public proxy and faster over the private
 * network — roughly 10% of the 3-second budget.
 */

import { ingestAndEnqueue } from '@/features/connectors/ingest';
import {
  externalIdOf,
  isUrlVerification,
  shouldSkipEvent,
  verifySlackRequest
} from '@/features/connectors/slack';

// Never cached, and must run on Node (the signature HMAC uses node:crypto).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // ── 1. Read the RAW body ──────────────────────────────────────────────────
  // req.text() first and only once. Calling req.json() would consume the stream,
  // and re-serialising the result changes bytes, so the HMAC would never match.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // ── 2. Signature verification — BEFORE anything else ──────────────────────
  // Including before the url_verification handshake. Slack signs every request to
  // the Request URL, the handshake included, so a wrong SLACK_SIGNING_SECRET
  // fails loudly at registration time with an immediate, obvious signal.
  //
  // The alternative — handling the handshake first — lets registration SUCCEED
  // with a wrong secret and then 401 every real event afterwards, which is a much
  // worse thing to debug.
  const verified = verifySlackRequest({ rawBody, headers: req.headers });
  if (!verified.ok) {
    // Reason only. Never the secret, the signature, or the body.
    console.warn(`[slack-webhook] rejected: ${verified.reason}`);
    return new Response('Unauthorized', { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // ── 3. url_verification handshake ─────────────────────────────────────────
  // Raw challenge value, text/plain, no persistence. Slack rejects anything else.
  if (isUrlVerification(parsed)) {
    return new Response(parsed.challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  // ── 4. Loop guard ─────────────────────────────────────────────────────────
  // Before persisting: a bot echo carries no signal worth replaying, and storing
  // it invites a future processor to act on our own output.
  const skip = shouldSkipEvent(parsed);
  if (skip.skip) {
    // Not logged: this fires on every bot message, so in an active channel it
    // would be pure log volume with no diagnostic value. The 200 is the signal.
    return new Response(null, { status: 200 });
  }

  // ── 5. Persist + enqueue in one transaction, then acknowledge ─────────────
  // Idempotent on (source, external_id). event_id is stable across Slack's
  // retries, so a retry of an already-stored event is suppressed by the index and
  // still answered 200 — WITHOUT queuing a second job for the same event.
  //
  // Both statements share one transaction, so the parse job cannot become
  // visible before the row it names. See ingestAndEnqueue().
  try {
    const result = await ingestAndEnqueue({
      source: 'slack',
      payload: parsed, // verbatim, unmodified
      externalId: externalIdOf(parsed)
    });

    if (result.duplicate) {
      // A duplicate means Slack retried, which means an earlier delivery failed
      // or timed out. Dedup handled it, but the retry is worth noticing.
      console.warn('[slack-webhook] duplicate suppressed — no second job queued');
    }
  } catch (err) {
    // 500 on purpose: this is what makes Slack retry. Returning 200 here would
    // discard the event permanently. A queue failure lands here too, having
    // rolled the row back, so the retry re-does both halves cleanly.
    console.error(
      '[slack-webhook] ingest failed, returning 500 so Slack retries:',
      err instanceof Error ? err.message : err
    );
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response(null, { status: 200 });
}

/**
 * Slack only ever POSTs. A GET is almost always a human checking the URL by
 * hand, so answer something useful instead of a framework 405.
 */
export function GET() {
  return Response.json(
    { ok: true, endpoint: 'slack-webhook', method: 'POST only' },
    { status: 200 }
  );
}
