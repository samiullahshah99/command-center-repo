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

// ────────────────────────────────────────────────────────────────────────────
// TODO(REMOVE WITH THE UNSIGNED-TEST EXCEPTION)
// Delete this whole describe block when isUnsignedTestDelivery() comes out.
// ────────────────────────────────────────────────────────────────────────────
const DELIVERY_HEADER = 'x-webhook-delivery-id';

function deliveryRequest(rawBody: string, headers: Record<string, string>) {
  return new Request('https://example.test/api/webhooks/fireflies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: rawBody
  });
}

describe('unsigned test-delivery exception', () => {
  beforeEach(() => {
    process.env.FIREFLIES_WEBHOOK_SECRET = SECRET;
    h.rows.clear();
    h.ingestCalls.length = 0;
    h.enqueued.length = 0;
    h.ingestThrows.value = false;
    h.enqueueThrows.value = false;
    // mockClear matters: vi.spyOn keeps ONE spy per file, so without it
    // console.warn calls accumulate across tests and the "must NOT contain
    // SIGNATURE CHECK BYPASSED" assertion below reads an earlier test's output.
    vi.spyOn(console, 'warn')
      .mockImplementation(() => {})
      .mockClear();
    vi.spyOn(console, 'error')
      .mockImplementation(() => {})
      .mockClear();
  });

  const body = () => fixture('webhook-transcription-completed.json');

  it('accepts an UNSIGNED delivery whose id starts with test-, and stores it', async () => {
    const res = await POST(deliveryRequest(body(), { [DELIVERY_HEADER]: 'test-abc123' }));

    expect(res.status).toBe(200);
    expect(h.ingestCalls).toHaveLength(1);
    expect(h.ingestCalls[0].source).toBe('fireflies');
    // Null key, so repeated setup pings each land instead of deduping away.
    expect(h.ingestCalls[0].externalId).toBeNull();
    expect(h.ingestCalls[0].payload).toEqual(JSON.parse(body()));
  });

  it('does NOT enqueue a transcript fetch for a test ping', async () => {
    // The API is limited to 500 requests/DAY; a fake meetingId would burn 4 of
    // them across the retry ladder and never succeed.
    await POST(deliveryRequest(body(), { [DELIVERY_HEADER]: 'test-abc123' }));
    expect(h.enqueued).toHaveLength(0);
  });

  it('logs the bypass loudly', async () => {
    await POST(deliveryRequest(body(), { [DELIVERY_HEADER]: 'test-abc123' }));
    const logged = vi.mocked(console.warn).mock.calls.flat().join('\n');
    expect(logged).toContain('SIGNATURE CHECK BYPASSED');
  });

  it('repeated test pings each land — none is deduped away', async () => {
    await POST(deliveryRequest(body(), { [DELIVERY_HEADER]: 'test-abc123' }));
    await POST(deliveryRequest(body(), { [DELIVERY_HEADER]: 'test-abc123' }));
    expect(h.ingestCalls).toHaveLength(2);
    expect(h.rows.size).toBe(2);
  });

  // ── The exception must not widen ──────────────────────────────────────────

  it('⚠️ an UNSIGNED NON-test delivery is STILL REJECTED', async () => {
    // The whole point: real events must keep requiring a valid signature.
    const res = await POST(deliveryRequest(body(), { [DELIVERY_HEADER]: 'evt_9f3a2b' }));

    expect(res.status).toBe(401);
    expect(h.ingestCalls).toHaveLength(0);
    expect(h.enqueued).toHaveLength(0);
  });

  it('⚠️ an unsigned delivery with NO delivery-id header is STILL REJECTED', async () => {
    const res = await POST(deliveryRequest(body(), {}));
    expect(res.status).toBe(401);
    expect(h.ingestCalls).toHaveLength(0);
  });

  it('⚠️ a test- delivery with a PRESENT but INVALID signature is STILL REJECTED', async () => {
    // Absence of a signature is the trigger, never a wrong one. Otherwise any
    // garbage signature plus a test- id would be waved through, and a genuinely
    // misconfigured secret would masquerade as a setup ping.
    const res = await POST(
      deliveryRequest(body(), {
        [DELIVERY_HEADER]: 'test-abc123',
        [FIREFLIES_SIGNATURE_HEADER]: 'sha256=deadbeef'
      })
    );

    expect(res.status).toBe(401);
    expect(h.ingestCalls).toHaveLength(0);
  });

  it('a CORRECTLY signed test- delivery takes the normal path, not the exception', async () => {
    const raw = body();
    const res = await POST(
      deliveryRequest(raw, {
        [DELIVERY_HEADER]: 'test-abc123',
        [FIREFLIES_SIGNATURE_HEADER]: signFirefliesRequest({ rawBody: raw, secret: SECRET })
      })
    );

    expect(res.status).toBe(200);
    // Normal path: real meetingId key, and the fetch IS enqueued.
    expect(h.ingestCalls[0].externalId).toBe('01JQFF1TESTMEETING000001');
    expect(h.enqueued).toHaveLength(1);
    const logged = vi.mocked(console.warn).mock.calls.flat().join('\n');
    expect(logged).not.toContain('SIGNATURE CHECK BYPASSED');
  });

  it('a "test-" prefix is matched exactly — "Test-" and "testing" do not qualify', async () => {
    for (const id of ['Test-abc', 'testing-abc', 'x-test-abc']) {
      h.ingestCalls.length = 0;
      const res = await POST(deliveryRequest(body(), { [DELIVERY_HEADER]: id }));
      expect(res.status, `delivery id ${id} must not qualify`).toBe(401);
      expect(h.ingestCalls).toHaveLength(0);
    }
  });
});

describe('GET /api/webhooks/fireflies', () => {
  it('answers reachability checks', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});
