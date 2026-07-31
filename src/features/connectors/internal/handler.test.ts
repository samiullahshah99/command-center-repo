import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signBodyOnly, signWithTimestamp } from '../verify-hmac';
import {
  UGC_EVENT_HEADER,
  UGC_SEPARATOR,
  UGC_SIGNATURE_HEADER,
  UGC_SIGNATURE_PREFIX,
  UGC_TIMESTAMP_HEADER,
  UGC_WINDOW_SECONDS,
  VISION_EVENT_HEADER,
  VISION_SIGNATURE_HEADER,
  VISION_SIGNATURE_PREFIX,
  type InternalPlatform
} from './contract';

const SECRETS: Record<InternalPlatform, string> = {
  ugc: 'ugc-secret-7c1f9a',
  vision: 'vision-secret-2e8d4b'
};
const NOW_MS = 1_785_000_000_000;
const WINDOW_MS = UGC_WINDOW_SECONDS * 1000;

const h = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  calls: [] as { source: string; externalId?: string | null; payload: unknown }[],
  /** raw_event ids handed to the queue. Length is the assertion that matters. */
  enqueued: [] as string[],
  failNext: { value: false }
}));

vi.mock('../ingest', () => {
  const ingestRawEvent = async (input: {
    source: string;
    payload: unknown;
    externalId?: string | null;
  }) => {
    h.calls.push(input);
    if (h.failNext.value) throw new Error('simulated database failure');
    if (!input.externalId) {
      // Null key -> always inserts, matching Postgres NULL-distinct semantics.
      const id = `row-${h.rows.size + 1}`;
      h.rows.set(`nokey-${h.rows.size}`, id);
      return { inserted: true, id, duplicate: false };
    }
    const key = `${input.source}:${input.externalId}`;
    if (h.rows.has(key)) return { inserted: false, id: null, duplicate: true };
    const id = `row-${h.rows.size + 1}`;
    h.rows.set(key, id);
    return { inserted: true, id, duplicate: false };
  };

  return {
    ingestRawEvent,
    /**
     * Mirrors the real ingestAndEnqueue, including the part under test: the
     * enqueue is gated on `inserted`, so a duplicate delivery queues nothing.
     */
    ingestAndEnqueue: async (input: {
      source: string;
      payload: unknown;
      externalId?: string | null;
    }) => {
      const result = await ingestRawEvent(input);
      if (result.inserted && result.id) h.enqueued.push(result.id);
      return { ...result, enqueued: result.inserted && result.id !== null };
    },
    findRawEventByExternalId: async () => null
  };
});

const { createInternalWebhookGet, createInternalWebhookHandler } = await import('./handler');

function fixture(platform: InternalPlatform, name: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', platform, name), 'utf8');
}

/** Signs the way each sender does — never a hardcoded digest. */
function signedRequest(
  platform: InternalPlatform,
  rawBody: string,
  opts: { timestampMs?: number; secret?: string; prefix?: string; eventType?: string } = {}
) {
  const secret = opts.secret ?? SECRETS[platform];
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (platform === 'ugc') {
    const { signature, timestamp } = signWithTimestamp({
      rawBody,
      timestamp: Math.floor((opts.timestampMs ?? NOW_MS) / 1000),
      secret,
      prefix: opts.prefix ?? UGC_SIGNATURE_PREFIX,
      separator: UGC_SEPARATOR,
      format: 'plain'
    });
    headers[UGC_SIGNATURE_HEADER] = signature;
    headers[UGC_TIMESTAMP_HEADER] = timestamp;
    if (opts.eventType) headers[UGC_EVENT_HEADER] = opts.eventType;
  } else {
    headers[VISION_SIGNATURE_HEADER] = signBodyOnly({
      rawBody,
      secret,
      prefix: opts.prefix ?? VISION_SIGNATURE_PREFIX
    });
    if (opts.eventType) headers[VISION_EVENT_HEADER] = opts.eventType;
  }

  return new Request(`https://example.test/api/webhooks/${platform}`, {
    method: 'POST',
    headers,
    body: rawBody
  });
}

