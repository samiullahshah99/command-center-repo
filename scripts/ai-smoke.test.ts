/**
 * The smoke script's failure classifier.
 *
 * Status codes and messages below are VERBATIM from the live OpenRouter API,
 * captured while building this — not guessed. The 402 branch is the exception:
 * it cannot be triggered against a funded account, which is exactly why it is
 * pinned here.
 */

import { describe, expect, it } from 'vitest';
import { explain } from './ai-smoke';

describe('explain', () => {
  it('⚠️ 401 "User not found." is an INVALID KEY, not a missing account', () => {
    // OpenRouter's real wording. Taken at face value it sends you to the
    // dashboard looking for a deleted account.
    const out = explain({ status: 401, message: 'User not found.' });
    expect(out).toContain('AUTH FAILURE');
    expect(out).toMatch(/does not\s+mean your account is missing/);
    expect(out).toContain('sk-or-v1-');
  });

  it('⚠️ 402 is CREDITS, and says so loudly — it reads like an auth error', () => {
    const out = explain({ status: 402, message: 'Insufficient credits' });
    expect(out).toContain('INSUFFICIENT CREDITS');
    expect(out).toMatch(/NOT an auth problem/);
    expect(out).toContain('openrouter.ai/credits');
  });

  it('classifies a credits failure from the message even without a 402', () => {
    // Providers are inconsistent about the status; the wording is the backstop.
    const out = explain({ status: 400, message: 'Insufficient credits for this request' });
    expect(out).toContain('INSUFFICIENT CREDITS');
  });

  it('⚠️ an unknown slug is a 400, NOT a 404', () => {
    const out = explain({
      status: 400,
      message: 'anthropic/claude-does-not-exist-9 is not a valid model ID'
    });
    expect(out).toContain('UNKNOWN MODEL SLUG');
    expect(out).toContain('provider.ts');
  });

  it('a missing key is distinct from a wrong key', () => {
    // Different fix: set the variable vs. replace its value.
    const out = explain(new Error('OPENROUTER_API_KEY is not set'));
    expect(out).toContain('NO API KEY');
    expect(out).not.toContain('AUTH FAILURE');
  });

  it('429 and 5xx are named as transient, not configuration', () => {
    expect(explain({ status: 429, message: 'rate limited' })).toContain('RATE LIMITED');
    expect(explain({ status: 503, message: 'upstream' })).toContain('PROVIDER ERROR');
  });

  it('an unclassified error says so rather than pretending to know', () => {
    const out = explain({ status: 418, message: 'teapot' });
    expect(out).toContain('UNEXPECTED FAILURE');
    expect(out).toContain('teapot');
  });
});
