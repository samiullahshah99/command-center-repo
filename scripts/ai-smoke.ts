/**
 * Is the LLM provider reachable, funded, and answering?
 *
 *   pnpm ai:smoke [--tier=fast|default|heavy] [--prompt="..."] [--no-preflight]
 *
 * Sends one trivial prompt through src/lib/ai/client.ts — the same path feature
 * code uses, so a green run means the real thing works, not that a parallel
 * implementation does. Costs a fraction of a cent.
 *
 * ── Why the failure handling is the point ───────────────────────────────────
 * OpenRouter's failures are actively misleading. Measured against the live API:
 *
 *   invalid key    401  "User not found."        ← sounds like a missing ACCOUNT
 *   no credits     402  "Insufficient credits"   ← easily read as an auth problem
 *   unknown slug   400  "… is not a valid model ID"  ← 400, NOT 404
 *
 * "User not found." in particular sends you looking at the wrong thing. So this
 * script checks the credit balance BEFORE calling, and classifies every failure
 * afterwards, rather than printing a status code and leaving you to guess.
 */

import { loadEnvLocal } from './clickup/shared';

loadEnvLocal();

const PREFLIGHT_URL = 'https://openrouter.ai/api/v1/key';

type KeyStatus = {
  limit: number | null;
  limitRemaining: number | null;
  usage: number;
  isFreeTier: boolean;
};

/**
 * Ask OpenRouter what this key can still spend.
 *
 * ⚠️ PROVIDER-SPECIFIC, and deliberately the only such thing in this file. It is
 * skipped automatically when PROVIDER_NAME is not 'openrouter', so swapping to a
 * direct Anthropic key degrades this to "no preflight" instead of breaking the
 * script.
 */
async function preflight(): Promise<
  { ok: true; status: KeyStatus } | { ok: false; httpStatus: number; message: string }
