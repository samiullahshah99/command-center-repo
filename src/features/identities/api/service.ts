// ============================================================
// Identities Service — Data Access Layer
// ============================================================
// Pattern 1, as in src/features/people/api/service.ts: Server Actions + ORM.
//
// 'use server' is REQUIRED. queries.ts is consumed on both sides of the SSR
// handoff — the server prefetches, and every `shallow: true` nuqs filter change
// re-runs the same queryFn in the BROWSER, where Drizzle and `pg` cannot run.
//
// Every export must be an async function ('use server' contract). Types live in
// ./types.ts for that reason.
// ============================================================

'use server';

import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { currentUser } from '@clerk/nextjs/server';
import { db } from '@/db';
import { person, personIdentity, unifiedEvent } from '@/db/schema';
import { attributeEventsForIdentity } from '@/features/normalise';
import {
  createPersonFromIdentitySchema,
  linkIdentitySchema,
  unlinkIdentitySchema
} from '../schemas/identity';
import type {
  IdentityFilters,
  IdentitySuggestionsResponse,
  LinkedIdentityRow,
  MatchSuggestion,
  MutationResult,
  PersonOption,
  UnresolvedIdentitiesResponse
} from './types';

/**
 * Who is doing this, for the audit trail.
 *
 * Prefers the email over the Clerk id: `linked_by` is read by humans months
 * later when asking "who decided this?", and `user_2abc…` answers that badly.
 */
async function actorLabel(): Promise<string> {
  const u = await currentUser();
  return (
    u?.primaryEmailAddress?.emailAddress ??
    u?.emailAddresses?.[0]?.emailAddress ??
    u?.id ??
    'unknown'
  );
}

/** Events attributed to each identity, as a subquery-friendly correlated count. */
const eventCountSql = sql<number>`(
  select count(*)::int from ${unifiedEvent}
  where ${unifiedEvent.personIdentityId} = ${personIdentity.id}
)`;

function buildWhere(filters: IdentityFilters) {
  // Unresolved is defined by a null person_id — the same predicate the partial
  // index person_identity_unresolved_idx is built on.
  const clauses = [isNull(personIdentity.personId)];

  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    const match = or(
      ilike(personIdentity.externalId, q),
      ilike(personIdentity.email, q),
      ilike(personIdentity.displayName, q)
    );
    if (match) clauses.push(match);
  }

  if (filters.sources?.trim()) {
    const list = filters.sources
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) clauses.push(inArray(personIdentity.source, list));
  }

  return and(...clauses);
}

function buildOrderBy(sort?: string) {
  const sortable = {
    source: personIdentity.source,
    externalId: personIdentity.externalId,
    email: personIdentity.email,
    displayName: personIdentity.displayName,
    firstSeenAt: personIdentity.createdAt
  } as const;

  try {
    const parsed = sort ? (JSON.parse(sort) as { id: string; desc: boolean }[]) : [];
    const order = parsed
      .filter((s) => s.id in sortable)
      .map((s) =>
        s.desc
          ? desc(sortable[s.id as keyof typeof sortable])
          : asc(sortable[s.id as keyof typeof sortable])
      );
    if (order.length > 0) return order;
  } catch {
    // A malformed sort param must not 500 the page.
  }
  // Oldest first: the longest-unattributed identity is costing the most history.
  return [asc(personIdentity.createdAt)];
}

export async function getUnresolvedIdentities(
  filters: IdentityFilters
): Promise<UnresolvedIdentitiesResponse> {
  const limit = filters.limit ?? 10;
  const offset = ((filters.page ?? 1) - 1) * limit;
  const where = buildWhere(filters);

  const rows = await db
    .select({
      id: personIdentity.id,
      source: personIdentity.source,
      externalId: personIdentity.externalId,
      email: personIdentity.email,
      displayName: personIdentity.displayName,
      editorName: personIdentity.editorName,
      firstSeenAt: personIdentity.createdAt,
      lastSeenAt: personIdentity.updatedAt,
      eventCount: eventCountSql
    })
    .from(personIdentity)
    .where(where)
    .orderBy(...buildOrderBy(filters.sort))
    .limit(limit)
    .offset(offset);

  const [totals] = await db.select({ value: count() }).from(personIdentity).where(where);

  return {
    identities: rows,
    total_identities: Number(totals?.value ?? 0),
    offset,
    limit
  };
}

