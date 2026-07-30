import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

// Landing table for inbound events, stored verbatim BEFORE any parsing exists.
//
// The point is that ingestion never blocks on our ability to interpret a payload:
// write it here first, parse later. That also means a parser bug is recoverable —
// flip `processed` back to false and replay, rather than having lost the event.
//
// Keep `payload` untouched. Do not normalise or strip fields on the way in.
export const rawEvent = pgTable(
  'raw_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Origin system, e.g. 'slack' | 'fireflies' | 'clickup' | 'portal'.
    source: text('source').notNull(),

    payload: jsonb('payload').notNull(),

    // The PROVIDER's event id, used for idempotency. Nullable: not every source
    // sends one, and manual/synthetic ingests have none.
    externalId: text('external_id'),

    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),

    processed: boolean('processed').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    // The access pattern this table exists for: "unprocessed events for source X".
    // Composite order matters — source first, then processed, so the index also
    // serves a source-only scan.
    index('raw_event_source_processed_idx').on(table.source, table.processed),

    // Idempotency. This is what makes `ingestRawEvent` race-free: the insert can
    // use ON CONFLICT DO NOTHING against this index, so two concurrent
    // deliveries of the same provider event cannot both land.
    //
    // PARTIAL (WHERE external_id IS NOT NULL) on purpose. In Postgres, NULLs are
    // distinct in a unique index, so without the predicate every no-external-id
    // row would still be allowed — but the partial form makes the intent explicit
    // and keeps the index smaller.
    uniqueIndex('raw_event_source_external_id_idx')
      .on(table.source, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`)
  ]
);

export type RawEvent = typeof rawEvent.$inferSelect;
export type NewRawEvent = typeof rawEvent.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────
// `payload` is intentionally z.unknown(): this table stores events verbatim
// before any parser exists. Validating it here would defeat the purpose.

/**
 * Canonical list of things that may write to raw_event.
 *
 * This is the SINGLE SOURCE OF TRUTH — `ConnectorSource` in
 * src/features/connectors/types.ts is derived from it, so the two cannot drift.
 * The column is `text`, not a Postgres enum, so adding a value here needs no
 * migration.
 *
 * ⚠️ 'portal' and 'studio' may be the same system under two names. 'portal' came
 * from PRD §6 (auto-completion signals); 'studio' is the internal backend API
 * that replaced the original Shopify integration (BACKEND_API_* in .env.example).
 * Both are listed until that is confirmed — do not assume they are distinct.
 */
export const RAW_EVENT_SOURCES = ['slack', 'clickup', 'fireflies', 'studio', 'portal'] as const;

export type RawEventSource = (typeof RAW_EVENT_SOURCES)[number];

export const insertRawEventSchema = createInsertSchema(rawEvent, {
  source: (s) => s.min(1, 'A source is required'),
  payload: z.unknown()
});

export const selectRawEventSchema = createSelectSchema(rawEvent, {
  payload: z.unknown()
});
