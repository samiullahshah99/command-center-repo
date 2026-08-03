/**
 * Turning a spoken name into an owner.
 *
 * ── Why this is not just resolvePerson() ────────────────────────────────────
 * A transcript gives a NAME. The identity service resolves on
 * (source, external_id) or email and deliberately never on names, because
 * Vision, UGC and Command Centre are three separate Clerk instances and a name
 * collision would silently attribute one person's work to another.
 *
 * So a speaker name will almost never resolve through the normal path. This
 * adds a name-similarity layer that produces confidence='fuzzy'.
 *
 * ⚠️ 'fuzzy' IS A SUGGESTION, NOT A LINK.
 *   - It can only ever land on a candidate_action_item, which is a review queue.
 *   - review_status stays 'pending'; a fuzzy owner must never auto-approve.
 *   - It must NEVER be written to person_identity, whose CHECK has no such
 *     value. On approval the link is created with confidence='manual', because
 *     by then a human really did confirm it.
 *
 * That is the sanctioned "unverified suggestion requiring explicit
 * confirmation" pattern, not a loosening of the no-name-matching rule.
 */

import { asc, sql } from 'drizzle-orm';
import { db } from '@/db';
import { person, personIdentity } from '@/db/schema';
import type { OwnerConfidence } from './schemas/action-item';

export type OwnerResolution = {
  ownerPersonId: string | null;
  ownerConfidence: OwnerConfidence;
  /** Why, for the review UI. Never used to make the decision. */
  reason: string;
};

/** Normalised edit-distance similarity, 0–1. */
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
 * How similar two names must be before a fuzzy match is offered at all.
 *
 * Deliberately high. A weak suggestion is worse than none: it costs the reviewer
 * attention and, if accepted carelessly, produces exactly the silent
 * mis-attribution the no-name-matching rule exists to prevent.
 */
const FUZZY_THRESHOLD = 0.72;

/**
 * ⚠️ AMBIGUITY MEANS UNRESOLVED, NOT "pick the best".
 *
 * When two people score within this of each other, no suggestion is made. "Chris
 * said he'd do it" with two Chrises on the roster must reach a human with no
 * pre-filled answer — a coin-flip suggestion is the failure mode, because a
 * reviewer skimming a queue tends to accept what is already there.
 */
const AMBIGUITY_MARGIN = 0.08;

export type ResolveOwnerInput = {
  /** The name as spoken in the transcript. */
  ownerName: string;
  /**
   * Emails known for this meeting (transcript participants / host).
   *
   * ⚠️ Only usable when it can be tied to THIS speaker. Fireflies' `speakers[]`
   * is {id, name} with no email, and nothing links a speaker to an entry in
   * `participants[]` — the orders are not guaranteed to correspond. So an email
   * is only trusted when its local part actually resembles the spoken name,
   * never by position.
   */
  meetingEmails?: string[];
};

export async function resolveOwner(input: ResolveOwnerInput): Promise<OwnerResolution> {
  const name = input.ownerName.trim();
  if (!name) {
    return { ownerPersonId: null, ownerConfidence: 'unresolved', reason: 'no owner name given' };
  }

  // ── 1. EXACT — an identity whose display name is this, already linked ─────
  // Not name matching: this only trusts a person_identity row that a human or
  // an email match already established. The name is just the lookup handle.
  const [linked] = await db
    .select({ personId: personIdentity.personId, source: personIdentity.source })
    .from(personIdentity)
    .where(
      sql`${personIdentity.personId} IS NOT NULL AND lower(${personIdentity.displayName}) = ${name.toLowerCase()}`
    )
    .limit(1);

  if (linked?.personId) {
    return {
      ownerPersonId: linked.personId,
      ownerConfidence: 'exact',
      reason: `an already-linked ${linked.source} identity has this display name`
    };
  }

  const roster = await db
    .select({ id: person.id, name: person.name, email: person.email })
    .from(person)
    .orderBy(asc(person.name));

  // ── 2. EMAIL — only when it can be tied to this speaker ───────────────────
  const emails = (input.meetingEmails ?? []).map((e) => e.toLowerCase().trim()).filter(Boolean);
  const nameKey = name.toLowerCase().replace(/[^a-z]/g, '');

  for (const email of emails) {
    const local = email.split('@')[0].replace(/[^a-z]/g, '');
    if (!local || !nameKey) continue;
    // The local part must actually resemble the spoken name. Position in
    // participants[] proves nothing about who spoke.
    if (similarity(local, nameKey) < 0.8) continue;

    const match = roster.find((p) => p.email?.toLowerCase().trim() === email);
    if (match) {
      return {
        ownerPersonId: match.id,
        ownerConfidence: 'email',
        reason: `meeting participant ${email} matches a roster email and resembles "${name}"`
      };
    }
  }

  // ── 3. FUZZY — a suggestion, gated behind review ──────────────────────────
  const scored = roster
    .map((p) => ({
      p,
      score: Math.max(
        similarity(name, p.name),
        similarity(nameKey, p.name.toLowerCase().replace(/[^a-z]/g, ''))
      )
    }))
    .toSorted((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];

  if (!best || best.score < FUZZY_THRESHOLD) {
    return {
      ownerPersonId: null,
      ownerConfidence: 'unresolved',
      reason: `no roster name resembles "${name}"`
    };
  }

  if (runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN) {
    return {
      ownerPersonId: null,
      ownerConfidence: 'unresolved',
      reason:
        `"${name}" is ambiguous — ${best.p.name} and ${runnerUp.p.name} score within ` +
        `${AMBIGUITY_MARGIN} of each other. Deliberately not guessing.`
    };
  }

  return {
    ownerPersonId: best.p.id,
    ownerConfidence: 'fuzzy',
    reason: `"${name}" resembles ${best.p.name} (${best.score.toFixed(2)}) — UNVERIFIED, needs confirmation`
  };
}

// `ownerIsPushable()` was deleted 2026-08-04 — it pre-checked Notion workspace
// membership before a write that no longer happens. Knowledge kept under
// "Phase 2: read-only Notion mirror (NOT BUILT)" in CLAUDE.md.

export { FUZZY_THRESHOLD, AMBIGUITY_MARGIN };
