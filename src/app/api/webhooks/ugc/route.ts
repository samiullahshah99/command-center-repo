/**
 * UGC platform webhook.
 *
 * ⚠️ Contract owned by the BACKEND ENGINEER — see docs/webhook-contract.md.
 * Their implementation is live and stable; conform to it, do not change it.
 *
 *   header     X-LuckyFours-Signature   (sha256= prefix)
 *   timestamp  X-LuckyFours-Timestamp   (unix seconds)
 *   basestring {timestamp}.{rawBody}    ← literal DOT, not a colon
 *   replay     ±300s, Math.abs          ✅ enforced
 *   sender timeout budget               10s
 *
 * Publicly reachable by design — src/proxy.ts protects /dashboard(.*) only.
 */

import {
  createInternalWebhookGet,
  createInternalWebhookHandler
} from '@/features/connectors/internal/handler';

// Never cached, and must run on Node (the HMAC uses node:crypto).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = createInternalWebhookHandler('ugc');
export const GET = createInternalWebhookGet('ugc');
