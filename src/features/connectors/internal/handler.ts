/**
 * Shared webhook handler for our internal platforms.
 *
 * Portal and Studio speak the SAME contract (docs/webhook-contract.md), so both
 * routes are one line each: `createInternalWebhookHandler('portal' | 'studio')`.
 * They differ only in which secret verifies them and which `source` is stored.
 *
 * Follows the pattern in CLAUDE.md:
 *   raw body once -> verify -> persist BEFORE responding -> 200.
 */

import { ingestRawEvent } from '../ingest';
import { verifyTimestampedHmac } from '../verify-hmac';
import {
  CC_SIGNATURE_HEADER,
  CC_SIGNATURE_PREFIX,
  CC_TIMESTAMP_HEADER,
  externalIdOf,
  SECRET_ENV_VAR,
  type InternalPlatform
} from './contract';

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
    const verified = verifyTimestampedHmac({
      rawBody,
      headers: req.headers,
      secret: process.env[secretVar],
      config: {
        signatureHeader: CC_SIGNATURE_HEADER,
        timestampHeader: CC_TIMESTAMP_HEADER,
        signaturePrefix: CC_SIGNATURE_PREFIX
      }
    });

    if (!verified.ok) {
      // Reason only. Never the secret, the signature, or the body.
      console.warn(`${tag} rejected: ${verified.reason}`);
      return new Response('Unauthorized', { status: 401 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      // Signature was valid, so this really is our platform sending malformed
      // JSON — worth surfacing rather than storing an unparseable blob.
      console.warn(`${tag} rejected: malformed_json`);
      return new Response('Bad Request', { status: 400 });
    }

    // ── 3. Persist, THEN acknowledge ────────────────────────────────────────
    // Senders do not retry after a 200, so a write deferred past the response
    // would be lost permanently on failure. 500 here makes the sender retry, and
    // the (source, external_id) index absorbs the duplicate.
    try {
      const result = await ingestRawEvent({
        source: platform,
        payload: parsed, // verbatim, unmodified
        externalId: externalIdOf(parsed)
      });

      if (result.duplicate) {
        console.warn(`${tag} duplicate suppressed`);
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

/**
 * Reachability check. Senders and humans both GET the URL to confirm it exists
 * before wiring it up.
 */
export function createInternalWebhookGet(platform: InternalPlatform) {
  return function GET(): Response {
    return Response.json(
      { ok: true, endpoint: `${platform}-webhook`, method: 'POST only' },
      { status: 200 }
    );
  };
}
