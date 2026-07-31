/**
 * Identity resolution: which person does this external account belong to?
 *
 * ── The three-Clerk-instances rule ──────────────────────────────────────────
 * Vision, UGC and Command Centre are SEPARATE Clerk instances. A `user_id` from
 * one is an unrelated string to a `user_id` from another and they may collide.
 * Every lookup here is keyed on the PAIR (source, external_id); nothing in this
 * file ever compares an external id across sources.
 *
 * ── Email is the only automatic join key ────────────────────────────────────
 * Names are display-only. Vision's `editor_name` is a mutable list on their side
 * and is explicitly not an identity key. That leaves email, and email is
 * frequently absent: Vision and UGC both document `actor.email` as nullable, and
 * every real Vision event stored so far has `email: null`. Slack sends none at
 * all without the users:read.email scope.
 *
 * So UNRESOLVED is a normal outcome, not an error path — and unresolved
 * identities are always PERSISTED, never dropped, so the admin UI can list them.
 *
 * ⚠️ Name matching is not implemented here at any confidence level, deliberately.
 * Two people can share a display name, and a wrong auto-link silently attributes
 * one person's work to another — the kind of error nobody goes looking for.
 * Phase 3 may show name similarity as an UNVERIFIED SUGGESTION requiring
 * explicit human confirmation, which lands as confidence='manual'.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { person, personIdentity } from '@/db/schema';
import type { Resolution, ResolveInput } from './types';

/** Either the pooled client or an open transaction, so callers can compose. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Record what we saw and attach it to a person if we can.
 *
 * Steps, and ONLY these:
 *   1. EXACT      — a person_identity row already exists for (source, external_id)
 *   2. EMAIL      — case-insensitive match on person.email; creates the link so
 *                   every later event for this account short-circuits at step 1
 *   3. UNRESOLVED — stored with a null person_id, for manual linking
 */
export async function resolvePerson(
  input: ResolveInput,
  executor: Executor = db
): Promise<Resolution> {
  const email = normaliseEmail(input.email);

  // ── Persist first, always ─────────────────────────────────────────────────
  // Upsert before deciding anything, so the identity is on record even when it
  // cannot be attached. ON CONFLICT makes concurrent events for the same account
  // safe: two workers cannot both insert, and neither can lose the other's data.
  //
  // ⚠️ COALESCE, not assignment. A later event carrying `email: null` must not
  // erase an address an earlier event gave us — that would un-resolve an account
  // that had already been linked, and Vision sends null routinely.
  const [row] = await executor
    .insert(personIdentity)
    .values({
      source: input.source,
      externalId: input.externalId,
      email,
      displayName: input.displayName ?? null,
      editorName: input.editorName ?? null
    })
    .onConflictDoUpdate({
      target: [personIdentity.source, personIdentity.externalId],
      set: {
        email: sql`coalesce(excluded.${sql.raw(personIdentity.email.name)}, ${personIdentity.email})`,
        displayName: sql`coalesce(excluded.${sql.raw(personIdentity.displayName.name)}, ${personIdentity.displayName})`,
        editorName: sql`coalesce(excluded.${sql.raw(personIdentity.editorName.name)}, ${personIdentity.editorName})`,
        updatedAt: new Date()
      }
    })
    .returning({
      id: personIdentity.id,
      personId: personIdentity.personId,
      email: personIdentity.email
    });

  // ── 1. EXACT ──────────────────────────────────────────────────────────────
  if (row.personId) {
    return { status: 'resolved', confidence: 'exact', personId: row.personId, identityId: row.id };
  }

  // ── 2. EMAIL ──────────────────────────────────────────────────────────────
  // Uses the row's email rather than the input's, so an address learned from an
  // EARLIER event still resolves a later one that omitted it.
  const knownEmail = normaliseEmail(row.email);
  if (!knownEmail) {
    return { status: 'unresolved', identityId: row.id, reason: 'no_email' };
  }

  const [match] = await executor
    .select({ id: person.id })
    .from(person)
    // Matches the expression indexed by person_email_lower_idx, so this is an
    // index lookup rather than a scan.
    .where(eq(sql`lower(${person.email})`, knownEmail))
    .limit(1);

  if (!match) {
    return { status: 'unresolved', identityId: row.id, reason: 'no_person_for_email' };
  }

  // Create the link, so subsequent events short-circuit at step 1.
  //
  // The WHERE guard keeps this race-free: if a concurrent call (or a human)
  // linked the row first, this updates nothing and we return their link rather
  // than overwriting a manual decision with an automatic one.
  const [linked] = await executor
    .update(personIdentity)
    .set({
      personId: match.id,
      confidence: 'email',
      // linked_by stays null: nobody confirmed this, the address matched.
      linkedBy: null,
      linkedAt: new Date(),
      updatedAt: new Date()
    })
    .where(and(eq(personIdentity.id, row.id), isNull(personIdentity.personId)))
    .returning({ personId: personIdentity.personId });

  if (!linked?.personId) {
    const [current] = await executor
      .select({ personId: personIdentity.personId })
      .from(personIdentity)
      .where(eq(personIdentity.id, row.id))
      .limit(1);

    return current?.personId
      ? { status: 'resolved', confidence: 'exact', personId: current.personId, identityId: row.id }
      : { status: 'unresolved', identityId: row.id, reason: 'no_person_for_email' };
  }

  return { status: 'resolved', confidence: 'email', personId: linked.personId, identityId: row.id };
}

/**
 * Lowercase and trim, or null.
 *
 * Empty strings become null on purpose: a source sending `""` means "no email",
 * and storing it would make the row look resolvable when it is not.
 */
function normaliseEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}
