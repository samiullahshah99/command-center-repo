/**
 * The completion engine against a REAL Postgres.
 *
 * ⚠️ THESE ARE DATABASE PROPERTIES AND CANNOT BE MOCKED. The whole idempotency
 * story is one unique index plus `ON CONFLICT DO NOTHING`; a mocked Drizzle would
 * assert that the mock does what the mock does. The extraction idempotency test
 * already made that mistake once — it mocks the model with a FIXED response, so it
 * proves Postgres upserts correctly and proves nothing about whether the input is
 * stable (CLAUDE.md records this as "a true test of the wrong thing").
 *
 * ⚠️ SKIPPED without DATABASE_URL. Run with `pnpm test:db`.
 * Rows are namespaced by RUN and removed afterwards.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const HAS_DB = Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL);
const describeDb = HAS_DB ? describe : describe.skip;

const RUN = `itest-completion-${process.pid}-${Date.now()}`;

describeDb('completion_event idempotency', () => {
  let db: typeof import('@/db').db;
  let pool: typeof import('@/db').pool;
  let recordEvidence: typeof import('@/lib/evidence').recordEvidence;
  let recordManualCheckoff: typeof import('@/lib/evidence').recordManualCheckoff;

  let personId: string;
  let taskId: string;

  beforeAll(async () => {
    ({ db, pool } = await import('@/db'));
    ({ recordEvidence, recordManualCheckoff } = await import('@/lib/evidence'));

    const [p] = await db
      .execute(sql`insert into person (name) values (${`${RUN}-owner`}) returning id`)
      .then((r) => (r as unknown as { rows: { id: string }[] }).rows);
    personId = p.id;

    const [t] = await db
      .execute(
        sql`insert into recurring_task (owner_person_id, cadence, auto_complete_rule, fallback_manual)
          values (${personId}, 'daily', '{}'::jsonb, true) returning id`
      )
      .then((r) => (r as unknown as { rows: { id: string }[] }).rows);
    taskId = t.id;
  });

  afterAll(async () => {
    // completion_event cascades from recurring_task, which cascades from person.
    await db.execute(sql`delete from person where name like ${`${RUN}%`}`);
    await pool.end();
  });

  const WINDOW = '2026-08-12';

  it('records a completion once', async () => {
    const result = await recordEvidence({
      recurringTaskId: taskId,
      windowStart: WINDOW,
      signal: 'standup_posted',
      evidenceSource: 'slack',
      evidenceRef: 'unified-event-1',
      attribution: 'attributed',
      completedAt: new Date('2026-08-12T09:00:00Z')
    });

    expect(result.recorded).toBe(true);
    expect(result.id).toBeTruthy();
  });

  /**
   * ⚠️ THE SAME SIGNAL TWICE — a queue redelivery, a provider retry, or a
   * `renormalise` replay. One row, and the second call reports `recorded: false`
   * rather than throwing.
   */
  it('a second identical signal in the same window writes NOTHING', async () => {
    const second = await recordEvidence({
      recurringTaskId: taskId,
      windowStart: WINDOW,
      signal: 'standup_posted',
      evidenceSource: 'slack',
      evidenceRef: 'unified-event-1',
      attribution: 'attributed',
      completedAt: new Date('2026-08-12T09:00:00Z')
    });

    expect(second.recorded).toBe(false);
    expect(second.id).toBeNull();

    const rows = await db.execute(
      sql`select count(*)::int as n from completion_event where recurring_task_id = ${taskId}`
    );
    expect((rows as unknown as { rows: { n: number }[] }).rows[0].n).toBe(1);
  });

  /**
   * ⚠️⚠️ `DO NOTHING`, NOT `DO UPDATE` — the property the design is emphatic about
   * (§3.4). A DIFFERENT, later signal in the same window must leave the FIRST
   * evidence pointer completely intact. `DO UPDATE` would let a weaker later
   * signal overwrite a stronger earlier one, and the row is append-only.
   */
  it('a DIFFERENT signal in the same window leaves the first evidence intact', async () => {
    const later = await recordEvidence({
      recurringTaskId: taskId,
      windowStart: WINDOW,
      signal: 'a_completely_different_signal',
      evidenceSource: 'vision',
      evidenceRef: 'unified-event-999',
      attribution: 'attributed',
      completedAt: new Date('2026-08-12T18:00:00Z')
    });

    expect(later.recorded).toBe(false);

    const rows = await db.execute(
      sql`select signal, evidence_source, evidence_ref, completed_at
          from completion_event where recurring_task_id = ${taskId}`
    );
    const stored = (
      rows as unknown as {
        rows: { signal: string; evidence_source: string; evidence_ref: string }[];
      }
    ).rows;

    expect(stored).toHaveLength(1);
    // Every field is still the FIRST write's.
    expect(stored[0].signal).toBe('standup_posted');
    expect(stored[0].evidence_source).toBe('slack');
    expect(stored[0].evidence_ref).toBe('unified-event-1');
  });

  it('a different WINDOW is a different row', async () => {
    const next = await recordEvidence({
      recurringTaskId: taskId,
      windowStart: '2026-08-13',
      signal: 'standup_posted',
      evidenceSource: 'slack',
      evidenceRef: 'unified-event-2',
      attribution: 'attributed',
      completedAt: new Date('2026-08-13T09:00:00Z')
    });

    expect(next.recorded).toBe(true);
  });

  /**
   * ⚠️ An unattributed completion must never carry a person id anywhere. The only
   * pointer it holds is the EVENT id — writing the owner in would fabricate the
   * one fact the ledger exists to record.
   */
  it('an unattributed completion carries an event id, never a person id', async () => {
    await recordEvidence({
      recurringTaskId: taskId,
      windowStart: '2026-08-14',
      signal: 'recap_delivered',
      evidenceSource: 'fireflies',
      evidenceRef: 'unified-event-3',
      completedAt: new Date('2026-08-14T09:00:00Z'),
      attribution: 'unattributed'
    });

    const rows = await db.execute(
      sql`select attribution, evidence_ref from completion_event
          where recurring_task_id = ${taskId} and window_start = '2026-08-14'`
    );
    const row = (rows as unknown as { rows: { attribution: string; evidence_ref: string }[] })
      .rows[0];

    expect(row.attribution).toBe('unattributed');
    expect(row.evidence_ref).toBe('unified-event-3');
    expect(row.evidence_ref).not.toBe(personId);
  });

  /**
   * ⚠️ A manual check-off is a NORMAL write through the same index, so it wins its
   * window permanently (§7 decision 6). `evidence_source = 'manual'` is the
   * honest-degradation marker, and `evidence_ref` is the ACTING person.
   */
  it('a manual check-off is marked manual and cannot be superseded by a later signal', async () => {
    const manual = await recordManualCheckoff({
      recurringTaskId: taskId,
      windowStart: '2026-08-15',
      actingPersonId: personId,
      completedAt: new Date('2026-08-15T09:00:00Z')
    });
    expect(manual.recorded).toBe(true);

    // The real signal turns up afterwards. Append-only: it does not overwrite.
    const late = await recordEvidence({
      recurringTaskId: taskId,
      windowStart: '2026-08-15',
      signal: 'standup_posted',
      evidenceSource: 'slack',
      evidenceRef: 'unified-event-4',
      attribution: 'attributed',
      completedAt: new Date('2026-08-15T17:00:00Z')
    });
    expect(late.recorded).toBe(false);

    const rows = await db.execute(
      sql`select signal, evidence_source, evidence_ref from completion_event
          where recurring_task_id = ${taskId} and window_start = '2026-08-15'`
    );
    const row = (
      rows as unknown as {
        rows: { signal: string; evidence_source: string; evidence_ref: string }[];
      }
    ).rows[0];

    expect(row.signal).toBe('manual_checkoff');
    expect(row.evidence_source).toBe('manual');
    // The acting person, recorded even though they are the owner.
    expect(row.evidence_ref).toBe(personId);
  });

  /** The unique index is the real guarantee; prove it exists and is UNIQUE. */
  it('the unique index that enforces all of the above actually exists', async () => {
    const rows = await db.execute(
      sql`select indexdef from pg_indexes
          where tablename = 'completion_event' and indexname = 'completion_event_task_window_key'`
    );
    const defs = (rows as unknown as { rows: { indexdef: string }[] }).rows;

    expect(defs).toHaveLength(1);
    expect(defs[0].indexdef).toMatch(/UNIQUE/i);
    expect(defs[0].indexdef).toMatch(/recurring_task_id/);
    expect(defs[0].indexdef).toMatch(/window_start/);
  });
});