/** Sources that currently have unresolved identities, for the filter dropdown. */
export async function getIdentitySourceOptions(): Promise<{ value: string; label: string }[]> {
  const rows = await db
    .selectDistinct({ source: personIdentity.source })
    .from(personIdentity)
    .where(isNull(personIdentity.personId))
    .orderBy(asc(personIdentity.source));

  return rows.map((r) => ({ value: r.source, label: r.source }));
}

/** The roster, for the link dialog's person picker. */
export async function getPersonOptions(): Promise<PersonOption[]> {
  const rows = await db
    .select({ value: person.id, label: person.name, email: person.email })
    .from(person)
    .orderBy(asc(person.name));
  return rows;
}

// ── Suggestions ─────────────────────────────────────────────────────────────

/** Cheap normalised-edit-distance similarity, 0–1. No dependency needed. */
function similarity(a: string, b: string): number {
  const s = a.toLowerCase().trim();
  const t = b.toLowerCase().trim();
  if (!s || !t) return 0;
  if (s === t) return 1;

  const rows = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 0; j <= t.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)
      );
    }
  }
  return 1 - rows[s.length][t.length] / Math.max(s.length, t.length);
}

/**
 * Candidate people for an unresolved identity.
 *
 * ⚠️ SUGGESTIONS ONLY. Nothing here is ever applied automatically, at any score.
 * A name collision would silently attribute one person's work to another and
 * nobody goes looking for that, so every name-derived candidate is returned with
 * `verified: false` and the UI labels it as unverified. Only the human links.
 *
 * The scores order the list; they gate nothing.
 */
export async function getIdentitySuggestions(
  identityId: string
): Promise<IdentitySuggestionsResponse> {
  const [identity] = await db
    .select({
      id: personIdentity.id,
      source: personIdentity.source,
      externalId: personIdentity.externalId,
      email: personIdentity.email,
      displayName: personIdentity.displayName,
      editorName: personIdentity.editorName,
      firstSeenAt: personIdentity.createdAt,
      lastSeenAt: personIdentity.updatedAt,
      eventCount: eventCountSql
    })
    .from(personIdentity)
    .where(eq(personIdentity.id, identityId))
    .limit(1);

  if (!identity) return { identity: null, suggestions: [] };

  const roster = await db
    .select({ id: person.id, name: person.name, email: person.email })
    .from(person)
    .orderBy(asc(person.name));

  const identityEmail = identity.email?.toLowerCase().trim() ?? null;
  const identityLocal = identityEmail?.split('@')[0] ?? null;
  const identityName = identity.displayName ?? identity.editorName ?? null;

  const suggestions: MatchSuggestion[] = [];

  for (const p of roster) {
    const personEmail = p.email?.toLowerCase().trim() ?? null;
    const base = { personId: p.id, personName: p.name, personEmail: p.email };

    // 1. Exact email — the one signal the resolver itself would act on. If this
    //    fires here, the identity predates the person's email being set.
    if (identityEmail && personEmail && identityEmail === personEmail) {
      suggestions.push({
        ...base,
        kind: 'email-exact',
        score: 100,
        reason: `Email matches exactly (${p.email})`,
        verified: true
      });
      continue;
    }

    // 2. Same local part, different domain — e.g. an @gmail vs a work address.
    if (identityLocal && personEmail && personEmail.split('@')[0] === identityLocal) {
      suggestions.push({
        ...base,
        kind: 'email-local-part',
        score: 80,
        reason: `Email local part matches (${identityLocal}@… vs ${p.email})`,
        verified: false
      });
      continue;
    }

    // 3. The identity's email local part resembles the person's NAME.
    if (identityLocal) {
      const nameKey = p.name.toLowerCase().replace(/[^a-z]/g, '');
      const localKey = identityLocal.replace(/[^a-z]/g, '');
      const s = similarity(nameKey, localKey);
      if (s >= 0.7 && nameKey && localKey) {
        suggestions.push({
          ...base,
          kind: 'email-domain-name',
          score: Math.round(s * 70),
          reason: `Email "${identityLocal}" resembles the name "${p.name}"`,
          verified: false
        });
        continue;
      }
    }

    // 4. Display name similarity. The weakest signal, and never verified.
    if (identityName) {
      const s = similarity(identityName, p.name);
      if (s >= 0.6) {
        suggestions.push({
          ...base,
          kind: 'name-similar',
          score: Math.round(s * 60),
          reason: `Display name "${identityName}" resembles "${p.name}" — NAMES ARE NOT PROOF`,
          verified: false
        });
      }
    }
  }

  suggestions.sort((a, b) => b.score - a.score);
  return { identity, suggestions: suggestions.slice(0, 5) };
}

