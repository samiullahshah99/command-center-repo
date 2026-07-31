/**
 * Shared webhook handler for the UGC and Vision platforms.
 *
 * They share an ingest path but NOT a signature scheme — UGC signs with a
 * timestamp, Vision does not. That is dispatched explicitly below rather than
 * hidden behind an optional parameter, so the absence of replay protection on
 * Vision is visible in the code.
 *
 * Follows CLAUDE.md: raw body once -> verify -> persist BEFORE responding -> 2xx.
 * No parsing, no field extraction. The COMPLETE envelope is stored.
 */

import { ingestAndEnqueue } from '../ingest';
import type { HmacVerifyResult } from '../verify-hmac';
import { verifyBodyOnly, verifyWithTimestamp } from '../verify-hmac';
import {
  externalIdOf,
  isTestEvent,
  SECRET_ENV_VAR,
  UGC_EVENT_HEADER,
  UGC_SEPARATOR,
  UGC_SIGNATURE_HEADER,
  UGC_SIGNATURE_PREFIX,
  UGC_TIMESTAMP_HEADER,
  UGC_WINDOW_SECONDS,
  VISION_EVENT_HEADER,
  VISION_SIGNATURE_HEADER,
  VISION_SIGNATURE_PREFIX,
  type InternalPlatform
} from './contract';

function verify(
  platform: InternalPlatform,
  rawBody: string,
  headers: Headers,
  secret: string | undefined
): HmacVerifyResult {
  if (platform === 'ugc') {
    return verifyWithTimestamp({
      headerName: UGC_SIGNATURE_HEADER,
      timestampHeader: UGC_TIMESTAMP_HEADER,
      prefix: UGC_SIGNATURE_PREFIX,
      // Literal dot, not a colon. See contract.ts.
      separator: UGC_SEPARATOR,
      format: 'plain',
      secret,
      rawBody,
      headers,
      windowSeconds: UGC_WINDOW_SECONDS
    });
  }

  // ⚠️ Vision: NO REPLAY WINDOW EXISTS. The sender transmits no timestamp, so a
  // captured request remains valid indefinitely and can be replayed verbatim.
  // Idempotency on payload.id is the ONLY protection for this endpoint.
  return verifyBodyOnly({
    headerName: VISION_SIGNATURE_HEADER,
    prefix: VISION_SIGNATURE_PREFIX,
    secret,
    rawBody,
    headers
  });
}

function eventTypeHeader(platform: InternalPlatform, headers: Headers): string | null {
  return headers.get(platform === 'ugc' ? UGC_EVENT_HEADER : VISION_EVENT_HEADER);
}

export function createInternalWebhookHandler(platform: InternalPlatform) {
  const secretVar = SECRET_ENV_VAR[platform];
  const tag = `[${platform}-webhook]`;

  return async function POST(req: Request): Promise<Response> {
    // ── 1. Raw body, read once ──────────────────────────────────────────────
    // Never req.json() first: it consumes the stream, and re-serialising changes
    // the bytes so the HMAC fails in a way that looks like a wrong secret.
    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    // ── 2. Signature ────────────────────────────────────────────────────────
    const verified = verify(platform, rawBody, req.headers, process.env[secretVar]);
    if (!verified.ok) {
      // Reason only. Never the secret, the signature, or the body.
      console.warn(`${tag} rejected: ${verified.reason}`);
      return new Response('Unauthorized', { status: 401 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      console.warn(`${tag} rejected: malformed_json`);
      return new Response('Bad Request', { status: 400 });
    }

    // ── 3. Setup test events ────────────────────────────────────────────────
    // Both platforms send a CONSTANT id for their test event. Deduplicating on
    // it would make the second ping vanish, which during setup is indis-
    // tinguishable from a broken handler. Stored with a null externalId so every
    // ping lands as its own row and is visible.
    const isTest = isTestEvent(platform, parsed, eventTypeHeader(platform, req.headers));
    if (isTest) {
      console.warn(`${tag} TEST EVENT received — stored without deduplication`);
    }

    // ── 4. Persist + enqueue in one transaction, THEN acknowledge ───────────
    // Senders do not retry after a 2xx, so a write deferred past the response
    // would be lost permanently on failure. 500 makes the sender retry, and the
    // (source, external_id) index absorbs the duplicate.
    //
    // Both statements commit together, so a parse job can never name a row that
    // is not there. The enqueue is gated on the insert: a redelivery of an event
    // already stored queues nothing, or every sender retry would double the work.
    //
    // Test events carry a null externalId (step 3), so each ping inserts and each
    // gets its own job — which is what makes the pipeline visible during setup.
    //
    // No filtering here: unknown event types are additive per both contracts and
    // must be tolerated, and Vision's `environment` field is stored as-is.
    // Production-only filtering happens at the parsing stage.
    //
    // ⚠️ Budget: UGC times out at 10s and Vision at 15s. The added cost is one
    // INSERT into pgboss.job inside a transaction we were already opening —
    // single-digit milliseconds against the same connection.
    try {
      const result = await ingestAndEnqueue({
        source: platform,
        payload: parsed, // complete envelope, verbatim
        externalId: isTest ? null : externalIdOf(parsed)
      });

      if (result.duplicate) {
        console.warn(`${tag} duplicate suppressed — no second job queued`);
      }
    } catch (err) {
      console.error(
        `${tag} ingest failed, returning 500 so the sender retries:`,
        err instanceof Error ? err.message : err
      );
      return new Response('Internal Server Error', { status: 500 });
    }

    return new Response(null, { status: 200 });
  };
}

/** Reachability check for humans and senders wiring the URL up. */
export function createInternalWebhookGet(platform: InternalPlatform) {
  return function GET(): Response {
    return Response.json(
      { ok: true, endpoint: `${platform}-webhook`, method: 'POST only' },
      { status: 200 }
    );
  };
}