function unsignedRequest(
  platform: InternalPlatform,
  rawBody: string,
  headers: Record<string, string> = {}
) {
  return new Request(`https://example.test/api/webhooks/${platform}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: rawBody
  });
}

const CASES: {
  platform: InternalPlatform;
  valid: string;
  retry: string;
  unknown: string;
}[] = [
  {
    platform: 'ugc',
    valid: 'creator-approved.json',
    retry: 'retry-duplicate.json',
    unknown: 'unknown-event-type.json'
  },
  {
    platform: 'vision',
    valid: 'brief-submitted.json',
    retry: 'retry-duplicate.json',
    unknown: 'unknown-event-type.json'
  }
];

describe.each(CASES)('$platform webhook', ({ platform, valid, retry, unknown }) => {
  const POST = createInternalWebhookHandler(platform);
  const GET = createInternalWebhookGet(platform);

  beforeEach(() => {
    process.env.UGC_WEBHOOK_SECRET = SECRETS.ugc;
    process.env.VISION_WEBHOOK_SECRET = SECRETS.vision;
    h.rows.clear();
    h.calls.length = 0;
    h.enqueued.length = 0;
    h.failNext.value = false;
    vi.setSystemTime(new Date(NOW_MS));
  });

  afterEach(() => vi.useRealTimers());

  it('accepts a validly signed payload and persists it', async () => {
    const raw = fixture(platform, valid);
    const res = await POST(signedRequest(platform, raw));

    expect(res.status).toBe(200);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].source).toBe(platform);
    expect(h.calls[0].externalId).toBe(JSON.parse(raw).id);
  });

  it('stores the COMPLETE envelope verbatim, with no field extraction', async () => {
    const raw = fixture(platform, valid);
    await POST(signedRequest(platform, raw));
    expect(h.calls[0].payload).toEqual(JSON.parse(raw));
  });

  it('rejects a tampered body', async () => {
    const raw = fixture(platform, valid);
    const tampered = raw.replace('"occurred_at"', '"TAMPERED_AT"');
    // Guard: if the replacement ever stops matching, the "tampered" body would be
    // identical to the signed one and this test would pass for the wrong reason.
    expect(tampered).not.toBe(raw);

    const req = signedRequest(platform, raw);
    const res = await POST(
      new Request(req.url, { method: 'POST', headers: req.headers, body: tampered })
    );
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects a re-serialised body (proves req.json() would break verification)', async () => {
    const raw = fixture(platform, valid);
    const req = signedRequest(platform, raw);
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect(reserialised).not.toBe(raw);
    const res = await POST(
      new Request(req.url, { method: 'POST', headers: req.headers, body: reserialised })
    );
    expect(res.status).toBe(401);
  });

  it('rejects a WRONG signature prefix', async () => {
    // Correct digest, wrong envelope — e.g. copying Slack's 'v0=' here.
    const res = await POST(signedRequest(platform, fixture(platform, valid), { prefix: 'v0=' }));
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects a bare digest with no prefix at all', async () => {
    const res = await POST(signedRequest(platform, fixture(platform, valid), { prefix: '' }));
    expect(res.status).toBe(401);
  });

  it('rejects missing headers entirely', async () => {
    const res = await POST(unsignedRequest(platform, fixture(platform, valid)));
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects the other platform’s secret', async () => {
    const other: InternalPlatform = platform === 'ugc' ? 'vision' : 'ugc';
    const res = await POST(
      signedRequest(platform, fixture(platform, valid), { secret: SECRETS[other] })
    );
    expect(res.status).toBe(401);
  });

  it('rejects when the secret is unset', async () => {
    delete process.env[platform === 'ugc' ? 'UGC_WEBHOOK_SECRET' : 'VISION_WEBHOOK_SECRET'];
    const res = await POST(signedRequest(platform, fixture(platform, valid)));
    expect(res.status).toBe(401);
  });

  it('a duplicate id does not double-insert, and still answers 2xx', async () => {
    const r1 = await POST(signedRequest(platform, fixture(platform, valid)));
    const r2 = await POST(signedRequest(platform, fixture(platform, retry)));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(h.calls[0].externalId).toBe(h.calls[1].externalId);
    expect(h.rows.size).toBe(1);
  });

  it('ACCEPTS an unknown event type (contracts say types are additive)', async () => {
    const res = await POST(signedRequest(platform, fixture(platform, unknown)));
    expect(res.status).toBe(200);
    expect(h.rows.size).toBe(1);
  });

  it('returns 400 on signed but malformed JSON', async () => {
    const res = await POST(signedRequest(platform, '{ not json'));
    expect(res.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it('returns 401 (not 400) for unsigned malformed JSON — signature checked first', async () => {
    const res = await POST(unsignedRequest(platform, '{ not json'));
    expect(res.status).toBe(401);
  });

  it('returns 500 when ingest throws, so the sender retries', async () => {
    h.failNext.value = true;
    const res = await POST(signedRequest(platform, fixture(platform, valid)));
    expect(res.status).toBe(500);
    expect(h.rows.size).toBe(0);
  });

  it('answers GET reachability checks', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});

// ── UGC-only: replay window ─────────────────────────────────────────────────

describe('ugc replay window', () => {
  const POST = createInternalWebhookHandler('ugc');

  beforeEach(() => {
    process.env.UGC_WEBHOOK_SECRET = SECRETS.ugc;
    h.rows.clear();
    h.calls.length = 0;
    h.enqueued.length = 0;
    vi.setSystemTime(new Date(NOW_MS));
  });
  afterEach(() => vi.useRealTimers());

  it('rejects a STALE timestamp', async () => {
    const res = await POST(
      signedRequest('ugc', fixture('ugc', 'creator-approved.json'), {
        timestampMs: NOW_MS - WINDOW_MS - 1000
      })
    );
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects a FUTURE timestamp (Math.abs, not one-sided)', async () => {
    const res = await POST(
      signedRequest('ugc', fixture('ugc', 'creator-approved.json'), {
        timestampMs: NOW_MS + WINDOW_MS + 1000
      })
    );
    expect(res.status).toBe(401);
  });

  it('accepts a timestamp exactly at the window edge', async () => {
    const res = await POST(
      signedRequest('ugc', fixture('ugc', 'creator-approved.json'), {
        timestampMs: NOW_MS - WINDOW_MS
      })
    );
    expect(res.status).toBe(200);
  });

  it('rejects a missing timestamp header', async () => {
    const raw = fixture('ugc', 'creator-approved.json');
    const res = await POST(
      unsignedRequest('ugc', raw, { [UGC_SIGNATURE_HEADER]: 'sha256=deadbeef' })
    );
    expect(res.status).toBe(401);
  });

  it('uses a DOT separator, not a colon — a Slack-style basestring fails', async () => {
    const raw = fixture('ugc', 'creator-approved.json');
    const ts = Math.floor(NOW_MS / 1000);
    // Colon-separated, Slack style. Correct algorithm, wrong basestring.
    const wrong = signWithTimestamp({
      rawBody: raw,
      timestamp: ts,
      secret: SECRETS.ugc,
      prefix: UGC_SIGNATURE_PREFIX,
      separator: ':',
      format: 'v0-prefixed'
    });
    const res = await POST(
      unsignedRequest('ugc', raw, {
        [UGC_SIGNATURE_HEADER]: wrong.signature,
        [UGC_TIMESTAMP_HEADER]: wrong.timestamp
      })
    );
    expect(res.status).toBe(401);
  });
});

// ── Vision-only: no replay window exists ────────────────────────────────────

describe('vision has no replay protection', () => {
  const POST = createInternalWebhookHandler('vision');

  beforeEach(() => {
    process.env.VISION_WEBHOOK_SECRET = SECRETS.vision;
    h.rows.clear();
    h.calls.length = 0;
    h.enqueued.length = 0;
    vi.setSystemTime(new Date(NOW_MS));
  });
  afterEach(() => vi.useRealTimers());

  it('accepts a signature captured long ago — documents the exposure', async () => {
    // Vision sends no timestamp, so there is nothing to expire. This test exists
    // to make the gap explicit rather than to endorse it: idempotency on
    // payload.id is the ONLY defence on this endpoint.
    const raw = fixture('vision', 'brief-submitted.json');
    const req = signedRequest('vision', raw);

    vi.setSystemTime(new Date(NOW_MS + 400 * 24 * 60 * 60 * 1000)); // +400 days
    const res = await POST(req);

    expect(res.status).toBe(200);
  });

  it('does NOT filter on environment — preview and development are stored', async () => {
    // Store everything, filter downstream at the parsing stage.
    await POST(signedRequest('vision', fixture('vision', 'preview-environment.json')));
    expect(h.calls).toHaveLength(1);
    expect((h.calls[0].payload as { environment: string }).environment).toBe('preview');

    await POST(signedRequest('vision', fixture('vision', 'unknown-event-type.json')));
    expect((h.calls[1].payload as { environment: string }).environment).toBe('development');
  });
});

// ── Setup test events ───────────────────────────────────────────────────────

describe('constant-id setup test events', () => {
  beforeEach(() => {
    process.env.UGC_WEBHOOK_SECRET = SECRETS.ugc;
    process.env.VISION_WEBHOOK_SECRET = SECRETS.vision;
    h.rows.clear();
    h.calls.length = 0;
    h.enqueued.length = 0;
    vi.setSystemTime(new Date(NOW_MS));
  });
  afterEach(() => vi.useRealTimers());

  it('UGC test.ping is accepted and stored with a NULL key', async () => {
    const POST = createInternalWebhookHandler('ugc');
    const res = await POST(
      signedRequest('ugc', fixture('ugc', 'test-ping.json'), { eventType: 'test.ping' })
    );
    expect(res.status).toBe(200);
    expect(h.calls[0].externalId).toBeNull();
  });

  it('REPEATED UGC test pings each land — the whole point', async () => {
    // With dedup on the constant id "evt_test", the second ping would vanish and
    // look like a broken handler during setup.
    const POST = createInternalWebhookHandler('ugc');
    const raw = fixture('ugc', 'test-ping.json');
    await POST(signedRequest('ugc', raw));
    await POST(signedRequest('ugc', raw));
    await POST(signedRequest('ugc', raw));
    expect(h.rows.size).toBe(3);
  });

  it('Vision all-zero-id test event is accepted and stored with a NULL key', async () => {
    const POST = createInternalWebhookHandler('vision');
    const res = await POST(signedRequest('vision', fixture('vision', 'test-event.json')));
    expect(res.status).toBe(200);
    expect(h.calls[0].externalId).toBeNull();
  });

  it('REPEATED Vision test events each land', async () => {
    const POST = createInternalWebhookHandler('vision');
    const raw = fixture('vision', 'test-event.json');
    await POST(signedRequest('vision', raw));
    await POST(signedRequest('vision', raw));
    expect(h.rows.size).toBe(2);
  });

  it('a REAL event is still deduplicated — the bypass is test-only', async () => {
    const POST = createInternalWebhookHandler('vision');
    const raw = fixture('vision', 'brief-submitted.json');
    await POST(signedRequest('vision', raw));
    await POST(signedRequest('vision', raw));
    expect(h.rows.size).toBe(1);
  });
});

// ── Off-envelope payloads ───────────────────────────────────────────────────

describe('off-envelope payloads', () => {
  beforeEach(() => {
    process.env.UGC_WEBHOOK_SECRET = SECRETS.ugc;
    h.rows.clear();
    h.calls.length = 0;
    h.enqueued.length = 0;
    vi.setSystemTime(new Date(NOW_MS));
  });
  afterEach(() => vi.useRealTimers());

  it('a signed payload with no id is still STORED, with a null key', async () => {
    // Signature-verified means it genuinely came from them. Dropping it because
    // the shape surprised us would defeat the point of a landing zone.
    const POST = createInternalWebhookHandler('ugc');
    const res = await POST(signedRequest('ugc', fixture('ugc', 'off-envelope.json')));
    expect(res.status).toBe(200);
    expect(h.calls[0].externalId).toBeNull();
    expect(h.rows.size).toBe(1);
  });
});
