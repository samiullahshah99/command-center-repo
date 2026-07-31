/**
 * ClickUp webhook.
 *
 * Publicly reachable by design: src/proxy.ts protects /dashboard(.*) only, and
 * ClickUp posts with no session cookie. Authentication is the X-Signature HMAC.
 *
 * All logic lives in src/features/connectors/clickup/ — this file is ordering and
 * HTTP concerns only. No parsing of event meaning.
 *
 * ── Why the write is SYNCHRONOUS ────────────────────────────────────────────
 * Same reasoning as the Slack handler: a write deferred past the response cannot
 * influence the status code, so a failure would be lost silently. Persisting
 * first means a failure returns 500 and ClickUp retries, with the idempotency
 * index suppressing any duplicate.
 *
 * ClickUp additionally tracks webhook HEALTH and will suspend a webhook after
 * repeated failures, so a handler that fails quietly does more damage here than
 * a lost event — it can take the whole subscription offline. That is an argument
 * for making failures visible in logs, not for hiding them behind a 200.
 */

import { ingestRawEvent } from '@/features/connectors/ingest';
import { externalIdOf, verifyClickUpRequest } from '@/features/connectors/clickup';

// Never cached, and must run on Node (the HMAC uses node:crypto).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // ── 1. Read the RAW body ──────────────────────────────────────────────────
  // req.text() first and only once. req.json() would consume the stream, and
  // re-serialising changes bytes so the HMAC would never match.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // ── 2. Signature verification ─────────────────────────────────────────────
  // Uses CLICKUP_WEBHOOK_SECRET (returned at webhook creation), NOT the API token.
  const verified = verifyClickUpRequest({ rawBody, headers: req.headers });
  if (!verified.ok) {
    // Reason only. Never the secret, the signature, or the body.
    console.warn(`[clickup-webhook] rejected: ${verified.reason}`);
    return new Response('Unauthorized', { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // ── 3. Persist, then acknowledge ──────────────────────────────────────────
  // externalId is history_items[0].id when present, else null — see events.ts for
  // why webhook_id must never be used.
  try {
    const result = await ingestRawEvent({
      source: 'clickup',
      payload: parsed, // verbatim, unmodified
      externalId: externalIdOf(parsed)
    });

    if (result.duplicate) {
      console.warn('[clickup-webhook] duplicate suppressed');
    }
  } catch (err) {
    // 500 on purpose: this is what makes ClickUp retry. Returning 200 would
    // discard the event. Repeated 500s do risk webhook suspension, which is why
    // the error is logged loudly rather than swallowed.
    console.error(
      '[clickup-webhook] ingest failed, returning 500 so ClickUp retries:',
      err instanceof Error ? err.message : err
    );
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response(null, { status: 200 });
}

/**
 * ClickUp calls the endpoint when the webhook is created to check reachability,
 * and a human checking the URL by hand will also GET it.
 */
export function GET() {
  return Response.json(
    { ok: true, endpoint: 'clickup-webhook', method: 'POST only' },
    { status: 200 }
  );
}
