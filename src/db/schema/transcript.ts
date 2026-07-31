import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { rawEvent } from './raw-event';

/**
 * A meeting transcript FETCHED from Fireflies.
 *
 * ── Why this is not in raw_event ────────────────────────────────────────────
 * `raw_event` means "a provider pushed this to us and we stored it verbatim".
 * A transcript is PULLED — the webhook only carries `{ meetingId, eventType,
 * clientReferenceId }`, so the content is fetched separately over GraphQL.
 *
 * Keeping them apart means raw_event stays a faithful, immutable record of what
 * arrived, while a transcript can be re-fetched and updated independently. This
 * is also the pattern for the next pull-based enrichment (ClickUp task detail,
 * Studio stats), which is why the separation matters beyond Fireflies.
 */
export const transcript = pgTable(
  'transcript',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The raw_event whose webhook triggered this fetch. Nullable because a
     * backfill via getTranscripts() has no originating event.
     * onDelete: 'set null' — the transcript outlives the event that announced it.
     */
    rawEventId: uuid('raw_event_id').references(() => rawEvent.id, { onDelete: 'set null' }),

    /**
     * Fireflies' transcript id — the same value their webhook calls `meetingId`;
     * the two are interchangeable on their platform.
     *
     * UNIQUE, which is what makes the fetch idempotent: a retried job or a
     * backfill that re-encounters the meeting updates this row rather than
     * inserting a duplicate.
     */
    firefliesId: text('fireflies_id').notNull().unique(),

    // Promoted from the payload for querying and display. Everything else stays
    // in `payload` — these are the fields a list view needs without parsing JSON.
    title: text('title'),
    meetingDate: timestamp('meeting_date', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),

    /**
     * The complete GraphQL response for this transcript, verbatim — speakers,
     * sentences, summary, analytics.
     *
     * Stored whole rather than normalised into a `transcript_sentence` table:
     * nothing queries per-speaker yet, and Postgres TOASTs a payload this size
     * out of the main row so it costs nothing until read.
     */
    payload: jsonb('payload').notNull(),

    /** When we successfully fetched it. Updated on re-fetch. */
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    // "Which transcripts came from this event?" — the provenance lookup.
    index('transcript_raw_event_id_idx').on(table.rawEventId),
    // "Recent meetings first" — the obvious list view.
    index('transcript_meeting_date_idx').on(table.meetingDate)
  ]
);

export type Transcript = typeof transcript.$inferSelect;
export type NewTranscript = typeof transcript.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────
// `payload` is z.unknown(): the transcript envelope is validated by the client's
// own schema at fetch time (src/features/connectors/fireflies/schemas.ts).
// Re-validating here would duplicate that contract in two places.

export const insertTranscriptSchema = createInsertSchema(transcript, {
  firefliesId: (s) => s.min(1, 'A Fireflies transcript id is required'),
  payload: z.unknown()
});

export const selectTranscriptSchema = createSelectSchema(transcript, {
  payload: z.unknown()
});
