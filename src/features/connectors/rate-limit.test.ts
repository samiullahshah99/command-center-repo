/**
 * Rate-limit headroom logging.
 *
 * Header values below are copied from real responses:
 *   ClickUp /team  → x-ratelimit-limit: 100, -remaining: 99, -reset: <epoch s>
 *   Slack auth.test → NO quota headers at all, but x-oauth-scopes is present
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  noteClickUpResponse,
  noteSlackResponse,
  slackGrantedScopes,
  warnIfScopeMissing
} from './rate-limit';

function res(headers: Record<string, string>, status = 200) {
  return new Response(null, { status, headers });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('noteClickUpResponse', () => {
  beforeEach(() => {
    // mockClear matters: vi.spyOn keeps ONE spy per file, so without it the
    // not.toHaveBeenCalled() assertions below read earlier tests' calls.
    vi.spyOn(console, 'warn')
      .mockImplementation(() => {})
      .mockClear();
  });

  it('reads limit, remaining and reset from the real header names', () => {
    const snap = noteClickUpResponse(
      res({
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': String(nowSeconds() + 60)
      }),
      'GET /team'
    );

    expect(snap).toMatchObject({ provider: 'clickup', limit: 100, remaining: 99, low: false });
    expect(snap.resetInSeconds).toBeGreaterThan(55);
    expect(snap.resetInSeconds).toBeLessThanOrEqual(60);
  });

  it('⚠️ treats x-ratelimit-reset as epoch SECONDS, not millis', () => {
    // Read as millis, a seconds value lands in 1970 and the countdown goes
    // hugely negative — the same trap the normaliser's time parsing documents.
    const snap = noteClickUpResponse(
      res({ 'x-ratelimit-remaining': '50', 'x-ratelimit-reset': String(nowSeconds() + 30) }),
      'GET /team'
    );
    expect(snap.resetInSeconds).toBeGreaterThanOrEqual(0);
    expect(snap.resetInSeconds).toBeLessThan(60);
  });

  it('flags LOW headroom below the fraction threshold', () => {
    const snap = noteClickUpResponse(
      res({ 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '15' }),
      'GET /team'
    );
    expect(snap.low).toBe(true);
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain('LOW HEADROOM');
  });

  it('flags LOW headroom on the absolute floor even when the limit is large', () => {
    // 5/1000 is 0.5% — under the floor but nowhere near the fraction, so the
    // fraction check alone would miss a token about to be cut off.
    const snap = noteClickUpResponse(
      res({ 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '5' }),
      'GET /team'
    );
    expect(snap.low).toBe(true);
  });

  it('does not flag healthy headroom', () => {
    expect(
      noteClickUpResponse(
        res({ 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '99' }),
        'GET /team'
      ).low
    ).toBe(false);
  });

  it('⚠️ warns when the headers vanish — headroom would otherwise go blind', () => {
    const snap = noteClickUpResponse(res({}), 'GET /team');
    expect(snap.remaining).toBeNull();
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain(
      'no x-ratelimit-remaining'
    );
  });
});

describe('noteSlackResponse', () => {
  beforeEach(() => {
    // mockClear matters: vi.spyOn keeps ONE spy per file, so without it the
    // not.toHaveBeenCalled() assertions below read earlier tests' calls.
    vi.spyOn(console, 'warn')
      .mockImplementation(() => {})
      .mockClear();
  });

  it('⚠️ reports NULL headroom — Slack sends no quota headers at all', () => {
    // Measured against the live workspace: auth.test returns nothing
    // rate-limit related. Reporting 0 would imply exhaustion; null says unknown.
    const snap = noteSlackResponse(res({ 'x-oauth-scopes': 'users:read' }), 'users.list');
    expect(snap).toMatchObject({ provider: 'slack', limit: null, remaining: null, low: false });
  });

  it('captures Retry-After on a 429 — the only quota signal Slack gives', () => {
    const snap = noteSlackResponse(res({ 'retry-after': '30' }, 429), 'users.list');
    expect(snap).toMatchObject({ low: true, resetInSeconds: 30 });
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain('RATE LIMITED');
  });
});

describe('slack scope detection', () => {
  beforeEach(() => {
    // mockClear matters: vi.spyOn keeps ONE spy per file, so without it the
    // not.toHaveBeenCalled() assertions below read earlier tests' calls.
    vi.spyOn(console, 'warn')
      .mockImplementation(() => {})
      .mockClear();
  });

  it('parses x-oauth-scopes', () => {
    // Verbatim from the live token.
    const scopes = slackGrantedScopes(
      res({
        'x-oauth-scopes':
          'channels:history,chat:write,channels:read,groups:read,groups:history,users:read,app_mentions:read'
      })
    );
    expect(scopes).toContain('users:read');
    expect(scopes).not.toContain('users:read.email');
  });

  it('⚠️ says nothing when the header is absent — cannot tell, so do not cry wolf', () => {
    warnIfScopeMissing(res({}), 'some:scope', 'consequence');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('warns once, naming the scope, consequence and the reinstall requirement', () => {
    warnIfScopeMissing(
      res({ 'x-oauth-scopes': 'users:read' }),
      'users:read.email',
      'No automatic resolution.'
    );
    const out = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(out).toContain('users:read.email');
    expect(out).toContain('No automatic resolution.');
    expect(out).toMatch(/REINSTALL/i);

    // Second call for the SAME scope stays quiet: this runs on every API call,
    // and repeating it would bury everything else in the log.
    vi.mocked(console.warn).mockClear();
    warnIfScopeMissing(res({ 'x-oauth-scopes': 'users:read' }), 'users:read.email', 'x');
    expect(console.warn).not.toHaveBeenCalled();
  });
});
