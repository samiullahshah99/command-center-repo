import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FIREFLIES_SIGNATURE_HEADER,
  FIREFLIES_SIGNATURE_PREFIX,
  externalIdOf,
  signFirefliesRequest,
  verifyFirefliesRequest
} from './index';
import {
  FirefliesApiError,
  FirefliesGraphQLError,
  FirefliesSchemaError,
  getTranscript,
  getTranscripts
} from './client';

const SECRET = 'fireflies-test-secret-16chars';
const API_KEY = 'ff_test_key_not_real';

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', 'fireflies', name), 'utf8');
}
const json = (name: string) => JSON.parse(fixture(name));

function mockFetch(
  responses: { status?: number; body?: unknown; headers?: Record<string, string> }[]
) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...r.headers }
    });
  }) as unknown as typeof fetch;
  return { impl, calls, count: () => i };
}

const noSleep = async () => {};

// ── Webhook verification ────────────────────────────────────────────────────

describe('fireflies webhook verification', () => {
  beforeEach(() => {
    process.env.FIREFLIES_WEBHOOK_SECRET = SECRET;
  });

  function headersFor(rawBody: string, opts: { secret?: string; header?: string } = {}) {
    return new Headers({
      [opts.header ?? FIREFLIES_SIGNATURE_HEADER]: signFirefliesRequest({
        rawBody,
        secret: opts.secret ?? SECRET
      })
    });
  }

  it('accepts a validly signed webhook', () => {
    const raw = fixture('webhook-transcription-completed.json');
    expect(verifyFirefliesRequest({ rawBody: raw, headers: headersFor(raw) }).ok).toBe(true);
  });

  it('uses x-hub-signature WITHOUT the -256 suffix', () => {
    // GitHub's convention is x-hub-signature-256; Fireflies drops the suffix.
    // Reading the wrong header means every request 401s as "missing signature".
    const raw = fixture('webhook-transcription-completed.json');
    const wrongHeader = headersFor(raw, { header: 'x-hub-signature-256' });
    expect(verifyFirefliesRequest({ rawBody: raw, headers: wrongHeader })).toEqual({
      ok: false,
      reason: 'missing_signature_header'
    });
  });

  it('requires the sha256= prefix', () => {
    const raw = fixture('webhook-transcription-completed.json');
    const bare = signFirefliesRequest({ rawBody: raw, secret: SECRET }).replace(
      FIREFLIES_SIGNATURE_PREFIX,
      ''
    );
    const headers = new Headers({ [FIREFLIES_SIGNATURE_HEADER]: bare });
    expect(verifyFirefliesRequest({ rawBody: raw, headers }).ok).toBe(false);
  });

  it('rejects a tampered body', () => {
    const raw = fixture('webhook-transcription-completed.json');
    const headers = headersFor(raw);
    const tampered = raw.replace('"meetingId"', '"TAMPERED"');
    expect(tampered).not.toBe(raw);
    expect(verifyFirefliesRequest({ rawBody: tampered, headers }).ok).toBe(false);
  });

  it('rejects a re-serialised body', () => {
    const raw = fixture('webhook-transcription-completed.json');
    const headers = headersFor(raw);
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect(reserialised).not.toBe(raw);
    expect(verifyFirefliesRequest({ rawBody: reserialised, headers }).ok).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const raw = fixture('webhook-transcription-completed.json');
    expect(
      verifyFirefliesRequest({ rawBody: raw, headers: headersFor(raw, { secret: 'nope' }) }).ok
    ).toBe(false);
  });

  it('rejects when FIREFLIES_WEBHOOK_SECRET is unset', () => {
    // Currently blank in .env.local until the webhook is registered.
    delete process.env.FIREFLIES_WEBHOOK_SECRET;
    const raw = fixture('webhook-transcription-completed.json');
    expect(verifyFirefliesRequest({ rawBody: raw, headers: headersFor(raw) })).toEqual({
      ok: false,
      reason: 'missing_secret'
    });
  });
});

// ── Idempotency key ─────────────────────────────────────────────────────────

describe('externalIdOf', () => {
  it('uses meetingId', () => {
    expect(externalIdOf(json('webhook-transcription-completed.json'))).toBe(
      '01JQFF1TESTMEETING000001'
    );
  });

  it('the retry fixture shares the same meetingId', () => {
    expect(externalIdOf(json('webhook-retry-duplicate.json'))).toBe(
      externalIdOf(json('webhook-transcription-completed.json'))
    );
  });

  it('works for an unknown eventType — types are additive', () => {
    expect(externalIdOf(json('webhook-unknown-event.json'))).toBe('01JQFF2TESTMEETING000002');
  });

  it('returns null for an off-contract payload rather than throwing', () => {
    expect(externalIdOf(json('webhook-off-contract.json'))).toBeNull();
  });
});

