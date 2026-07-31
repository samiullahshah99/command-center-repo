/**
 * Studio webhook — studio stats.
 *
 * The contract is OURS, not the platform's: see docs/webhook-contract.md, which
 * is the document sent to the platform owner. Implementation is shared with
 * Portal in src/features/connectors/internal/, since both speak the same
 * contract and differ only in secret and stored `source`.
 *
 * Note: the Studio API client is NOT built — those endpoints do not exist yet.
 * This is the inbound half only. See src/features/connectors/studio/client.ts
 * for the typed interface and its NotImplemented stub.
 *
 * Publicly reachable by design — src/proxy.ts protects /dashboard(.*) only.
 */

import {
  createInternalWebhookGet,
  createInternalWebhookHandler
} from '@/features/connectors/internal/handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = createInternalWebhookHandler('studio');
export const GET = createInternalWebhookGet('studio');
