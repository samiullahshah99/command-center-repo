import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_TIMESTAMP_AGE_SECONDS,
  signSlackRequest,
  SLACK_SIGNATURE_HEADER,
  SLACK_TIMESTAMP_HEADER,
  verifySlackRequest
} from './verify';

const SECRET = 'test-signing-secret-8f3a2b';
const NOW = 1_700_000_000;

/** Signatures are computed the way Slack computes them, not hardcoded digests. */
function headersFor(rawBody: string, opts: { timestamp?: number; secret?: string } = {}) {
  const { signature, timestamp } = signSlackRequest({
    rawBody,
    timestamp: opts.timestamp ?? NOW,
    signingSecret: opts.secret ?? SECRET
  });
  return new Headers({
    [SLACK_SIGNATURE_HEADER]: signature,
    [SLACK_TIMESTAMP_HEADER]: timestamp
  });
}

describe('verifySlackRequest', () => {
  beforeEach(() => {
    // Set explicitly: vitest.config.ts does not load .env.local, so tests never
    // depend on a developer's local secrets.
    process.env.SLACK_SIGNING_SECRET = SECRET;
  });

  it('accepts a correctly signed request', () => {
    const body = '{"type":"event_callback","event_id":"Ev1"}';
    const res = verifySlackRequest({ rawBody: body, headers: headersFor(body), nowSeconds: NOW });
    expect(res.ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"type":"event_callback","event_id":"Ev1"}';
    const headers = headersFor(body);
    // One character changed after signing — exactly what an interception looks like.
    const tampered = '{"type":"event_callback","event_id":"Ev2"}';
    const res = verifySlackRequest({ rawBody: tampered, headers, nowSeconds: NOW });
    expect(res).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a body re-serialised from JSON (the classic mistake)', () => {
    // Slack signs the exact bytes. JSON.parse -> JSON.stringify preserves meaning
    // but changes whitespace, so the HMAC must fail. This is why the route uses
    // req.text() and never req.json() first.
    const raw = '{ "type": "event_callback", "event_id": "Ev1" }';
    const headers = headersFor(raw);
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect(reserialised).not.toBe(raw);
    expect(verifySlackRequest({ rawBody: reserialised, headers, nowSeconds: NOW }).ok).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const body = '{"a":1}';
    const headers = headersFor(body, { secret: 'wrong-secret' });
    expect(verifySlackRequest({ rawBody: body, headers, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'signature_mismatch'
    });
  });

  it('rejects a stale timestamp (replay)', () => {
    const body = '{"a":1}';
    const old = NOW - MAX_TIMESTAMP_AGE_SECONDS - 1;
    const headers = headersFor(body, { timestamp: old });
    expect(verifySlackRequest({ rawBody: body, headers, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'stale_timestamp'
    });
  });

  it('rejects a timestamp far in the future', () => {
    const body = '{"a":1}';
    const future = NOW + MAX_TIMESTAMP_AGE_SECONDS + 1;
    const headers = headersFor(body, { timestamp: future });
    expect(verifySlackRequest({ rawBody: body, headers, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'stale_timestamp'
    });
  });

  it('accepts a timestamp exactly at the age limit', () => {
    const body = '{"a":1}';
    const edge = NOW - MAX_TIMESTAMP_AGE_SECONDS;
    const headers = headersFor(body, { timestamp: edge });
    expect(verifySlackRequest({ rawBody: body, headers, nowSeconds: NOW }).ok).toBe(true);
  });

  it('rejects a missing signature header', () => {
    const headers = new Headers({ [SLACK_TIMESTAMP_HEADER]: String(NOW) });
    expect(verifySlackRequest({ rawBody: '{}', headers, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'missing_signature_header'
    });
  });

  it('rejects a missing timestamp header', () => {
    const headers = new Headers({ [SLACK_SIGNATURE_HEADER]: 'v0=deadbeef' });
    expect(verifySlackRequest({ rawBody: '{}', headers, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'missing_timestamp_header'
    });
  });

  it('rejects a malformed timestamp', () => {
    const headers = new Headers({
      [SLACK_SIGNATURE_HEADER]: 'v0=deadbeef',
      [SLACK_TIMESTAMP_HEADER]: 'not-a-number'
    });
    expect(verifySlackRequest({ rawBody: '{}', headers, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'malformed_timestamp'
    });
  });

  it('rejects when the signing secret is unset rather than crashing', () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const body = '{"a":1}';
    const headers = headersFor(body);
    expect(verifySlackRequest({ rawBody: body, headers, nowSeconds: NOW })).toEqual({
      ok: false,
      reason: 'missing_signing_secret'
    });
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on length mismatch; the implementation must guard.
    const headers = new Headers({
      [SLACK_SIGNATURE_HEADER]: 'v0=short',
      [SLACK_TIMESTAMP_HEADER]: String(NOW)
    });
    expect(() => verifySlackRequest({ rawBody: '{}', headers, nowSeconds: NOW })).not.toThrow();
    expect(verifySlackRequest({ rawBody: '{}', headers, nowSeconds: NOW }).ok).toBe(false);
  });
});
