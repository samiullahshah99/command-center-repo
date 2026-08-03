/**
 * Extraction idempotency, against a REAL Postgres.
 *
 * ── Why a real database ─────────────────────────────────────────────────────
 * The behaviour under test IS a database behaviour: a UNIQUE index on
 * content_hash plus ON CONFLICT DO UPDATE with a deliberately narrow update set.
 * A mocked Drizzle would assert that the mock upserts, which proves nothing
 * about whether Postgres accepts the statement or whether the conflict target
 * actually matches an index.
 *
 * ⚠️ SKIPPED without DATABASE_URL. Run with `pnpm test:db`.
 *
 * The LLM is mocked — no network, no spend, and the point of the test is what
 * happens to the SECOND identical response, not what a model returns.
 *
 * Every row is namespaced by RUN and deleted afterwards. Names and emails are
 * synthetic; nothing here touches the real roster.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

// The default 5s is not enough: each case runs several full extractions, and
// each extraction is a dozen round trips to Railway over the public proxy.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const HAS_DB = Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL);
const describeDb = HAS_DB ? describe : describe.skip;

const RUN = `itest-extract-${process.pid}-${Date.now()}`;

/**
 * The mocked model response.
 *
 * Mutable so a test can change what the "second run" returns — that is how the
 * re-wording case is exercised.
 */
const model = vi.hoisted(() => ({
  text: '',
  calls: 0
}));

vi.mock('@/lib/ai/client', () => ({
  complete: async () => {
    model.calls += 1;
    return {
      text: model.text,
      model: 'mock',
      usage: { promptTokens: 8241, completionTokens: 210, estimatedCostUsd: 0.018582 }
    };
  }
}));

const ITEM = {
  description: 'Send the revised deck to the client',
  owner_name: 'Speaker A',
  due_date: '2026-08-07',
  follow_ups: [],
  confidence: 0.9,
  source_span: "I'll send the revised deck over to them by Friday, before the review."
};

const ITEM_2 = {
  description: 'Book the venue for the offsite',
  owner_name: 'Speaker B',
  due_date: null,
  follow_ups: ['confirm the headcount first'],
  confidence: 0.75,
  source_span: 'Let me get the venue booked — I can call them tomorrow morning.'
};

