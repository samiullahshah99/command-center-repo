/**
 * THE ONLY FILE THAT KNOWS WHICH LLM PROVIDER IS BEHIND THE CLIENT.
 *
 * ⚠️ There is an open question about moving from OpenRouter to a direct
 * Anthropic key. Everything provider-specific is deliberately confined here —
 * base URL, auth, attribution headers, the tier→slug map, and pricing — so that
 * swap is an edit to this file and nothing else. `client.ts` and every caller
 * speak in TIERS ('fast' | 'default' | 'heavy') and never see a vendor string.
 *
 * To swap to the Anthropic API directly:
 *   1. change baseURL / apiKey / headers in createProviderClient()
 *   2. change MODEL_SLUGS to the Anthropic model ids
 *   3. re-check PRICING
 * No other file changes.
 */

import OpenAI from 'openai';

export type ModelTier = 'fast' | 'default' | 'heavy';

export const MODEL_TIERS = ['fast', 'default', 'heavy'] as const;

/**
 * ⚠️ EXACT VERSIONS, NEVER A FLOATING ALIAS.
 *
 * Not `:latest`, not an undated name. Providers re-point those, and a model
 * swapped underneath us changes prompt behaviour with no code change and no
 * commit to bisect — extraction quality drifts and Day 4's precision metric
 * moves for reasons nothing in the repo records.
 *
 * Verified against the live OpenRouter catalogue. Slugs move; re-check with
 * `curl -s https://openrouter.ai/api/v1/models` before pinning new ones.
 */
const MODEL_SLUGS: Record<ModelTier, string> = {
  /** High-volume, short, structured work. */
  fast: 'anthropic/claude-haiku-4.5',
  /** The workhorse — action-item extraction from a transcript. */
  default: 'anthropic/claude-sonnet-5',
  /** Genuinely hard reasoning only: 2.5× the input cost of default. */
  heavy: 'anthropic/claude-opus-5'
};

/** $/M tokens, for the cost line every call logs. */
const PRICING: Record<ModelTier, { in: number; out: number }> = {
  fast: { in: 1.0, out: 5.0 },
  default: { in: 2.0, out: 10.0 },
  heavy: { in: 5.0, out: 25.0 }
};

export function modelSlug(tier: ModelTier): string {
  return MODEL_SLUGS[tier];
}

export function estimateCostUsd(tier: ModelTier, promptTokens: number, completionTokens: number) {
  const p = PRICING[tier];
  return (promptTokens / 1_000_000) * p.in + (completionTokens / 1_000_000) * p.out;
}

/**
 * Build the SDK client.
 *
 * ⚠️ A FUNCTION, not a module-level constant — the same rule as
 * src/config/env.ts and src/db/index.ts. A constant is evaluated at import time,
 * which during `next build` means reading an env var that is not there. That
 * exact mistake broke the Docker build once: `next build` imports every route to
 * collect page data, and any route transitively importing this file would have
 * demanded OPENROUTER_API_KEY at build time.
 *
 * Throws on a missing key rather than sending an empty Authorization header,
 * which returns the same 401 as a revoked key and is far harder to diagnose.
 */
export function createProviderClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set — refusing to send an empty Authorization header. ' +
        'It is server-side only; never prefix it NEXT_PUBLIC_, which would inline it into the client bundle.'
    );
  }

  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    defaultHeaders: {
      // OpenRouter attribution. Optional for them, useful for us: it is how
      // spend is attributed to this app on their dashboard.
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
      'X-Title': 'Command Center'
    }
  });
}

/** Named so a log line says which provider produced a cost, after a swap. */
export const PROVIDER_NAME = 'openrouter';
