/**
 * Per-source normalisers, no database.
 *
 * ⚠️ Every payload below is the REAL shape captured from raw_event, with PII
 * replaced: ids are shortened or synthetic, emails use example.com, names are
 * invented. The STRUCTURE — field names, nesting, and especially the timestamp
 * encodings — is verbatim, because that is what these tests exist to pin.
 *
 * The normalisers are pure, so this runs in the default `pnpm test` lane.
 */

import { describe, expect, it } from 'vitest';
import { NORMALISERS } from './index';
import { fromEpochMillis, fromEpochSecondsFloat, fromIso } from './time';

const RECEIVED_AT = new Date('2026-08-01T09:00:00.000Z');
const ctx = { receivedAt: RECEIVED_AT };

const run = (source: keyof typeof NORMALISERS, payload: unknown) =>
  NORMALISERS[source].normalise(payload, ctx);

// ── Real payload shapes ─────────────────────────────────────────────────────

const VISION_EVENT = {
  id: 'ea416f04-d5e9-4c80-8f09-73df19c5a875',
  event: 'moodboard.created',
  occurred_at: '2026-07-31T15:01:12.413115Z',
  source: 'vision',
  environment: 'production',
  schema_version: 1,
  actor: {
    name: 'Test Person',
    role: 'admin',
    email: null,
    user_id: 'user_3FTESTCLERKIDVISION',
    editor_name: null
  },
  subject: { id: 'dd4424c3-14e3-4f63-9cd8-379af11a4f1c', type: 'moodboard', label: 'Week 4' },
  metadata: { template: 'week', parent_board_id: null }
};

const UGC_EVENT = {
  id: 'evt_test_35e04758f6644b22',
  type: 'creator.approved',
  occurred_at: '2026-07-31T13:06:10.892563Z',
  source: 'ugc-management',
  actor: { id: 'user_2TESTCLERKIDUGC', name: 'Test Person', email: 'test.person@example.com' },
  entity: { type: 'creator', id: 'e2f0b3c4-5d6e-7f8a-9b0c-1d2e3f4a5b6c' },
  summary: 'Approved a creator',
  metadata: { tier: 'gold' }
};

const UGC_TEST_PING = {
  id: 'evt_test_ping',
  type: 'test.ping',
  occurred_at: '2026-07-31T18:00:00Z',
  source: 'ugc-management',
  actor: { id: 'system', name: null, email: null },
  entity: null,
  summary: 'Test event from Control Center Webhook settings',
  metadata: { test: true }
};

const SLACK_MESSAGE = {
  type: 'event_callback',
  event_id: 'Ev0TESTSLACKEVENT',
  event_time: 1785508463,
  team_id: 'T0TESTTEAMID',
  api_app_id: 'A0TESTAPPID',
  event: {
    ts: '1785508463.300799',
    team: 'T0TESTTEAMID',
    text: 'command center testing',
    type: 'message',
    user: 'U0TESTSLACKUSER',
    channel: 'C0TESTCHANNEL',
    event_ts: '1785508463.300799',
    channel_type: 'group',
    client_msg_id: 'f9bacdfe-ca61-428b-806f-790a1850c8fc'
  }
};

const CLICKUP_TASK_UPDATED = {
  event: 'taskUpdated',
  task_id: '86eyf1rk1',
  team_id: '90182930145',
  webhook_id: 'b2322908-49a8-4388-8796-8cac3c128ae1',
  history_items: [
    {
      id: '5195800349454056527',
      date: '1785489973755',
      type: 1,
      field: 'status',
      user: {
        id: 228140872,
        role: 1,
        email: 'test.person@example.com',
        initials: 'TP',
        username: 'Test Person'
      },
      before: { status: 'to do' },
      after: { status: 'in progress' }
    }
  ]
};

const FIREFLIES_EVENT = {
  event: 'meeting.transcribed',
  timestamp: 1785514180451,
  meeting_id: '01KYTESTMEETINGID0000000'
};

// ── Timestamp handling — the five wire formats ──────────────────────────────

describe('time parsing', () => {
  it('Vision/UGC ISO 8601 with microseconds', () => {
    expect(fromIso('2026-07-31T15:01:12.413115Z')?.toISOString()).toBe('2026-07-31T15:01:12.413Z');
  });

  it('Fireflies epoch millis as a NUMBER', () => {
    expect(fromEpochMillis(1785514180451)?.getTime()).toBe(1785514180451);
  });

  it('⚠️ ClickUp epoch millis as a STRING — new Date(s) alone would be Invalid Date', () => {
    expect(new Date('1785489973755' as unknown as number).getTime()).toBeNaN();
    expect(fromEpochMillis('1785489973755')?.getTime()).toBe(1785489973755);
  });

  it('⚠️ Slack epoch SECONDS float — sub-second precision survives', () => {
    // event_time (1785508463) would round this to the second.
    expect(fromEpochSecondsFloat('1785508463.300799')?.getTime()).toBe(1785508463301);
  });

  it('⚠️ rejects seconds fed to the millis parser — it would land in 1970', () => {
    expect(fromEpochMillis(1785508463)).toBeNull();
  });

  it('⚠️ rejects millis fed to the seconds parser — it would land in the year 58,000', () => {
    expect(fromEpochSecondsFloat(1785514180451)).toBeNull();
  });

  it('rejects empty, null and unparseable values rather than inventing a date', () => {
    for (const v of ['', '   ', null, undefined, 'not a date', {}]) {
      expect(fromIso(v)).toBeNull();
      expect(fromEpochMillis(v)).toBeNull();
    }
  });
});

