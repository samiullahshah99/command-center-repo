import { beforeEach, describe, expect, it } from 'vitest';
import { externalIdOf } from './events';
import { CLICKUP_SIGNATURE_HEADER, signClickUpRequest, verifyClickUpRequest } from './verify';

const SECRET = 'clickup-webhook-secret-4d1e';

function headersFor(rawBody: string, opts: { secret?: string } = {}) {
  return new Headers({
    [CLICKUP_SIGNATURE_HEADER]: signClickUpRequest({
      rawBody,
      webhookSecret: opts.secret ?? SECRET
    })
  });
}

describe('verifyClickUpRequest', () => {
  beforeEach(() => {
    // Explicit: vitest.config.ts does not load .env.local.
    process.env.CLICKUP_WEBHOOK_SECRET = SECRET;
  });

  it('accepts a correctly signed request', () => {
    const body = '{"event":"taskUpdated"}';
    expect(verifyClickUpRequest({ rawBody: body, headers: headersFor(body) }).ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"event":"taskUpdated"}';
    const headers = headersFor(body);
    expect(verifyClickUpRequest({ rawBody: '{"event":"taskDeleted"}', headers })).toEqual({
      ok: false,
      reason: 'signature_mismatch'
    });
  });

  it('rejects a body re-serialised from JSON', () => {
    // ClickUp signs the exact bytes; parse+stringify changes whitespace.
    const raw = '{ "event": "taskUpdated", "task_id": "abc" }';
    const headers = headersFor(raw);
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect(reserialised).not.toBe(raw);
    expect(verifyClickUpRequest({ rawBody: reserialised, headers }).ok).toBe(false);
  });

  it('rejects a signature made with the API token instead of the webhook secret', () => {
    // The most likely real-world mistake: these are different values.
    const body = '{"event":"taskUpdated"}';
    const headers = headersFor(body, { secret: 'pk_12345_THIS_IS_THE_API_TOKEN' });
    expect(verifyClickUpRequest({ rawBody: body, headers })).toEqual({
      ok: false,
      reason: 'signature_mismatch'
    });
  });

  it('rejects a missing signature header', () => {
    expect(verifyClickUpRequest({ rawBody: '{}', headers: new Headers() })).toEqual({
      ok: false,
      reason: 'missing_signature_header'
    });
  });

  it('rejects when CLICKUP_WEBHOOK_SECRET is unset rather than crashing', () => {
    delete process.env.CLICKUP_WEBHOOK_SECRET;
    const body = '{"a":1}';
    expect(verifyClickUpRequest({ rawBody: body, headers: headersFor(body) })).toEqual({
      ok: false,
      reason: 'missing_webhook_secret'
    });
  });

  it('rejects a wrong-length signature without throwing', () => {
    const headers = new Headers({ [CLICKUP_SIGNATURE_HEADER]: 'abc' });
    expect(() => verifyClickUpRequest({ rawBody: '{}', headers })).not.toThrow();
    expect(verifyClickUpRequest({ rawBody: '{}', headers }).ok).toBe(false);
  });

  it('does NOT use a Slack-style v0: prefixed basestring', () => {
    // Guards against copy-pasting the Slack implementation: ClickUp signs the
    // raw body alone, with no version prefix and no timestamp.
    const body = '{"event":"taskUpdated"}';
    const slackStyle = signClickUpRequest({
      rawBody: `v0:1700000000:${body}`,
      webhookSecret: SECRET
    });
    const headers = new Headers({ [CLICKUP_SIGNATURE_HEADER]: slackStyle });
    expect(verifyClickUpRequest({ rawBody: body, headers }).ok).toBe(false);
  });
});

describe('externalIdOf', () => {
  it('uses history_items[0].id', () => {
    const payload = { event: 'taskUpdated', history_items: [{ id: 'HIST-1' }] };
    expect(externalIdOf(payload)).toBe('HIST-1');
  });

  it('NEVER uses webhook_id', () => {
    // webhook_id identifies the registration and is identical on every delivery.
    // Using it would collapse every ClickUp event into a single raw_event row.
    const payload = { event: 'taskUpdated', webhook_id: 'WH-1', history_items: [{ id: 'HIST-1' }] };
    expect(externalIdOf(payload)).not.toBe('WH-1');
  });

  it('NEVER uses task_id', () => {
    const payload = { event: 'taskUpdated', task_id: 'TASK-1', history_items: [{ id: 'HIST-1' }] };
    expect(externalIdOf(payload)).not.toBe('TASK-1');
  });

  it('returns null when there are no history items', () => {
    // taskDeleted may send none. Null means insert without dedup — a duplicate
    // row is recoverable, merging distinct events is not.
    expect(externalIdOf({ event: 'taskDeleted', task_id: 'T1', webhook_id: 'WH-1' })).toBeNull();
  });

  it('returns null for an empty history_items array', () => {
    expect(externalIdOf({ event: 'taskUpdated', history_items: [] })).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    expect(externalIdOf(null)).toBeNull();
    expect(externalIdOf('string')).toBeNull();
  });
});
