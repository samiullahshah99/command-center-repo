import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { person } from './person';

/**
 * One account, in one external system, belonging to at most one person.
 *
 * ── Why a table and not more columns on `person` ────────────────────────────
 * Vision, UGC and Command Centre run THREE SEPARATE Clerk instances. A Clerk id
 * from Vision and a Clerk id from UGC are unrelated strings that can collide,
 * so identity is the PAIR (source, external_id) and never external_id alone.
 * `person.slack_id`-style columns cannot express that: they have no source
 * discriminator, hold one id per system, and quietly invite cross-system
 * comparison. They are deprecated in favour of this table.
 *
 * ── Unresolved is a normal state, not an error ──────────────────────────────
 * `person_id` is NULLABLE on purpose. Both Vision and UGC document `actor.email`
 * as nullable ("if Clerk is briefly unreachable when we deliver"), and Slack
 * events carry no email at all, so identities routinely arrive with nothing to
 * match on. Those rows are STORED with a null person_id and surface in the
 * unresolved queue for a human to link — they are never dropped.
 */
export const personIdentity = pgTable(
  'person_identity',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * NULL means unresolved — see the note above.
     *
     * ON DELETE SET NULL, not CASCADE: deleting a person must not erase the
     * record that these accounts were ever seen. The rows fall back into the
     * unresolved queue to be re-linked, which is recoverable; cascade-deleting
     * the identity history is not.
     */
    personId: uuid('person_id').references(() => person.id, { onDelete: 'set null' }),

    /** Which system this account lives in. See IDENTITY_SOURCES. */
    source: text('source').notNull(),

    /**
     * ⚠️ OPAQUE. The source's own id — a Clerk `user_id`, a Slack `U…`, a
     * ClickUp numeric id stringified. NEVER compare this across sources.
     */
    externalId: text('external_id').notNull(),

    /** As reported by THAT source. Nullable — see the note above. */
    email: text('email'),

    /**
     * ⚠️ DISPLAY ONLY, MUTABLE, NON-AUTHORITATIVE. Never an identity key and
     * never an auto-match signal — a name collision would silently attribute
     * one person's work to another. Name similarity may be offered as an
     * unverified SUGGESTION in the admin UI, requiring explicit confirmation.
     */
    displayName: text('display_name'),

    /**
     * Vision only. Currently a fixed list on their side, but they may add,
     * remove or edit entries. Same rule as displayName: display only.
     */
    editorName: text('editor_name'),

    /**
     * How the link was established. NULL exactly when person_id is NULL.
     *
     *   'exact'  — the source itself told us, or a backfill set it first-hand
     *   'email'  — matched automatically on email
     *   'manual' — a human confirmed it
     *
     * There is deliberately NO 'name' level. Name matching is not a confidence
     * tier, it is a suggestion for a human to accept or reject.
     */
    confidence: text('confidence'),

    /** Who confirmed. NULL for an automatic link. */
    linkedBy: text('linked_by'),
    linkedAt: timestamp('linked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (table) => [
    /**
     * The three-Clerk-instances guarantee, made structural. Two different
     * systems may legitimately issue the same id string; only the pair is
     * unique. This is also the ON CONFLICT target that makes recording an
     * identity idempotent under concurrent events.
     */
    uniqueIndex('person_identity_source_external_id_key').on(table.source, table.externalId),

    /** "Show me everything linked to this person." */
    index('person_identity_person_id_idx').on(table.personId),

    /** Backs the resolver's EMAIL step and the reverse lookup. */
    index('person_identity_email_lower_idx')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} IS NOT NULL`),

    /** Backs the admin queue: identities seen in events with no person link. */
    index('person_identity_unresolved_idx')
      .on(table.source, table.createdAt)
      .where(sql`${table.personId} IS NULL`),

    check(
      'person_identity_source_ck',
      sql`${table.source} IN ('slack','clickup','vision','ugc','fireflies','portal')`
    ),

    check(
      'person_identity_confidence_ck',
      sql`${table.confidence} IS NULL OR ${table.confidence} IN ('exact','email','manual')`
    ),

    /**
     * A link and its provenance travel together.
     *
     * Without this an unresolved row could claim confidence='exact', or a linked
     * row could carry no provenance at all — and neither is detectable after the
     * fact. Structural, not a convention, because "how did this link get made?"
     * is the first question asked when an event is attributed to the wrong
     * person.
     */
    check(
      'person_identity_link_provenance_ck',
      sql`(${table.personId} IS NULL AND ${table.confidence} IS NULL AND ${table.linkedAt} IS NULL)
          OR (${table.personId} IS NOT NULL AND ${table.confidence} IS NOT NULL AND ${table.linkedAt} IS NOT NULL)`
    )
  ]
);

/**
 * ⚠️ A SUPERSET of RAW_EVENT_SOURCES: it adds 'portal', the Command Centre's own
 * Clerk instance, which issues identities but never delivers webhooks. Do not
 * substitute one list for the other.
 */
export const IDENTITY_SOURCES = [
  'slack',
  'clickup',
  'vision',
  'ugc',
  'fireflies',
  'portal'
] as const;
export type IdentitySource = (typeof IDENTITY_SOURCES)[number];

export const IDENTITY_CONFIDENCE = ['exact', 'email', 'manual'] as const;
export type IdentityConfidence = (typeof IDENTITY_CONFIDENCE)[number];

export type PersonIdentity = typeof personIdentity.$inferSelect;
export type NewPersonIdentity = typeof personIdentity.$inferInsert;

// ── Zod ─────────────────────────────────────────────────────────────────────

export const insertPersonIdentitySchema = createInsertSchema(personIdentity, {
  // Overriding a column that has a default makes it REQUIRED on insert unless
  // .optional() is added — the override replaces the whole type, optionality
  // included. This bit us on status/auto_complete_rule already.
  source: z.enum(IDENTITY_SOURCES),
  externalId: (s) => s.min(1, 'external_id is required'),
  confidence: z.enum(IDENTITY_CONFIDENCE).nullish()
});

export const selectPersonIdentitySchema = createSelectSchema(personIdentity);
