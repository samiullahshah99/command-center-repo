/**
 * The AI client's contract: tiers in, pinned slugs and cost logging out.
 *
 * No network — the provider client is injected. What is under test is OUR
 * behaviour: that callers never see a vendor slug, that usage is logged on
 * every call, and that the key check fires before any request.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { complete, aiSpendSoFar, resetAiSpend } from './client';
import { createProviderClient, modelSlug, estimateCostUsd } from './provider';

function fakeProvider(usage = { prompt_tokens: 1000, completion_tokens: 500 }) {
  const calls: { model: string; temperature: number; messages: unknown[] }[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: { model: string; temperature: number; messages: unknown[] }) => {
          calls.push(params);
          return { choices: [{ message: { content: 'ok' } }], usage };
        }
      }
    }
  };
  return { client: client as never, calls };
}

const costPerMillionIn = (t: 'fast' | 'default' | 'heavy') => estimateCostUsd(t, 1_000_000, 0);

describe('model pinning', () => {
  it('⚠️ every tier resolves to an EXACT version, never a floating alias', () => {
    // A `:latest` slug is re-pointed by the provider, changing prompt behaviour
    // with no code change and no commit to bisect.
    for (const tier of ['fast', 'default', 'heavy'] as const) {
      const slug = modelSlug(tier);
      expect(slug).not.toMatch(/latest/i);
      expect(slug).toMatch(/^anthropic\/claude-(haiku|sonnet|opus)-[\d.]+$/);
    }
  });

  it('the three tiers are distinct models', () => {
    const slugs = (['fast', 'default', 'heavy'] as const).map(modelSlug);
    expect(new Set(slugs).size).toBe(3);
  });

  it('prices rise with tier', () => {
    expect(costPerMillionIn('fast')).toBeLessThan(costPerMillionIn('default'));
    expect(costPerMillionIn('default')).toBeLessThan(costPerMillionIn('heavy'));
  });
});

describe('complete', () => {
  beforeEach(() => {
    resetAiSpend();
    vi.spyOn(console, 'warn')
      .mockImplementation(() => {})
      .mockClear();
    vi.spyOn(console, 'error')
      .mockImplementation(() => {})
      .mockClear();
  });

  it('maps a tier to its slug — callers never pass a vendor string', async () => {
    const { client, calls } = fakeProvider();
    await complete({ prompt: 'hi', tier: 'fast' }, () => client);
    expect(calls[0].model).toBe(modelSlug('fast'));
  });

  it('defaults to the `default` tier', async () => {
    const { client, calls } = fakeProvider();
    await complete({ prompt: 'hi' }, () => client);
    expect(calls[0].model).toBe(modelSlug('default'));
  });

  it('⚠️ defaults to temperature 0 — varying extraction breaks the precision metric', async () => {
    const { client, calls } = fakeProvider();
    await complete({ prompt: 'hi' }, () => client);
    expect(calls[0].temperature).toBe(0);
  });

  it('reports usage and an estimated cost', async () => {
    const { client } = fakeProvider({ prompt_tokens: 1_000_000, completion_tokens: 0 });
    const r = await complete({ prompt: 'hi', tier: 'default' }, () => client);
    expect(r.usage.promptTokens).toBe(1_000_000);
    // default is $2/M in.
    expect(r.usage.estimatedCostUsd).toBeCloseTo(2, 5);
  });

  it('logs cost on EVERY call — visibility was required from the first one', async () => {
    const { client } = fakeProvider();
    await complete({ prompt: 'hi', label: 'extract' }, () => client);
    const out = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(out).toContain('extract');
    expect(out).toContain('in=1000');
    expect(out).toContain('out=500');
    expect(out).toMatch(/\$\d/);
  });

  it('accumulates spend across calls so a batch job can report its total', async () => {
    const { client } = fakeProvider();
    await complete({ prompt: 'a' }, () => client);
    await complete({ prompt: 'b' }, () => client);
    expect(aiSpendSoFar().calls).toBe(2);
    expect(aiSpendSoFar().usd).toBeGreaterThan(0);
  });

  it('logs a failure with its latency rather than swallowing it', async () => {
    const client = {
      chat: {
        completions: {
          create: async () => {
            throw new Error('upstream 503');
          }
        }
      }
    } as never;
    await expect(complete({ prompt: 'hi' }, () => client)).rejects.toThrow(/upstream 503/);
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('FAILED');
  });
});

describe('createProviderClient', () => {
  it('⚠️ throws on a missing key rather than sending an empty Authorization header', () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    // An empty header returns the same 401 as a revoked key — far harder to place.
    expect(() => createProviderClient()).toThrow(/OPENROUTER_API_KEY/);
    if (saved) process.env.OPENROUTER_API_KEY = saved;
  });

  it('is a FUNCTION, so importing this module costs nothing at build time', () => {
    // A module-level constant would read the env var during `next build`, where
    // it does not exist. That mistake broke the Docker build once already.
    expect(typeof createProviderClient).toBe('function');
  });
});