// ── GraphQL client ──────────────────────────────────────────────────────────

describe('fireflies GraphQL client', () => {
  beforeEach(() => {
    process.env.FIREFLIES_API_KEY = API_KEY;
  });

  it('sends Bearer auth and a POST to the GraphQL endpoint', async () => {
    const f = mockFetch([{ body: json('graphql-transcript.json') }]);
    await getTranscript('01JQFF1TESTMEETING000001', { fetchImpl: f.impl });

    const { url, init } = f.calls[0];
    expect(url).toBe('https://api.fireflies.ai/graphql');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('throws rather than sending an empty Authorization header', async () => {
    delete process.env.FIREFLIES_API_KEY;
    const f = mockFetch([{ body: {} }]);
    await expect(getTranscript('x', { fetchImpl: f.impl })).rejects.toThrow(/FIREFLIES_API_KEY/);
    expect(f.count()).toBe(0);
  });

  it('parses a full transcript with speaker segments', async () => {
    const f = mockFetch([{ body: json('graphql-transcript.json') }]);
    const t = await getTranscript('01JQFF1TESTMEETING000001', { fetchImpl: f.impl });

    expect(t.id).toBe('01JQFF1TESTMEETING000001');
    expect(t.sentences).toHaveLength(2);
    expect(t.sentences?.[0].speaker_name).toBe('Test Speaker One');
    expect(t.speakers).toHaveLength(2);
  });

  it('⚠️ treats HTTP 200 with an errors array as a FAILURE', async () => {
    // The GraphQL trap: status is 200. Checking res.ok alone would return a
    // null transcript as though the call had succeeded.
    const f = mockFetch([{ status: 200, body: json('graphql-errors.json') }]);
    await expect(getTranscript('missing', { fetchImpl: f.impl })).rejects.toThrow(
      FirefliesGraphQLError
    );
  });

  it('flags a "not found" GraphQL error as retryable', async () => {
    const f = mockFetch([{ body: json('graphql-errors.json') }]);
    try {
      await getTranscript('missing', { fetchImpl: f.impl });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FirefliesGraphQLError);
      // This is the "webhook outran the transcript" case the worker retries on.
      expect((err as FirefliesGraphQLError).isNotReady).toBe(true);
    }
  });

  it('treats a null transcript with no errors as not-ready too', async () => {
    const f = mockFetch([{ body: json('graphql-not-ready.json') }]);
    await expect(getTranscript('pending', { fetchImpl: f.impl })).rejects.toThrow(
      FirefliesGraphQLError
    );
  });

  it('rejects a response whose shape changed', async () => {
    const f = mockFetch([{ body: json('graphql-malformed.json') }]);
    await expect(getTranscript('x', { fetchImpl: f.impl })).rejects.toThrow(FirefliesSchemaError);
  });

  it('retries a 429 then succeeds', async () => {
    const f = mockFetch([{ status: 429 }, { body: json('graphql-transcript.json') }]);
    const t = await getTranscript('01JQFF1TESTMEETING000001', {
      fetchImpl: f.impl,
      sleep: noSleep
    });
    expect(t.id).toBe('01JQFF1TESTMEETING000001');
    expect(f.count()).toBe(2);
  });

  it('gives up on sustained 429 and names the daily limits', async () => {
    const f = mockFetch([{ status: 429 }]);
    await expect(getTranscript('x', { fetchImpl: f.impl, sleep: noSleep })).rejects.toThrow(
      FirefliesApiError
    );
    await expect(getTranscript('x', { fetchImpl: f.impl, sleep: noSleep })).rejects.toThrow(
      /500\/day/
    );
  });

  it('does not retry a non-429 HTTP error', async () => {
    const f = mockFetch([{ status: 401, body: {} }]);
    await expect(getTranscript('x', { fetchImpl: f.impl, sleep: noSleep })).rejects.toThrow(
      FirefliesApiError
    );
    expect(f.count()).toBe(1);
  });

  it('getTranscripts passes limit and skip for backfill', async () => {
    const f = mockFetch([
      { body: { data: { transcripts: [json('graphql-transcript.json').data.transcript] } } }
    ]);
    const list = await getTranscripts(10, 20, { fetchImpl: f.impl });

    expect(list).toHaveLength(1);
    const sent = JSON.parse(f.calls[0].init.body as string);
    expect(sent.variables).toEqual({ limit: 10, skip: 20 });
  });

  it('getTranscripts returns [] rather than throwing on an empty page', async () => {
    const f = mockFetch([{ body: { data: { transcripts: [] } } }]);
    await expect(getTranscripts(10, 0, { fetchImpl: f.impl })).resolves.toEqual([]);
  });
});