// ── Vision ──────────────────────────────────────────────────────────────────

describe('vision normaliser', () => {
  it('maps the real envelope', () => {
    const [e] = run('vision', VISION_EVENT);
    expect(e.eventType).toBe('moodboard.created');
    expect(e.occurredAt.toISOString()).toBe('2026-07-31T15:01:12.413Z');
    expect(e.occurredAtSource).toBe('payload');
    expect(e.subjectType).toBe('moodboard');
    expect(e.subjectLabel).toBe('Week 4');
    expect(e.identity).toMatchObject({ source: 'vision', externalId: 'user_3FTESTCLERKIDVISION' });
  });

  it('⚠️ a null actor.email is carried through, not treated as an error', () => {
    // True of every real Vision event so far.
    const [e] = run('vision', VISION_EVENT);
    expect(e.identity?.email).toBeNull();
  });

  it('captures editor_name for display without making it an identity key', () => {
    const [e] = run('vision', {
      ...VISION_EVENT,
      actor: { ...VISION_EVENT.actor, editor_name: 'Some Editor' }
    });
    expect(e.identity?.editorName).toBe('Some Editor');
    // Identity is still keyed on user_id alone.
    expect(e.identity?.externalId).toBe('user_3FTESTCLERKIDVISION');
  });

  it('stores an unknown event type rather than rejecting it', () => {
    const [e] = run('vision', { ...VISION_EVENT, event: 'brief.some_future_thing' });
    expect(e.eventType).toBe('brief.some_future_thing');
  });

  it('does NOT filter on environment — preview and development are kept', () => {
    for (const env of ['preview', 'development']) {
      const [e] = run('vision', { ...VISION_EVENT, environment: env });
      expect(e).toBeDefined();
      expect(e.metadata.environment).toBe(env);
    }
  });

  it('falls back to received_at and records that it did', () => {
    const [e] = run('vision', { ...VISION_EVENT, occurred_at: 'nonsense' });
    expect(e.occurredAt).toEqual(RECEIVED_AT);
    expect(e.occurredAtSource).toBe('received_at');
  });

  it('tolerates a null subject', () => {
    const [e] = run('vision', { ...VISION_EVENT, subject: null });
    expect(e.subjectType).toBeNull();
    expect(e.subjectId).toBeNull();
  });
});

// ── UGC ─────────────────────────────────────────────────────────────────────

describe('ugc normaliser', () => {
  it('⚠️ reads `type`/`actor.id`/`entity`, NOT Vision’s `event`/`user_id`/`subject`', () => {
    // Copying the Vision normaliser here would parse nothing and report success.
    const [e] = run('ugc', UGC_EVENT);
    expect(e.eventType).toBe('creator.approved');
    expect(e.identity?.externalId).toBe('user_2TESTCLERKIDUGC');
    expect(e.subjectType).toBe('creator');
  });

  it('carries the email through, so UGC can resolve automatically', () => {
    const [e] = run('ugc', UGC_EVENT);
    expect(e.identity?.email).toBe('test.person@example.com');
  });

  it('⚠️ actor.id "system" is NOT recorded as an identity', () => {
    // It would sit in the manual-linking queue forever, belonging to nobody.
    const [e] = run('ugc', UGC_TEST_PING);
    expect(e.identity).toBeNull();
    expect(e.eventType).toBe('test.ping');
  });

  it('keeps summary in metadata, not subject_label — it describes the event', () => {
    const [e] = run('ugc', UGC_EVENT);
    expect(e.subjectLabel).toBeNull();
    expect(e.metadata.summary).toBe('Approved a creator');
  });
});

// ── Slack ───────────────────────────────────────────────────────────────────

