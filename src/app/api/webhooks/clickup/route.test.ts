import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLICKUP_SIGNATURE_HEADER, signClickUpRequest } from '@/features/connectors/clickup';

const SECRET = 'clickup-webhook-secret-4d1e';

const h = vi.hoisted(() => ({
  /** Mimics the (source, external_id) partial unique index. */
  rows: new Map<string, string>(),
  calls: [] as { source: string; externalId?: string | null; payload: unknown }[],
  failNext: { value: false }
}));

vi.mock('@/features/connectors/ingest', () => ({
  ingestRawEvent: async (input: {
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
  },
  findRawEventByExternalId: async () => null
}));

const { POST, GET } = await import('./route');

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', 'clickup', name), 'utf8');
}

function signedRequest(rawBody: string, opts: { secret?: string } = {}) {
  return new Request('https://example.test/api/webhooks/clickup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CLICKUP_SIGNATURE_HEADER]: signClickUpRequest({
        rawBody,
        webhookSecret: opts.secret ?? SECRET
      })
    },
    body: rawBody
  });
}

function unsignedRequest(rawBody: string, headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/webhooks/clickup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: rawBody
  });
}

describe('POST /api/webhooks/clickup', () => {
  beforeEach(() => {
    process.env.CLICKUP_WEBHOOK_SECRET = SECRET;
    h.rows.clear();
    h.calls.length = 0;
    h.failNext.value = false;
  });

  describe('signature verification', () => {
    it('accepts a correctly signed taskCreated and persists it', async () => {
      const raw = fixture('task-created.json');
      const res = await POST(signedRequest(raw));

      expect(res.status).toBe(200);
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0].source).toBe('clickup');
      expect(h.calls[0].externalId).toBe('2800763136717140857');
    });

    it('accepts a correctly signed taskStatusUpdated', async () => {
      const res = await POST(signedRequest(fixture('task-status-updated.json')));
      expect(res.status).toBe(200);
      expect(h.calls[0].externalId).toBe('2800763136717140999');
    });

    it('rejects a tampered body with 401 and does not persist', async () => {
      const raw = fixture('task-status-updated.json');
      const req = signedRequest(raw);
      // Signed the legitimate body, then swapped in the attacker's.
      const tampered = new Request(req.url, {
        method: 'POST',
        headers: req.headers,
        body: fixture('tampered.json')
      });

      const res = await POST(tampered);

      expect(res.status).toBe(401);
      expect(h.calls).toHaveLength(0);
    });

    it('rejects a missing X-Signature header with 401', async () => {
      const res = await POST(unsignedRequest(fixture('task-created.json')));
      expect(res.status).toBe(401);
      expect(h.calls).toHaveLength(0);
    });

    it('rejects a signature made with the API token instead of the webhook secret', async () => {
      const res = await POST(
        signedRequest(fixture('task-created.json'), { secret: 'pk_12345_API_TOKEN' })
      );
      expect(res.status).toBe(401);
      expect(h.calls).toHaveLength(0);
    });

    it('rejects when CLICKUP_WEBHOOK_SECRET is unset', async () => {
      delete process.env.CLICKUP_WEBHOOK_SECRET;
      const res = await POST(signedRequest(fixture('task-created.json')));
      expect(res.status).toBe(401);
      expect(h.calls).toHaveLength(0);
    });

    it('returns 400 on a signed but non-JSON body', async () => {
      const res = await POST(signedRequest('not json at all'));
      expect(res.status).toBe(400);
    });

    it('returns 401 (not 400) for an unsigned non-JSON body', async () => {
      // Ordering: signature failure takes precedence over parsing.
      const res = await POST(unsignedRequest('not json at all'));
      expect(res.status).toBe(401);
    });
  });

  describe('idempotency', () => {
    it('a retry of the same delivery does not create a second row', async () => {
      const r1 = await POST(signedRequest(fixture('task-status-updated.json')));
      const r2 = await POST(signedRequest(fixture('retry-duplicate.json')));

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200); // must still be 2xx or ClickUp keeps retrying
      expect(h.calls).toHaveLength(2);
      expect(h.calls[0].externalId).toBe(h.calls[1].externalId);
      expect(h.rows.size).toBe(1);
    });

    it('two DIFFERENT events on the same task are both stored', async () => {
      // They share task_id and webhook_id but differ in history_items[0].id.
      // If either of those were used as the key, one would be wrongly suppressed.
      await POST(signedRequest(fixture('task-created.json')));
      await POST(signedRequest(fixture('task-status-updated.json')));

      expect(h.calls).toHaveLength(2);
      expect(h.calls[0].externalId).not.toBe(h.calls[1].externalId);
      expect(h.rows.size).toBe(2);
    });

    it('passes null for an event with no history items, and still stores it', async () => {
      const res = await POST(signedRequest(fixture('task-deleted-no-history.json')));
      expect(res.status).toBe(200);
      expect(h.calls[0].externalId).toBeNull();
      expect(h.rows.size).toBe(1);
    });

    it('does not deduplicate null-key events', async () => {
      // Documented consequence: taskDeleted retries create duplicate rows. A
      // duplicate is recoverable; merging distinct events is not.
      await POST(signedRequest(fixture('task-deleted-no-history.json')));
      await POST(signedRequest(fixture('task-deleted-no-history.json')));
      expect(h.rows.size).toBe(2);
    });
  });

  describe('write failure', () => {
    it('returns 500 when ingest throws, so ClickUp retries', async () => {
      h.failNext.value = true;
      const res = await POST(signedRequest(fixture('task-created.json')));
      expect(res.status).toBe(500);
      expect(h.calls).toHaveLength(1);
      expect(h.rows.size).toBe(0);
    });
  });

  describe('persistence', () => {
    it('stores the payload verbatim', async () => {
      const raw = fixture('task-status-updated.json');
      await POST(signedRequest(raw));
      expect(h.calls[0].payload).toEqual(JSON.parse(raw));
    });

    it('does no parsing — history_items are untouched', async () => {
      const raw = fixture('task-status-updated.json');
      await POST(signedRequest(raw));
      const stored = h.calls[0].payload as { history_items: unknown[] };
      expect(stored.history_items).toEqual(JSON.parse(raw).history_items);
    });
  });
});

describe('GET /api/webhooks/clickup', () => {
  it('answers reachability checks', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});
