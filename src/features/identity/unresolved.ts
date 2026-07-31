/**
 * The unresolved queue: identities seen in events with no person link.
 *
 * ── Why this is a filtered read, not a second table ─────────────────────────
 * An unresolved identity is the SAME entity as a resolved one; only `person_id`
 * is missing. A separate table would have to move rows on resolution — losing
 * the first-seen `created_at`, needing a transaction plus a delete, and, worst,
 * it could not share `UNIQUE (source, external_id)`. The same account could then
 * exist in both tables at once, which is precisely the ambiguity this whole
 * design exists to prevent. As one table, resolving is a single UPDATE.
 *
 * It is a query helper rather than a database VIEW because a view is another
 * migration artifact to keep in step for what is one predicate. Promote it to a
 * real view if Phase 3 wants a contract that survives schema churn.
 *
 * `person_identity_unresolved_idx` (partial, WHERE person_id IS NULL) backs it.
 */

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { person, personIdentity, type IdentitySource } from '@/db/schema';

export type UnresolvedIdentity = {
  id: string;
  source: string;
  externalId: string;
  email: string | null;
  displayName: string | null;
  editorName: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

/**
 * Identities awaiting a human.
 *
 * Oldest first: the longest-unattributed account is the one costing the most
 * missing history.
 */
export async function listUnresolvedIdentities(
  opts: { source?: IdentitySource; limit?: number } = {}
): Promise<UnresolvedIdentity[]> {
  const where = opts.source
    ? and(isNull(personIdentity.personId), eq(personIdentity.source, opts.source))
    : isNull(personIdentity.personId);

  return db
    .select({
      id: personIdentity.id,
      source: personIdentity.source,
      externalId: personIdentity.externalId,
      email: personIdentity.email,
      displayName: personIdentity.displayName,
      editorName: personIdentity.editorName,
      firstSeenAt: personIdentity.createdAt,
      lastSeenAt: personIdentity.updatedAt
    })
    .from(personIdentity)
    .where(where)
    .orderBy(asc(personIdentity.createdAt))
    .limit(opts.limit ?? 200);
}

/** How many are waiting, per source — the admin badge. */
export async function countUnresolvedBySource(): Promise<{ source: string; count: number }[]> {
  const rows = await db
    .select({ source: personIdentity.source, count: sql<number>`count(*)::int` })
    .from(personIdentity)
    .where(isNull(personIdentity.personId))
    .groupBy(personIdentity.source)
    .orderBy(desc(sql`count(*)`));

  return rows;
}

/**
 * Attach an identity to a person because a HUMAN said so.
 *
 * The only way a link is created outside the email path — and the only way a
 * name-similarity suggestion may ever become a link. `linkedBy` is required: an
 * automatic link records null there, so a non-null value is what distinguishes
 * "someone decided this" from "the addresses matched", and that distinction is
 * the first thing anyone wants when an event is attributed to the wrong person.
 */
export async function linkIdentityToPerson(input: {
  identityId: string;
  personId: string;
  linkedBy: string;
}): Promise<{ linked: boolean }> {
  if (!input.linkedBy.trim()) {
    throw new Error(
      'linkIdentityToPerson requires linkedBy — a manual link must record who made it.'
    );
  }

  const updated = await db
    .update(personIdentity)
    .set({
      personId: input.personId,
      confidence: 'manual',
      linkedBy: input.linkedBy,
      linkedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(personIdentity.id, input.identityId))
    .returning({ id: personIdentity.id });

  return { linked: updated.length > 0 };
}

/**
 * Detach an identity, returning it to the queue.
 *
 * Clears confidence/linkedBy/linkedAt together with person_id, because
 * `person_identity_link_provenance_ck` rejects a row that keeps one without the
 * other — the constraint turns "unlink" into an all-or-nothing operation.
 */
export async function unlinkIdentity(identityId: string): Promise<{ unlinked: boolean }> {
  const updated = await db
    .update(personIdentity)
    .set({
      personId: null,
      confidence: null,
      linkedBy: null,
      linkedAt: null,
      updatedAt: new Date()
    })
    .where(eq(personIdentity.id, identityId))
    .returning({ id: personIdentity.id });

  return { unlinked: updated.length > 0 };
}

/** Every identity attached to one person, for the person detail view. */
export async function listIdentitiesForPerson(personId: string) {
  return db
    .select({
      id: personIdentity.id,
      source: personIdentity.source,
      externalId: personIdentity.externalId,
      email: personIdentity.email,
      displayName: personIdentity.displayName,
      confidence: personIdentity.confidence,
      linkedBy: personIdentity.linkedBy,
      linkedAt: personIdentity.linkedAt
    })
    .from(personIdentity)
    .where(eq(personIdentity.personId, personId))
    .orderBy(asc(personIdentity.source));
}

/** Resolve a person straight from a stored link, for read paths that need it. */
export async function findPersonByIdentity(source: IdentitySource, externalId: string) {
  const [row] = await db
    .select({ id: person.id, name: person.name, email: person.email })
    .from(personIdentity)
    .innerJoin(person, eq(person.id, personIdentity.personId))
    .where(and(eq(personIdentity.source, source), eq(personIdentity.externalId, externalId)))
    .limit(1);

  return row ?? null;
}
