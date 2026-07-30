import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  signSlackRequest,
  SLACK_SIGNATURE_HEADER,
  SLACK_TIMESTAMP_HEADER
} from '@/features/connectors/slack';

const SECRET = 'test-signing-secret-8f3a2b';
const OUR_APP_ID = 'A0MDYCDME';
const NOW_MS = 1_700_000_000_000;

// ── Mocks ───────────────────────────────────────────────────────────────────
// vi.mock is hoisted, so shared state must be created with vi.hoisted.
const h = vi.hoisted(() => ({
  /** Mimics the (source, external_id) partial unique index. */
  rows: new Map<string, string>(),
  calls: [] as { source: string; externalId?: string | null; payload: unknown }[],
  /** When set, ingestRawEvent throws — exercises the 500-so-Slack-retries path. */
  failNext: { value: false }
}));

// No next/server mock: the route persists synchronously and no longer uses after().

vi.mock('@/features/connectors/ingest', () => ({
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

// Imported after the mocks are declared.
const { POST, GET } = await import('./route');

// ── Helpers ─────────────────────────────────────────────────────────────────

function fixture(name: string): string {
  // Raw text, not parsed — the signature must be computed over these exact bytes.
  return readFileSync(join(process.cwd(), 'fixtures', 'slack', name), 'utf8');
}

function signedRequest(rawBody: string, opts: { timestampMs?: number; secret?: string } = {}) {
  const { signature, timestamp } = signSlackRequest({
    rawBody,
    timestamp: Math.floor((opts.timestampMs ?? NOW_MS) / 1000),
    signingSecret: opts.secret ?? SECRET
  });
  return new Request('https://example.test/api/webhooks/slack', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [SLACK_SIGNATURE_HEADER]: signature,
      [SLACK_TIMESTAMP_HEADER]: timestamp
    },
    body: rawBody
  });
}

function unsignedRequest(rawBody: string, headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/webhooks/slack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: rawBody
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/webhooks/slack', () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
    process.env.SLACK_APP_ID = OUR_APP_ID;
    h.rows.clear();
    h.calls.length = 0;
    h.failNext.value = false;
    // Verified that vi.setSystemTime takes effect without useFakeTimers in
    // Vitest 4, so Date.now() inside the route matches the signed timestamps.
    // Without that, every "accepted" case would silently be a 401 instead.
    vi.setSystemTime(new Date(NOW_MS));
  });

  afterEach(() => {
    // setSystemTime otherwise persists for the whole worker, silently shifting
    // the clock for every later test file.
    vi.useRealTimers();
  });

  describe('url_verification', () => {
    it('echoes the raw challenge value as text/plain', async () => {
      const raw = fixture('url-verification.json');
      const expected = JSON.parse(raw).challenge as string;

      const res = await POST(signedRequest(raw));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(expected);
      expect(res.headers.get('content-type')).toContain('text/plain');
    });

    it('REJECTS an unsigned handshake with 401', async () => {
      // Signature verification runs first, deliberately. Slack signs the handshake
      // too, so a wrong secret fails loudly at registration rather than
      // registering successfully and 401-ing every real event afterwards.
      const res = await POST(unsignedRequest(fixture('url-verification.json')));
      expect(res.status).toBe(401);
      expect(h.calls).toHaveLength(0);
    });

    it('REJECTS a handshake signed with the wrong secret', async () => {
      const res = await POST(
        signedRequest(fixture('url-verification.json'), { secret: 'not-the-secret' })
      );
      expect(res.status).toBe(401);
    });

    it('does not persist the handshake', async () => {
      const res = await POST(signedRequest(fixture('url-verification.json')));
      expect(res.status).toBe(200);
      expect(h.calls).toHaveLength(0);
    });
  });

  describe('signature verification', () => {
    it('accepts a correctly signed event and persists it', async () => {
      const raw = fixture('message-channels.json');
      const res = await POST(signedRequest(raw));

      expect(res.status).toBe(200);
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0].source).toBe('slack');
      expect(h.calls[0].externalId).toBe('Ev9UQ52YNA');
    });

    it('accepts an app_mention', async () => {
      const res = await POST(signedRequest(fixture('app-mention.json')));
      expect(res.status).toBe(200);
      expect(h.calls[0].externalId).toBe('Ev0MDYGXTB');
    });

    it('rejects a tampered body with 401 and does not persist', async () => {
      const raw = fixture('message-channels.json');
      const req = signedRequest(raw);
      // Sign the original, then send different bytes.
      const tampered = new Request(req.url, {
        method: 'POST',
        headers: req.headers,
        body: raw.replace('returns review', 'DELETE EVERYTHING')
      });

      const res = await POST(tampered);

      expect(res.status).toBe(401);
      expect(h.calls).toHaveLength(0);
    });

    it('rejects a stale timestamp with 401', async () => {
      const raw = fixture('message-channels.json');
      const res = await POST(signedRequest(raw, { timestampMs: NOW_MS - 6 * 60 * 1000 }));
      expect(res.status).toBe(401);
      expect(h.calls).toHaveLength(0);
    });

    it('rejects missing signature headers with 401', async () => {
      const res = await POST(unsignedRequest(fixture('message-channels.json')));
      expect(res.status).toBe(401);
      expect(h.calls).toHaveLength(0);
    });

    it('rejects a signature header with no timestamp', async () => {
      const res = await POST(
        unsignedRequest(fixture('message-channels.json'), {
          [SLACK_SIGNATURE_HEADER]: 'v0=abc'
        })
      );
      expect(res.status).toBe(401);
    });

    it('rejects a wrong signing secret with 401', async () => {
      const res = await POST(
        signedRequest(fixture('message-channels.json'), { secret: 'not-the-secret' })
      );
      expect(res.status).toBe(401);
      expect(h.calls).toHaveLength(0);
    });

    it('returns 400 on a signed but non-JSON body', async () => {
      // Must be signed: verification runs first, so an unsigned body is 401,
      // never 400. Slack always sends valid JSON, so this is a defensive path.
      const res = await POST(signedRequest('this is not json'));
      expect(res.status).toBe(400);
    });

    it('returns 401 (not 400) for an unsigned non-JSON body', async () => {
      // Ordering assertion: signature failure must take precedence over parsing.
      const res = await POST(unsignedRequest('this is not json'));
      expect(res.status).toBe(401);
    });
  });

  describe('idempotency', () => {
    it('a retry with the same event_id does not create a second row', async () => {
      const first = fixture('message-channels.json');
      const retry = fixture('retry-duplicate.json');

      const r1 = await POST(signedRequest(first));
      const r2 = await POST(signedRequest(retry));

      expect(r1.status).toBe(200);
      // Slack must still get a 2xx on the retry, or it keeps retrying.
      expect(r2.status).toBe(200);

      // ingest was called twice — the route does not try to dedup itself…
      expect(h.calls).toHaveLength(2);
      expect(h.calls[0].externalId).toBe(h.calls[1].externalId);
      // …and exactly one row exists, suppressed by the unique index.
      expect(h.rows.size).toBe(1);
    });

    it('uses event_id, not event.ts, as the key', async () => {
      const raw = fixture('message-channels.json');
      const parsed = JSON.parse(raw);
      await POST(signedRequest(raw));

      expect(h.calls[0].externalId).toBe(parsed.event_id);
      expect(h.calls[0].externalId).not.toBe(parsed.event.ts);
    });
  });

  describe('loop guard', () => {
    it('ignores bot_message subtypes without persisting', async () => {
      const res = await POST(signedRequest(fixture('bot-message.json')));

      expect(res.status).toBe(200); // 200, not 401 — the request was legitimate
      expect(h.calls).toHaveLength(0);
      expect(h.rows.size).toBe(0);
    });

    it('ignores an event whose app_id is our own app', async () => {
      const raw = JSON.stringify({
        type: 'event_callback',
        event_id: 'EvOWNAPP',
        api_app_id: OUR_APP_ID,
        event: { type: 'message', channel: 'C0BLLT9PT18', app_id: OUR_APP_ID, text: 'echo' }
      });
      const res = await POST(signedRequest(raw));
      expect(res.status).toBe(200);
      expect(h.calls).toHaveLength(0);
    });

    it('does NOT ignore a normal user message in the same channel', async () => {
      // Guards against an over-broad self-check: api_app_id is present on EVERY
      // delivery (it identifies the receiving app), so using it as the loop
      // signal would drop everything.
      const res = await POST(signedRequest(fixture('message-channels.json')));
      expect(res.status).toBe(200);
      expect(h.calls).toHaveLength(1);
    });
  });

  describe('write failure', () => {
    it('returns 500 when ingest throws, so Slack retries', async () => {
      // This is the whole reason the write is synchronous. Deferring it to after()
      // and failing there would return 200, and Slack would discard the event
      // permanently — it only retries on a FAILED delivery.
      h.failNext.value = true;
      const res = await POST(signedRequest(fixture('message-channels.json')));
      expect(res.status).toBe(500);
      expect(h.calls).toHaveLength(1); // it was attempted
      expect(h.rows.size).toBe(0); // and nothing was stored
    });
  });

  describe('persistence', () => {
    it('stores the payload verbatim', async () => {
      const raw = fixture('message-channels.json');
      await POST(signedRequest(raw));
      expect(h.calls[0].payload).toEqual(JSON.parse(raw));
    });

    it('persists every channel — no #proj- filtering at ingest', async () => {
      const raw = JSON.stringify({
        type: 'event_callback',
        event_id: 'EvRANDOMCHAN',
        event: { type: 'message', channel: 'C_UNRELATED', user: 'U1', text: 'hi' }
      });
      const res = await POST(signedRequest(raw));
      expect(res.status).toBe(200);
      expect(h.calls).toHaveLength(1);
    });
  });
});

describe('GET /api/webhooks/slack', () => {
  it('returns a helpful body rather than a framework 405', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});