// ── Person detail ───────────────────────────────────────────────────────────

export async function getIdentitiesForPerson(personId: string): Promise<LinkedIdentityRow[]> {
  const rows = await db
    .select({
      id: personIdentity.id,
      source: personIdentity.source,
      externalId: personIdentity.externalId,
      email: personIdentity.email,
      displayName: personIdentity.displayName,
      confidence: personIdentity.confidence,
      linkedBy: personIdentity.linkedBy,
      linkedAt: personIdentity.linkedAt,
      eventCount: eventCountSql
    })
    .from(personIdentity)
    .where(eq(personIdentity.personId, personId))
    .orderBy(asc(personIdentity.source));

  return rows as LinkedIdentityRow[];
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Attach an identity to an existing person.
 *
 * Also back-fills every unified_event that identity already produced — one
 * UPDATE, thanks to unified_event.person_identity_id. Without it this would
 * mean re-normalising the account's entire history.
 */
export async function linkIdentity(input: unknown): Promise<MutationResult> {
  const parsed = linkIdentitySchema.safeParse({
    ...(input as object),
    linkedBy: await actorLabel()
  });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const { identityId, personId, linkedBy } = parsed.data;

  const updated = await db
    .update(personIdentity)
    .set({
      personId,
      confidence: 'manual',
      linkedBy,
      linkedAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(personIdentity.id, identityId))
    .returning({ id: personIdentity.id });

  if (updated.length === 0) return { success: false, message: 'Identity not found' };

  const backfilled = await attributeEventsForIdentity(identityId, personId);
  return {
    success: true,
    message: `Linked. ${backfilled} existing event${backfilled === 1 ? '' : 's'} attributed.`
  };
}

/** Create a person from an unresolved identity, then link it. */
export async function createPersonFromIdentity(input: unknown): Promise<MutationResult> {
  const parsed = createPersonFromIdentitySchema.safeParse({
    ...(input as object),
    linkedBy: await actorLabel()
  });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const { identityId, name, email, linkedBy } = parsed.data;

  try {
    const [created] = await db
      .insert(person)
      .values({ name, email: email ?? null })
      .returning({ id: person.id });

    await db
      .update(personIdentity)
      .set({
        personId: created.id,
        confidence: 'manual',
        linkedBy,
        linkedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(personIdentity.id, identityId));

    const backfilled = await attributeEventsForIdentity(identityId, created.id);
    return {
      success: true,
      message: `Created ${name} and linked. ${backfilled} event${backfilled === 1 ? '' : 's'} attributed.`
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // person_email_lower_idx is a UNIQUE functional index; surface it plainly
    // rather than as a raw constraint dump.
    if (/person_email_lower_idx/.test(message)) {
      return { success: false, message: 'Another person already has that email address.' };
    }
    return { success: false, message };
  }
}

/**
 * Detach an identity, returning it to the queue.
 *
 * ⚠️ Clears confidence/linkedBy/linkedAt together with person_id, because
 * person_identity_link_provenance_ck rejects a row that keeps one without the
 * other — the constraint makes unlinking all-or-nothing.
 *
 * The identity's unified_events are NOT un-attributed: their person_id stays.
 * Blanking them would erase history on what is usually a correction to ONE
 * account, and re-linking re-runs the backfill anyway.
 */
export async function unlinkIdentity(input: unknown): Promise<MutationResult> {
  const parsed = unlinkIdentitySchema.safeParse(input);
  if (!parsed.success) return { success: false, message: 'Invalid identity id' };

  const updated = await db
    .update(personIdentity)
    .set({
      personId: null,
      confidence: null,
      linkedBy: null,
      linkedAt: null,
      updatedAt: new Date()
    })
    .where(eq(personIdentity.id, parsed.data.identityId))
    .returning({ id: personIdentity.id });

  return updated.length > 0
    ? { success: true, message: 'Unlinked — the identity is back in the queue.' }
    : { success: false, message: 'Identity not found' };
}