describeDb('extractActionItems idempotency', () => {
  let db: typeof import('@/db').db;
  let pool: typeof import('@/db').pool;
  let extractActionItems: typeof import('./extract').extractActionItems;
  let contentHash: typeof import('./extract').contentHash;

  let unifiedEventId: string;

  beforeAll(async () => {
    ({ db, pool } = await import('@/db'));
    ({ extractActionItems, contentHash } = await import('./extract'));

    const { rawEvent, transcript, unifiedEvent } = await import('@/db/schema');

    const firefliesId = `${RUN}-meeting`;

    const [raw] = await db
      .insert(rawEvent)
      .values({
        source: 'fireflies',
        externalId: `meeting.transcribed:${firefliesId}`,
        payload: { event: 'meeting.transcribed', meeting_id: firefliesId, timestamp: 0 }
      })
      .returning({ id: rawEvent.id });

    await db.insert(transcript).values({
      rawEventId: raw.id,
      firefliesId,
      title: `${RUN} weekly sync`,
      meetingDate: new Date('2026-08-03T10:00:00Z'),
      durationSeconds: 3420,
      payload: {
        speakers: [{ name: 'Speaker A' }, { name: 'Speaker B' }],
        participants: [`${RUN}-a@example.com`],
        host_email: `${RUN}-a@example.com`,
        sentences: [
          {
            speaker_name: 'Speaker A',
            text: "I'll send the revised deck over to them by Friday, before the review."
          },
          {
            speaker_name: 'Speaker B',
            text: 'Let me get the venue booked — I can call them tomorrow morning.'
          }
        ]
      }
    });

    const [event] = await db
      .insert(unifiedEvent)
      .values({
        rawEventId: raw.id,
        source: 'fireflies',
        eventType: 'meeting.transcribed',
        subjectId: firefliesId,
        occurredAt: new Date('2026-08-03T10:00:00Z'),
        normaliserVersion: 1
      })
      .returning({ id: unifiedEvent.id });

    unifiedEventId = event.id;
  });

  afterEach(async () => {
    // Between tests, not after all of them: each case asserts on row counts.
    await db.execute(
      sql`delete from candidate_action_item where unified_event_id = ${unifiedEventId}`
    );
    model.calls = 0;
  });

  afterAll(async () => {
    await db.execute(
      sql`delete from candidate_action_item where unified_event_id = ${unifiedEventId}`
    );
    await db.execute(sql`delete from unified_event where id = ${unifiedEventId}`);
    await db.execute(sql`delete from transcript where fireflies_id like ${`${RUN}%`}`);
    await db.execute(sql`delete from raw_event where external_id like ${`%${RUN}%`}`);
    await pool.end();
  });

  async function rows() {
    const r = await db.execute<{
      id: string;
      description: string;
      review_status: string;
      reviewed_by: string | null;
      content_hash: string;
      created_at: Date;
      updated_at: Date;
    }>(sql`
      select id, description, review_status, reviewed_by, content_hash, created_at, updated_at
      from candidate_action_item
      where unified_event_id = ${unifiedEventId}
      order by owner_name
    `);
    return r.rows;
  }

  it('⚠️ re-running on the same transcript UPDATES via content_hash, it does not duplicate', async () => {
    model.text = JSON.stringify({ items: [ITEM, ITEM_2] });

    const first = await extractActionItems(unifiedEventId);
    expect(first.itemsExtracted).toBe(2);
    expect(first.itemsWritten).toBe(2);
    expect(first.itemsUpdated).toBe(0);

    const afterFirst = await rows();
    expect(afterFirst).toHaveLength(2);
    const ids = afterFirst.map((r) => r.id);

    const second = await extractActionItems(unifiedEventId);
    expect(second.itemsExtracted).toBe(2);
    expect(second.itemsWritten).toBe(0);
    expect(second.itemsUpdated).toBe(2);

    const afterSecond = await rows();
    // THE ASSERTION. Two runs, two rows — not four.
    expect(afterSecond).toHaveLength(2);
    // Same rows, not replaced ones: Day 2's sync will hold these ids.
    expect(afterSecond.map((r) => r.id)).toEqual(ids);
  });

  it('a third run still leaves exactly two rows', async () => {
    model.text = JSON.stringify({ items: [ITEM, ITEM_2] });
    await extractActionItems(unifiedEventId);
    await extractActionItems(unifiedEventId);
    await extractActionItems(unifiedEventId);
    expect(await rows()).toHaveLength(2);
  });

  it('⚠️ a re-run does NOT undo a human review decision', async () => {
    // The reason review_status, reviewed_by, reviewed_at, edited_fields and
    // external_task_id are excluded from the ON CONFLICT update set. If a re-run
    // reset them, an approved item would silently return to the queue — or worse,
    // be pushed to Notion a second time.
    model.text = JSON.stringify({ items: [ITEM] });
    await extractActionItems(unifiedEventId);

    await db.execute(sql`
      update candidate_action_item
      set review_status = 'approved', reviewed_by = ${`${RUN}-reviewer`}, reviewed_at = now()
      where content_hash = ${contentHash(ITEM)}
    `);

    await extractActionItems(unifiedEventId);

    const [row] = await rows();
    expect(row.review_status).toBe('approved');
    expect(row.reviewed_by).toBe(`${RUN}-reviewer`);
  });

  it('a re-worded description updates the SAME row, because the hash is owner + source_span', async () => {
    // Models paraphrase. Hashing the description would make every re-run a fresh
    // row for a commitment that was already reviewed — the exact duplication this
    // is meant to prevent.
    model.text = JSON.stringify({ items: [ITEM] });
    await extractActionItems(unifiedEventId);
    const [before] = await rows();

    model.text = JSON.stringify({
      items: [{ ...ITEM, description: 'Email the updated slide deck to the client' }]
    });
    const second = await extractActionItems(unifiedEventId);
    expect(second.itemsUpdated).toBe(1);

    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    // The new wording did land — it is an update, not a no-op.
    expect(after[0].description).toBe('Email the updated slide deck to the client');
  });

  it('a genuinely different commitment gets its own row', async () => {
    // The other half of the guarantee: dedup must not collapse distinct items.
    model.text = JSON.stringify({ items: [ITEM] });
    await extractActionItems(unifiedEventId);
    expect(await rows()).toHaveLength(1);

    model.text = JSON.stringify({ items: [ITEM, ITEM_2] });
    await extractActionItems(unifiedEventId);
    expect(await rows()).toHaveLength(2);
  });

  it('reports token usage and cost on every run', async () => {
    model.text = JSON.stringify({ items: [] });
    const result = await extractActionItems(unifiedEventId);
    expect(result.usage.promptTokens).toBe(8241);
    expect(result.usage.completionTokens).toBe(210);
    expect(result.usage.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('an empty extraction writes nothing and is not an error', async () => {
    model.text = '{"items":[]}';
    const result = await extractActionItems(unifiedEventId);
    expect(result.itemsExtracted).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it('⚠️ a malformed model response THROWS, so the job fails loudly', async () => {
    model.text = 'I was unable to find any action items in this transcript.';
    await expect(extractActionItems(unifiedEventId)).rejects.toThrow(/not valid JSON/);
    // And nothing was written — a broken parse must not look like a quiet meeting.
    expect(await rows()).toHaveLength(0);
  });

  it('skips (does not throw) when the unified_event has no transcript', async () => {
    const { rawEvent, unifiedEvent } = await import('@/db/schema');
    const [raw] = await db
      .insert(rawEvent)
      .values({
        source: 'fireflies',
        externalId: `meeting.transcribed:${RUN}-orphan`,
        payload: {}
      })
      .returning({ id: rawEvent.id });
    const [orphan] = await db
      .insert(unifiedEvent)
      .values({
        rawEventId: raw.id,
        source: 'fireflies',
        eventType: 'meeting.transcribed',
        subjectId: `${RUN}-orphan`,
        occurredAt: new Date('2026-08-03T10:00:00Z'),
        normaliserVersion: 1
      })
      .returning({ id: unifiedEvent.id });

    const result = await extractActionItems(orphan.id);
    expect(result.skippedReason).toMatch(/no transcript/);
    // No model call: a missing transcript must not cost anything.
    expect(model.calls).toBe(0);

    await db.execute(sql`delete from unified_event where id = ${orphan.id}`);
    await db.execute(sql`delete from raw_event where id = ${raw.id}`);
  });
});
