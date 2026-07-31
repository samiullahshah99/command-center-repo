import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIREFLIES_SIGNATURE_HEADER, signFirefliesRequest } from '@/features/connectors/fireflies';

const SECRET = 'fireflies-test-secret-16chars';

const h = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  ingestCalls: [] as { source: string; externalId?: string | null; payload: unknown }[],
  enqueued: [] as { source: string; data: unknown; options?: unknown }[],
  ingestThrows: { value: false },
  enqueueThrows: { value: false }
}));

vi.mock('@/features/connectors/ingest', () => ({
  ingestRawEvent: async (input: {
    source: string;
    payload: unknown;
    externalId?: string | null;
  }) => {
    h.ingestCalls.push(input);
    if (h.ingestThrows.value) throw new Error('simulated database failure');
    if (!input.externalId) {
      const id = `row-${h.rows.size + 1}`;
      h.rows.set(`nokey-${h.rows.size}`, id);
      return { inserted: true, id, duplicate: false };
    }
    const key = `${input.source}:${input.externalId}`;
    if (h.rows.has(key)) return { inserted: false, id: null, duplicate: true };
    const id = `row-${h.rows.size + 1}`;
    h.rows.set(key, id);
    return { inserted: true, id, duplicate: false };
  },
  findRawEventByExternalId: async () => null
}));

vi.mock('@/lib/queue', () => ({
  sendParseJob: async (source: string, data: unknown, options?: unknown) => {
    if (h.enqueueThrows.value) throw new Error('queue unavailable');
    h.enqueued.push({ source, data, options });
    return 'job-1';
  }
}));

const { POST, GET } = await import('./route');

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', 'fireflies', name), 'utf8');
}

function signedRequest(rawBody: string, opts: { secret?: string } = {}) {
  return new Request('https://example.test/api/webhooks/fireflies', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [FIREFLIES_SIGNATURE_HEADER]: signFirefliesRequest({
        rawBody,
        secret: opts.secret ?? SECRET
      })
    },
    body: rawBody
  });
}

function unsignedRequest(rawBody: string) {
  return new Request('https://example.test/api/webhooks/fireflies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody
  });
}

describe('POST /api/webhooks/fireflies', () => {
  beforeEach(() => {
    process.env.FIREFLIES_WEBHOOK_SECRET = SECRET;
    h.rows.clear();
    h.ingestCalls.length = 0;
    h.enqueued.length = 0;
    h.ingestThrows.value = false;
    h.enqueueThrows.value = false;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('accepts a signed webhook, persists it, and enqueues the fetch', async () => {
    const raw = fixture('webhook-transcription-completed.json');
    const res = await POST(signedRequest(raw));

    expect(res.status).toBe(200);
    expect(h.ingestCalls).toHaveLength(1);
    expect(h.ingestCalls[0].source).toBe('fireflies');
    expect(h.ingestCalls[0].externalId).toBe('01JQFF1TESTMEETING000001');
    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0].data).toEqual({ rawEventId: 'row-1' });
  });

  it('enqueues with the Fireflies-specific retry budget, not the global one', async () => {
    // 3 attempts at 60s, because the API is limited per DAY and the transcript
    // may legitimately not be ready for minutes.
    await POST(signedRequest(fixture('webhook-transcription-completed.json')));
    const opts = h.enqueued[0].options as Record<string, number>;
    expect(opts.retryLimit).toBe(3);
    expect(opts.retryDelay).toBe(60);
  });

  it('stores the notification verbatim — the transcript is fetched separately', async () => {
    const raw = fixture('webhook-transcription-completed.json');
    await POST(signedRequest(raw));
    expect(h.ingestCalls[0].payload).toEqual(JSON.parse(raw));
  });

  it('rejects an unsigned request with 401 and persists nothing', async () => {
    const res = await POST(unsignedRequest(fixture('webhook-transcription-completed.json')));
    expect(res.status).toBe(401);
    expect(h.ingestCalls).toHaveLength(0);
  });

  it('rejects a wrong secret with 401', async () => {
    const res = await POST(
      signedRequest(fixture('webhook-transcription-completed.json'), { secret: 'wrong' })
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on signed but malformed JSON', async () => {
    const res = await POST(signedRequest('{ not json'));
    expect(res.status).toBe(400);
    expect(h.ingestCalls).toHaveLength(0);
  });

  it('a duplicate meetingId does not double-insert or double-enqueue', async () => {
    const r1 = await POST(signedRequest(fixture('webhook-transcription-completed.json')));
    const r2 = await POST(signedRequest(fixture('webhook-retry-duplicate.json')));

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(h.rows.size).toBe(1);
    // Critically: the second delivery must NOT queue a second GraphQL fetch —
    // that would spend a request from a per-DAY budget for nothing.
    expect(h.enqueued).toHaveLength(1);
  });

  it('accepts an unknown eventType — the catalog is additive', async () => {
    const res = await POST(signedRequest(fixture('webhook-unknown-event.json')));
    expect(res.status).toBe(200);
    expect(h.enqueued).toHaveLength(1);
  });

  it('stores an off-contract payload with a null key rather than rejecting it', async () => {
    const res = await POST(signedRequest(fixture('webhook-off-contract.json')));
    expect(res.status).toBe(200);
    expect(h.ingestCalls[0].externalId).toBeNull();
  });

  it('returns 500 when the ingest write fails', async () => {
    h.ingestThrows.value = true;
    const res = await POST(signedRequest(fixture('webhook-transcription-completed.json')));
    expect(res.status).toBe(500);
  });

  it('still returns 200 when ENQUEUE fails — the event is already stored', async () => {
    // Deliberate: Fireflies' retry behaviour is undocumented, so a 500 here might
    // mean the meeting is never announced again. The event is safely persisted
    // and a getTranscripts() backfill can recover the missing fetch.
    h.enqueueThrows.value = true;
    const res = await POST(signedRequest(fixture('webhook-transcription-completed.json')));

    expect(res.status).toBe(200);
    expect(h.rows.size).toBe(1);
    expect(h.enqueued).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('GET /api/webhooks/fireflies', () => {
  it('answers reachability checks', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});
