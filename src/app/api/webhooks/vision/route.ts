/**
 * Vision platform webhook.
 *
 * ⚠️ Contract owned by the BACKEND ENGINEER — see docs/webhook-contract.md.
 * Their implementation is live and stable; conform to it, do not change it.
 *
 *   header     X-Vision-Signature  (sha256= prefix)
 *   delivery   X-Vision-Delivery
 *   event      X-Vision-Event
 *   basestring rawBody only
 *   sender timeout budget          15s
 *
 * ⚠️⚠️ NO REPLAY PROTECTION EXISTS ON THIS ENDPOINT.
 *
 * Vision sends no timestamp, so there is nothing to bound replay with: a
 * captured request stays valid forever and can be replayed verbatim by anyone
 * who obtains it. IDEMPOTENCY ON payload.id IS THE ONLY DEFENCE. Do not add
 * side effects to this path that are unsafe to repeat.
 *
 * Publicly reachable by design — src/proxy.ts protects /dashboard(.*) only.
 */

import {
  createInternalWebhookGet,
  createInternalWebhookHandler
} from '@/features/connectors/internal/handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = createInternalWebhookHandler('vision');
export const GET = createInternalWebhookGet('vision');
