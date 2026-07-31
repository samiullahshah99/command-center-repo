/**
 * Internal Portal webhook — activity signals (PRD §5.2).
 *
 * The contract is OURS, not the platform's: see docs/webhook-contract.md, which
 * is the document sent to the platform owner. Implementation is shared with
 * Studio in src/features/connectors/internal/, since both speak the same
 * contract and differ only in secret and stored `source`.
 *
 * Publicly reachable by design — src/proxy.ts protects /dashboard(.*) only, and
 * senders post with no session. Authentication is the X-CC-Signature HMAC.
 */

import {
  createInternalWebhookGet,
  createInternalWebhookHandler
} from '@/features/connectors/internal/handler';

// Never cached, and must run on Node (the HMAC uses node:crypto).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = createInternalWebhookHandler('portal');
export const GET = createInternalWebhookGet('portal');