> {
  const res = await fetch(PREFLIGHT_URL, {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ''}` }
  });

  const body = (await res.json().catch(() => null)) as {
    data?: {
      limit?: number | null;
      limit_remaining?: number | null;
      usage?: number;
      is_free_tier?: boolean;
    };
    error?: { message?: string };
  } | null;

  if (!res.ok) {
    return {
      ok: false,
      httpStatus: res.status,
      message: body?.error?.message ?? `HTTP ${res.status}`
    };
  }

  return {
    ok: true,
    status: {
      limit: body?.data?.limit ?? null,
      limitRemaining: body?.data?.limit_remaining ?? null,
      usage: body?.data?.usage ?? 0,
      isFreeTier: Boolean(body?.data?.is_free_tier)
    }
  };
}

/**
 * Turn a provider error into something with a next action.
 *
 * Exported so the classification is unit-tested. The 402 branch in particular
 * cannot be triggered on demand against a funded account, and it is the branch
 * most likely to be needed in anger.
 */
export function explain(err: unknown): string {
  const e = err as { status?: number; message?: string; error?: { message?: string } };
  const status = e?.status;
  const message = e?.error?.message ?? e?.message ?? String(err);

  // Missing key never reaches the network — createProviderClient throws first.
  if (/OPENROUTER_API_KEY is not set/.test(message)) {
    return [
      '❌ NO API KEY',
      '',
      '   OPENROUTER_API_KEY is not set, so no request was made.',
      '   Add it to .env.local. It is server-side only — never prefix it',
      '   NEXT_PUBLIC_, which would inline it into the client bundle.'
    ].join('\n');
  }

  if (status === 401) {
    return [
      '❌ AUTH FAILURE (401)',
      '',
      `   Provider said: "${message}"`,
      '',
      '   ⚠️ OpenRouter says "User not found." for an INVALID KEY. It does not',
      '      mean your account is missing. It almost always means the key is',
      '      wrong, revoked, or truncated when it was copied.',
      '',
      '   Check: the key in .env.local starts sk-or-v1- and is complete.',
      '   Rotate at openrouter.ai/keys if in doubt.'
    ].join('\n');
  }

  if (status === 402 || /insufficient credit|quota|balance/i.test(message)) {
    return [
      '❌ INSUFFICIENT CREDITS (402)',
      '',
      `   Provider said: "${message}"`,
      '',
      '   ⚠️ This is NOT an auth problem, though it reads like one. The key is',
      '      valid; the balance is spent.',
      '',
      '   Top up at openrouter.ai/credits, then re-run.',
      '   The preflight above prints the remaining balance — if it showed ~0,',
      '   this is the cause.'
    ].join('\n');
  }

  if (status === 400 && /not a valid model|no endpoints found|model/i.test(message)) {
    return [
      '❌ UNKNOWN MODEL SLUG (400)',
      '',
      `   Provider said: "${message}"`,
      '',
      '   ⚠️ Note this is a 400, not a 404 — easy to misread as a malformed',
      '      request body.',
      '',
      '   The slug is pinned in src/lib/ai/provider.ts (MODEL_SLUGS). Slugs move.',
      '   List the current catalogue with:',
      '     curl -s https://openrouter.ai/api/v1/models | jq -r \'.data[].id\' | grep anthropic'
    ].join('\n');
  }

  if (status === 429) {
    return [
      '❌ RATE LIMITED (429)',
      '',
      `   Provider said: "${message}"`,
      '   Wait and re-run. Not a configuration problem.'
    ].join('\n');
  }

  if (typeof status === 'number' && status >= 500) {
    return [
      `❌ PROVIDER ERROR (${status})`,
      '',
      `   Provider said: "${message}"`,
      '   Upstream fault, not ours. Check status.openrouter.ai and retry.'
    ].join('\n');
  }

  return [
    `❌ UNEXPECTED FAILURE${status ? ` (${status})` : ''}`,
    '',
    `   ${message}`,
    '',
    '   Not one of the classified cases. If this recurs, add it to explain()',
    '   in this script so the next person does not have to work it out.'
  ].join('\n');
}

const money = (n: number) => `$${n.toFixed(n < 0.01 ? 6 : 4)}`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const tierArg = args.find((a) => a.startsWith('--tier='))?.slice('--tier='.length);
  const promptArg = args.find((a) => a.startsWith('--prompt='))?.slice('--prompt='.length);
  const skipPreflight = args.includes('--no-preflight');

  const { complete } = await import('../src/lib/ai/client');
  const { MODEL_TIERS, modelSlug, PROVIDER_NAME } = await import('../src/lib/ai/provider');

  const tier = (tierArg ?? 'fast') as (typeof MODEL_TIERS)[number];
  if (!MODEL_TIERS.includes(tier)) {
    console.error(`\n  ❌ Unknown tier "${tierArg}". Known: ${MODEL_TIERS.join(', ')}\n`);
    return 1;
  }

  console.log(`\n  provider   ${PROVIDER_NAME}`);
  console.log(`  tier       ${tier}`);
  console.log(`  model      ${modelSlug(tier)}`);

  // ⚠️ Checked BEFORE the preflight, not left to it.
  //
  // With no key, the preflight sends `Bearer ` and OpenRouter answers 401
  // "Missing Authentication header" — which this script would then classify as
  // an auth failure and advise checking whether the key was truncated. That is
  // the wrong fix for a key that was never set, so the two cases are separated
  // here rather than after the fact.
  if (PROVIDER_NAME === 'openrouter' && !process.env.OPENROUTER_API_KEY?.trim()) {
    console.error(`\n${explain(new Error('OPENROUTER_API_KEY is not set'))}\n`);
    return 1;
  }

  // ── Preflight ─────────────────────────────────────────────────────────────
  if (!skipPreflight && PROVIDER_NAME === 'openrouter') {
    const pf = await preflight();

    if (!pf.ok) {
      console.error(`\n${explain({ status: pf.httpStatus, message: pf.message })}\n`);
      return 1;
    }

    const { limit, limitRemaining, usage, isFreeTier } = pf.status;
    console.log(
      `  credits    ${limitRemaining === null ? 'unlimited' : money(limitRemaining)} remaining` +
        (limit === null ? '' : ` of ${money(limit)}`) +
        ` · ${money(usage)} used${isFreeTier ? ' · FREE TIER' : ''}`
    );

    // Fail before spending a request on a call that cannot succeed — this is the
    // whole reason the preflight exists.
    if (limitRemaining !== null && limitRemaining <= 0) {
      console.error(`
  ❌ NO CREDIT REMAINING

     The key is valid but the balance is spent. The chat request below would
     fail with a 402 that reads like an auth error, so it is not attempted.

     Top up at openrouter.ai/credits.
`);
      return 1;
    }
  } else if (!skipPreflight) {
    console.log(`  credits    (no preflight — not implemented for ${PROVIDER_NAME})`);
  }

  // ── The actual call ───────────────────────────────────────────────────────
  const prompt = promptArg ?? 'Reply with exactly: OK';
  console.log(`  prompt     ${JSON.stringify(prompt)}\n`);

  try {
    const result = await complete({
      tier,
      prompt,
      maxTokens: 32,
      label: 'ai:smoke'
    });

    console.log('  ── response ──');
    console.log(`     ${result.text.trim() || '(empty)'}\n`);
    console.log('  ── usage ──');
    console.log(`     prompt      ${result.usage.promptTokens} tokens`);
    console.log(`     completion  ${result.usage.completionTokens} tokens`);
    console.log(`     total       ${result.usage.totalTokens} tokens`);
    console.log(`     cost        ${money(result.usage.estimatedCostUsd)} (estimated)`);
    console.log(`     latency     ${result.latencyMs}ms`);
    console.log(`\n  ✅ ${PROVIDER_NAME} reachable and answering.\n`);
    return 0;
  } catch (err) {
    console.error(`\n${explain(err)}\n`);
    return 1;
  }
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(`\n${explain(err)}\n`);
    process.exit(1);
  });
