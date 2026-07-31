import type { IdentityConfidence, IdentitySource } from '@/db/schema';

export type { IdentityConfidence, IdentitySource };

/** A row in the unresolved queue, with the counts the table shows. */
export type UnresolvedIdentityRow = {
  id: string;
  source: string;
  externalId: string;
  email: string | null;
  displayName: string | null;
  editorName: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** unified_event rows attributed to this identity — how much history is waiting. */
  eventCount: number;
};

export type IdentityFilters = {
  page?: number;
  limit?: number;
  search?: string;
  /** Comma-separated sources — the multiSelect filter serialises this way. */
  sources?: string;
  /** JSON-encoded TanStack sorting state. */
  sort?: string;
};

export type UnresolvedIdentitiesResponse = {
  identities: UnresolvedIdentityRow[];
  total_identities: number;
  offset: number;
  limit: number;
};

/**
 * A candidate person for an identity, with WHY it is being suggested.
 *
 * ⚠️ A suggestion is never applied automatically at any score. `reason` is shown
 * verbatim in the UI so the human is choosing on stated evidence rather than on
 * an opaque ranking — and `name` matches are labelled unverified precisely
 * because two people can share a display name.
 */
export type MatchSuggestion = {
  personId: string;
  personName: string;
  personEmail: string | null;
  /** 'email-exact' is the only one the resolver would ever act on by itself. */
  kind: 'email-exact' | 'email-local-part' | 'email-domain-name' | 'name-similar';
  /** 0–100. Ordering only — it does NOT gate anything. */
  score: number;
  reason: string;
  /** False for every name-derived suggestion. Drives the UI warning. */
  verified: boolean;
};

export type IdentitySuggestionsResponse = {
  identity: UnresolvedIdentityRow | null;
  suggestions: MatchSuggestion[];
};

/** One identity attached to a person, for the People detail page. */
export type LinkedIdentityRow = {
  id: string;
  source: string;
  externalId: string;
  email: string | null;
  displayName: string | null;
  confidence: IdentityConfidence | null;
  linkedBy: string | null;
  linkedAt: Date | null;
  eventCount: number;
};

export type PersonOption = { value: string; label: string; email: string | null };

export type MutationResult = { success: boolean; message?: string };
