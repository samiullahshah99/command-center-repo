import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
    index('raw_event_source_processed_idx').on(table.source, table.processed)
  ]
);

export type RawEvent = typeof rawEvent.$inferSelect;
export type NewRawEvent = typeof rawEvent.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────
// `payload` is intentionally z.unknown(): this table stores events verbatim
// before any parser exists. Validating it here would defeat the purpose.

export const RAW_EVENT_SOURCES = ['slack', 'fireflies', 'clickup', 'portal'] as const;

export type RawEventSource = (typeof RAW_EVENT_SOURCES)[number];

export const insertRawEventSchema = createInsertSchema(rawEvent, {
  source: (s) => s.min(1, 'A source is required'),
  payload: z.unknown()
});

export const selectRawEventSchema = createSelectSchema(rawEvent, {
  payload: z.unknown()
});
