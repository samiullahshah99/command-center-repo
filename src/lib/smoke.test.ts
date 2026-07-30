/**
 * Setup smoke test.
 *
 * Proves three things about the Vitest wiring before Day 3 relies on it:
 *   1. Vitest discovers and runs tests
 *   2. TypeScript compiles under the test runner
 *   3. The "@/*" path alias resolves the same way it does in the app
 *
 * Delete or replace this once real tests exist.
 */

import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('vitest setup', () => {
  it('runs tests', () => {
    expect(true).toBe(true);
  });

  it('typechecks under the runner', () => {
    const n: number = 2 + 2;
    expect(n).toBe(4);
  });

  it('resolves the @/* path alias', () => {
    // cn() is imported via the alias — if resolution were broken this file
    // would fail to load rather than fail an assertion.
    expect(typeof cn).toBe('function');
    // undefined rather than `false && 'b'`: the latter is a constant expression
    // and oxlint rejects it (no-constant-binary-expression).
    expect(cn('a', undefined, 'c')).toBe('a c');
  });
});
