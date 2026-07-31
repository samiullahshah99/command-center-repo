import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CC_SIGNATURE_HEADER,
  CC_SIGNATURE_PREFIX,
  CC_TIMESTAMP_HEADER,
  type InternalPlatform
} from './contract';
import { signTimestampedHmac } from '../verify-hmac';

const SECRETS: Record<InternalPlatform, string> = {
  portal: 'portal-secret-9f2c4a',
  studio: 'studio-secret-3b7e1d'
};
const NOW_MS = 1_785_000_000_000;
const MAX_AGE_MS = 5 * 60 * 1000;

const h = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  calls: [] as { source: string; externalId?: string | null; payload: unknown }[],
  failNext: { value: false }
}));

vi.mock('../ingest', () => ({
  ingestRawEvent: async (input: {
    source: string;
    payload: unknown;
    externalId?: string | null;
  }) => {
    h.calls.push(input);
    if (h.failNext.value) throw new Error('simulated database failure');
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

const { createInternalWebhookGet, createInternalWebhookHandler } = await import('./handler');

function fixture(platform: InternalPlatform, name: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', platform, name), 'utf8');
}

/** Signs the way the sending platform would, per docs/webhook-contract.md. */
function signedRequest(
  platform: InternalPlatform,
  rawBody: string,
  opts: { timestampMs?: number; secret?: string } = {}
) {
  const { signature, timestamp } = signTimestampedHmac({
    rawBody,
    timestamp: Math.floor((opts.timestampMs ?? NOW_MS) / 1000),
    secret: opts.secret ?? SECRETS[platform],
    signaturePrefix: CC_SIGNATURE_PREFIX
  });
  return new Request(`https://example.test/api/webhooks/${platform}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CC_SIGNATURE_HEADER]: signature,
      [CC_TIMESTAMP_HEADER]: timestamp
    },
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

// Both platforms speak the identical contract, so the suite runs twice rather
// than testing one and assuming the other.
const PLATFORMS: { platform: InternalPlatform; validFixture: string; retryFixture: string }[] = [
  {
    platform: 'portal',
    validFixture: 'activity-signal.json',
    retryFixture: 'retry-duplicate.json'
  },
  { platform: 'studio', validFixture: 'stats-updated.json', retryFixture: 'retry-duplicate.json' }
];

describe.each(PLATFORMS)('$platform webhook', ({ platform, validFixture, retryFixture }) => {
  const POST = createInternalWebhookHandler(platform);
  const GET = createInternalWebhookGet(platform);

  beforeEach(() => {
    process.env.PORTAL_WEBHOOK_SECRET = SECRETS.portal;
    process.env.STUDIO_WEBHOOK_SECRET = SECRETS.studio;
    h.rows.clear();
    h.calls.length = 0;
    h.failNext.value = false;
    vi.setSystemTime(new Date(NOW_MS));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a validly signed payload and persists it', async () => {
    const raw = fixture(platform, validFixture);
    const res = await POST(signedRequest(platform, raw));

    expect(res.status).toBe(200);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].source).toBe(platform);
    expect(h.calls[0].externalId).toBe(JSON.parse(raw).event_id);
  });

  it('stores the payload verbatim', async () => {
    const raw = fixture(platform, validFixture);
    await POST(signedRequest(platform, raw));
    expect(h.calls[0].payload).toEqual(JSON.parse(raw));
  });

  it('rejects a tampered body with 401 and persists nothing', async () => {
    const raw = fixture(platform, validFixture);
    const req = signedRequest(platform, raw);
    const tampered = new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: raw.replace('"data"', '"DATA_TAMPERED"')
    });

    const res = await POST(tampered);
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects a re-serialised body (proves req.json() would break verification)', async () => {
    const raw = fixture(platform, validFixture);
    const req = signedRequest(platform, raw);
    // Same meaning, different bytes — exactly what req.json() + re-stringify does.
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect(reserialised).not.toBe(raw);

    const res = await POST(
      new Request(req.url, { method: 'POST', headers: req.headers, body: reserialised })
    );
    expect(res.status).toBe(401);
  });

  it('rejects a STALE timestamp', async () => {
    const raw = fixture(platform, validFixture);
    const res = await POST(
      signedRequest(platform, raw, { timestampMs: NOW_MS - MAX_AGE_MS - 1000 })
    );
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects a FUTURE timestamp (Math.abs, not a one-sided check)', async () => {
    const raw = fixture(platform, validFixture);
    const res = await POST(
      signedRequest(platform, raw, { timestampMs: NOW_MS + MAX_AGE_MS + 1000 })
    );
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('accepts a timestamp exactly at the window edge', async () => {
    const raw = fixture(platform, validFixture);
    const res = await POST(signedRequest(platform, raw, { timestampMs: NOW_MS - MAX_AGE_MS }));
    expect(res.status).toBe(200);
  });

  it('rejects missing headers entirely', async () => {
    const res = await POST(unsignedRequest(platform, fixture(platform, validFixture)));
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects a signature with no timestamp header', async () => {
    const res = await POST(
      unsignedRequest(platform, fixture(platform, validFixture), {
        [CC_SIGNATURE_HEADER]: 'deadbeef'
      })
    );
    expect(res.status).toBe(401);
  });

  it('rejects a timestamp with no signature header', async () => {
    const res = await POST(
      unsignedRequest(platform, fixture(platform, validFixture), {
        [CC_TIMESTAMP_HEADER]: String(Math.floor(NOW_MS / 1000))
      })
    );
    expect(res.status).toBe(401);
  });

  it('rejects a malformed timestamp', async () => {
    const res = await POST(
      unsignedRequest(platform, fixture(platform, validFixture), {
        [CC_SIGNATURE_HEADER]: 'deadbeef',
        [CC_TIMESTAMP_HEADER]: 'not-a-number'
      })
    );
    expect(res.status).toBe(401);
  });

  it('rejects the OTHER platform’s secret', async () => {
    // Portal and Studio must not be interchangeable.
    const other: InternalPlatform = platform === 'portal' ? 'studio' : 'portal';
    const res = await POST(
      signedRequest(platform, fixture(platform, validFixture), { secret: SECRETS[other] })
    );
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects when the secret is unset', async () => {
    delete process.env[platform === 'portal' ? 'PORTAL_WEBHOOK_SECRET' : 'STUDIO_WEBHOOK_SECRET'];
    const res = await POST(signedRequest(platform, fixture(platform, validFixture)));
    expect(res.status).toBe(401);
  });

  it('returns 400 on signed but malformed JSON', async () => {
    const res = await POST(signedRequest(platform, '{ this is not json'));
    expect(res.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it('returns 401 (not 400) for unsigned malformed JSON — signature checked first', async () => {
    const res = await POST(unsignedRequest(platform, '{ this is not json'));
    expect(res.status).toBe(401);
  });

  it('a duplicate event_id does not double-insert', async () => {
    const r1 = await POST(signedRequest(platform, fixture(platform, validFixture)));
    const r2 = await POST(signedRequest(platform, fixture(platform, retryFixture)));

    expect(r1.status).toBe(200);
    // Must still be 2xx, or the sender keeps retrying.
    expect(r2.status).toBe(200);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0].externalId).toBe(h.calls[1].externalId);
    expect(h.rows.size).toBe(1);
  });

  it('returns 500 when ingest throws, so the sender retries', async () => {
    h.failNext.value = true;
    const res = await POST(signedRequest(platform, fixture(platform, validFixture)));
    expect(res.status).toBe(500);
    expect(h.rows.size).toBe(0);
  });

  it('answers GET reachability checks', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, endpoint: `${platform}-webhook` });
  });
});

describe('envelope handling', () => {
  const POST = createInternalWebhookHandler('portal');

  beforeEach(() => {
    process.env.PORTAL_WEBHOOK_SECRET = SECRETS.portal;
    h.rows.clear();
    h.calls.length = 0;
    h.failNext.value = false;
    vi.setSystemTime(new Date(NOW_MS));
  });

  afterEach(() => vi.useRealTimers());

  it('stores a verified payload that does NOT match our envelope, with a null key', async () => {
    // A signature-verified delivery is real even if the shape is wrong. Dropping
    // it would defeat the point of a landing zone; it is stored without dedup.
    const res = await POST(signedRequest('portal', fixture('portal', 'malformed-envelope.json')));
    expect(res.status).toBe(200);
    expect(h.calls[0].externalId).toBeNull();
    expect(h.rows.size).toBe(1);
  });

  it('two different event_ids both persist', async () => {
    const studioPost = createInternalWebhookHandler('studio');
    process.env.STUDIO_WEBHOOK_SECRET = SECRETS.studio;
    await studioPost(signedRequest('studio', fixture('studio', 'stats-updated.json')));
    await studioPost(signedRequest('studio', fixture('studio', 'second-event.json')));
    expect(h.rows.size).toBe(2);
  });
});
