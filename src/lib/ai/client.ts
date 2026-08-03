/**
 * The ONE module every LLM call goes through.
 *
 * ⚠️ No feature code may `fetch` a provider directly. One module means one place
 * for retries, timeouts, cost logging and a model change — and, critically, one
 * place that knows who the provider is. See ./provider.ts.
 *
 * Callers ask for a TIER ('fast' | 'default' | 'heavy'), never a vendor slug, so
 * moving from OpenRouter to a direct Anthropic key touches provider.ts alone.
 */

import type OpenAI from 'openai';
import {
  createProviderClient,
  estimateCostUsd,
  modelSlug,
  PROVIDER_NAME,
  type ModelTier
} from './provider';

export type { ModelTier };

export type CompleteInput = {
  /** Which capability tier this call needs. Defaults to 'default'. */
  tier?: ModelTier;
  system?: string;
  prompt: string;
  /** Deterministic by default — extraction should not vary run to run. */
  temperature?: number;
  maxTokens?: number;
  /** Ask the model for a JSON object. Pair with a Zod parse at the call site. */
  json?: boolean;
  /** Shows up in the cost log so spend can be attributed to a feature. */
  label?: string;
  signal?: AbortSignal;
};

export type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type CompleteResult = {
  text: string;
  tier: ModelTier;
  model: string;
  usage: Usage;
  latencyMs: number;
};

/**
 * Running total for the process, so a batch job can report what it spent.
 *
 * Deliberately in-memory and per-process: this is a visibility aid, not billing.
 * The provider's dashboard is the authority.
 */
const spend = { calls: 0, promptTokens: 0, completionTokens: 0, usd: 0 };

export function aiSpendSoFar(): Readonly<typeof spend> {
  return { ...spend };
}

export function resetAiSpend(): void {
  spend.calls = 0;
  spend.promptTokens = 0;
  spend.completionTokens = 0;
  spend.usd = 0;
}

/** Injectable so tests never reach the network. */
export type ProviderFactory = () => OpenAI;

/**
 * One completion.
 *
 * Usage is logged for EVERY call, including failures where the provider still
 * reports it — cost visibility from the first call was an explicit requirement,
 * and a job that quietly burns budget is exactly what that is meant to prevent.
 */
export async function complete(
  input: CompleteInput,
  makeClient: ProviderFactory = createProviderClient
): Promise<CompleteResult> {
  const tier = input.tier ?? 'default';
  const model = modelSlug(tier);
  const startedAt = Date.now();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (input.system) messages.push({ role: 'system', content: input.system });
  messages.push({ role: 'user', content: input.prompt });

  const client = makeClient();

  let res: OpenAI.Chat.Completions.ChatCompletion;
  try {
    res = await client.chat.completions.create(
      {
        model,
        messages,
        // 0 by default: extraction that varies between identical runs makes the
        // review queue's precision metric meaningless.
        temperature: input.temperature ?? 0,
        ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
        ...(input.json ? { response_format: { type: 'json_object' as const } } : {})
      },
      { signal: input.signal }
    );
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    console.error(
      `[ai:${PROVIDER_NAME}] ${input.label ?? 'call'} tier=${tier} model=${model} ` +
        `FAILED after ${latencyMs}ms: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }

  const latencyMs = Date.now() - startedAt;
  const promptTokens = res.usage?.prompt_tokens ?? 0;
  const completionTokens = res.usage?.completion_tokens ?? 0;
  const estimatedCostUsd = estimateCostUsd(tier, promptTokens, completionTokens);

  spend.calls += 1;
  spend.promptTokens += promptTokens;
  spend.completionTokens += completionTokens;
  spend.usd += estimatedCostUsd;

  // console.warn, not log: next.config.ts strips console.* in production except
  // error and warn, and production is exactly where spend needs watching.
  console.warn(
    `[ai:${PROVIDER_NAME}] ${input.label ?? 'call'} tier=${tier} model=${model} ` +
      `in=${promptTokens} out=${completionTokens} ` +
      `$${estimatedCostUsd.toFixed(5)} (run total $${spend.usd.toFixed(4)} over ${spend.calls} call${spend.calls === 1 ? '' : 's'}) ` +
      `${latencyMs}ms`
  );

  const text = res.choices[0]?.message?.content ?? '';

  return {
    text,
    tier,
    model,
    latencyMs,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUsd
    }
  };
}