describe('slack normaliser', () => {
  it('⚠️ uses the INNER event.type, not the outer "event_callback"', () => {
    const [e] = run('slack', SLACK_MESSAGE);
    expect(e.eventType).toBe('message');
  });

  it('uses event.ts, keeping sub-second precision', () => {
    const [e] = run('slack', SLACK_MESSAGE);
    expect(e.occurredAt.getTime()).toBe(1785508463301);
    expect(e.occurredAtSource).toBe('payload');
  });

  it('⚠️ produces NO email — Slack sends none on the envelope', () => {
    const [e] = run('slack', SLACK_MESSAGE);
    expect(e.identity).toMatchObject({ source: 'slack', externalId: 'U0TESTSLACKUSER' });
    expect(e.identity?.email).toBeNull();
  });

  it('app_mention and message on the same ts are DIFFERENT event types', () => {
    // Slack fires both for one message; they arrive as separate raw_events.
    const [msg] = run('slack', SLACK_MESSAGE);
    const [mention] = run('slack', {
      ...SLACK_MESSAGE,
      event_id: 'Ev0TESTMENTION',
      event: { ...SLACK_MESSAGE.event, type: 'app_mention' }
    });
    expect(msg.eventType).toBe('message');
    expect(mention.eventType).toBe('app_mention');
    expect(msg.occurredAt).toEqual(mention.occurredAt);
  });

  it('does not copy message text into metadata', () => {
    const [e] = run('slack', SLACK_MESSAGE);
    expect(JSON.stringify(e.metadata)).not.toContain('command center testing');
  });

  it('returns nothing for a payload with no inner event block', () => {
    expect(run('slack', { type: 'event_callback', event_id: 'Ev1' })).toEqual([]);
  });
});

// ── ClickUp ─────────────────────────────────────────────────────────────────

describe('clickup normaliser', () => {
  it('maps the real envelope and stringifies the numeric user id', () => {
    const [e] = run('clickup', CLICKUP_TASK_UPDATED);
    expect(e.eventType).toBe('taskUpdated');
    expect(e.subjectType).toBe('task');
    expect(e.subjectId).toBe('86eyf1rk1');
    // ⚠️ number in the payload, string everywhere downstream.
    expect(e.identity?.externalId).toBe('228140872');
    expect(typeof e.identity?.externalId).toBe('string');
  });

  it('carries the inline email — the only source that does', () => {
    const [e] = run('clickup', CLICKUP_TASK_UPDATED);
    expect(e.identity?.email).toBe('test.person@example.com');
  });

  it('parses the millis-as-string date', () => {
    const [e] = run('clickup', CLICKUP_TASK_UPDATED);
    expect(e.occurredAt.getTime()).toBe(1785489973755);
  });

  it('⚠️ emits ONE event per history_item, with increasing source_seq', () => {
    // ClickUp can batch. Collapsing to one row would lose the other changes.
    const batched = {
      ...CLICKUP_TASK_UPDATED,
      history_items: [
        CLICKUP_TASK_UPDATED.history_items[0],
        {
          ...CLICKUP_TASK_UPDATED.history_items[0],
          id: '999',
          field: 'assignee',
          date: '1785489999999'
        }
      ]
    };
    const events = run('clickup', batched);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.sourceSeq)).toEqual([0, 1]);
    expect(events[1].metadata.field).toBe('assignee');
    expect(events[1].occurredAt.getTime()).toBe(1785489999999);
  });

  it('handles taskDeleted, which carries no history_items at all', () => {
    const [e] = run('clickup', {
      event: 'taskDeleted',
      task_id: '86e',
      team_id: '9',
      webhook_id: 'w'
    });
    expect(e.eventType).toBe('taskDeleted');
    expect(e.identity).toBeNull();
    expect(e.occurredAtSource).toBe('received_at');
  });

  it('does not mirror the task title — ClickUp is the system of record', () => {
    const [e] = run('clickup', CLICKUP_TASK_UPDATED);
    expect(e.subjectLabel).toBeNull();
  });
});

// ── Fireflies ───────────────────────────────────────────────────────────────

describe('fireflies normaliser', () => {
  it('maps the v2 envelope', () => {
    const [e] = run('fireflies', FIREFLIES_EVENT);
    expect(e.eventType).toBe('meeting.transcribed');
    expect(e.subjectType).toBe('meeting');
    expect(e.subjectId).toBe('01KYTESTMEETINGID0000000');
    expect(e.occurredAt.getTime()).toBe(1785514180451);
  });

  it('⚠️ has NO actor — the webhook carries none', () => {
    const [e] = run('fireflies', FIREFLIES_EVENT);
    expect(e.identity).toBeNull();
  });

  it('flags a test delivery so downstream never needs the magic id', () => {
    const [e] = run('fireflies', {
      event: 'test',
      timestamp: 1785510895435,
      meeting_id: 'test_00000000'
    });
    expect(e.metadata.isTestDelivery).toBe(true);
  });

  it('⚠️ REJECTS the deprecated v1 shape rather than half-mapping it', () => {
    // { meetingId, eventType } is what the public docs still describe.
    expect(run('fireflies', { meetingId: '01KY', eventType: 'Transcription completed' })).toEqual(
      []
    );
  });
});

// ── Shared behaviour ────────────────────────────────────────────────────────

describe('every normaliser', () => {
  const sources = Object.keys(NORMALISERS) as (keyof typeof NORMALISERS)[];

  it.each(sources)('%s returns [] for a non-object payload rather than throwing', (source) => {
    for (const junk of [null, undefined, 'string', 42, []]) {
      expect(run(source, junk)).toEqual([]);
    }
  });

  it.each(sources)('%s returns [] for an empty object', (source) => {
    expect(run(source, {})).toEqual([]);
  });

  it.each(sources)('%s declares a source matching its registry key', (source) => {
    expect(NORMALISERS[source].source).toBe(source);
  });
});
