import type { Person } from '@/db/schema';

export type { Person };

// A person row as the table needs it: the person plus the joined profile name.
// The join lives in the query, not in the table, so the client never has to
// resolve role_profile_id itself.
export type PersonRow = Person & { roleProfileName: string | null };

export type PersonFilters = {
  page?: number;
  limit?: number;
  search?: string;
  /** Comma-separated role_profile ids — the multiSelect filter serialises this way. */
  roleProfiles?: string;
  /** JSON-encoded TanStack sorting state, e.g. [{"id":"name","desc":false}] */
  sort?: string;
};

export type PeopleResponse = {
  people: PersonRow[];
  total_people: number;
  offset: number;
  limit: number;
};

export type PersonByIdResponse = {
  success: boolean;
  person: PersonRow | null;
};

/**
 * ⚠️ `slackId` / `clickupId` / `portalId` are GONE from this payload, so the
 * person form can no longer write them.
 *
 * They are superseded by `person_identity`, which keys on the PAIR
 * `(source, external_id)` — a bare `slack_id` column cannot express which system
 * an id belongs to, and cannot hold two accounts for one source. The DB columns
 * still exist and are deliberately NOT dropped; nothing outside this feature
 * ever read them (verified by grep: only these UI files, plus seed writing NULL
 * and two doc comments).
 */
export type PersonMutationPayload = {
  name: string;
  roleProfileId: string | null;
};

// ── Board widgets ───────────────────────────────────────────────────────────

/** The five systems that can carry an identity, in display order. */
export const BOARD_SOURCES = ['slack', 'clickup', 'vision', 'ugc', 'fireflies'] as const;
export type BoardSource = (typeof BOARD_SOURCES)[number];

/**
 * One connected-system badge.
 *
 * ⚠️ THREE states per person, and a fourth that is deliberately NOT here.
 *
 * I first modelled a `detected_unlinked` state — "an identity row exists for
 * this source but nobody has claimed it". `person_identity_attribution_ck`
 * makes that unreachable ON A PERSON ROW:
 *
 *     (person_id IS NULL AND confidence IS NULL AND linked_at IS NULL)
 *  OR (person_id IS NOT NULL AND confidence IS NOT NULL AND linked_at IS NOT NULL)
 *
 * A row with a `person_id` therefore always has a confidence, and a row without
 * one belongs to nobody, so it can never surface under a person. The 17
 * unattributed identities are a PAGE-LEVEL fact — see
 * `PeopleBoardResponse.unattributed`, which renders as one notice linking to
 * /dashboard/identities rather than as a badge that would silently never fire.
 *
 * ⚠️ There is no `'fuzzy'` confidence here, by design. `person_identity`'s CHECK
 * allows only ('exact','email','manual') — a name guess must never auto-link an
 * identity. `fuzzy` lives on `candidate_action_item` only.
 */
export type IdentityBadge = {
  source: BoardSource;
  state: 'linked_strong' | 'linked_manual' | 'absent';
  /** 'exact' | 'email' | 'manual'. Non-null whenever the row is attributed. */
  confidence: string | null;
  linkedAt: string | null;
  linkedBy: string | null;
  /** How many rows exist for this source, when more than one. */
  count: number;
};

/** One bar of the 14-day sparkline. Always exactly 14 entries, zero-filled. */
export type ActivityDay = { day: string; count: number };

export type LastSeen = { source: string; at: string } | null;

export type PersonBoardRow = PersonRow & {
  identities: IdentityBadge[];
  activity: ActivityDay[];
  activityTotal: number;
  lastSeen: LastSeen;
  /** Pending candidates where this person is the resolved owner. */
  pendingCount: number;
  /** Of those, how many carry a weak owner attribution. */
  pendingNeedsReview: number;
};

export type PeopleBoardResponse = {
  people: PersonBoardRow[];
  total_people: number;
  offset: number;
  limit: number;
  /**
   * Resolved ONCE on the server and threaded down, per CLAUDE.md. Relative times
   * and the 14-day window must not be computed from a per-render clock: the
   * server and browser are never on the same instant, and a bar that ticks over
   * mid-render is a hydration mismatch by construction.
   */
  now: string;
  /**
   * Identity rows that belong to NOBODY yet, per source. Measured at 17 of 19 on
   * the current data, so this is the dominant fact about identity coverage and
   * it has no per-person home (see IdentityBadge). Rendered once, at the top,
   * as a link into /dashboard/identities.
   */
  unattributed: { source: string; count: number }[];
};

// ── Expand panel (loaded on demand, never with the page) ─────────────────────

export type PanelIdentity = {
  id: string;
  source: string;
  externalId: string;
  email: string | null;
  displayName: string | null;
  confidence: string | null;
  linkedBy: string | null;
  linkedAt: string | null;
};

export type PanelEvent = {
  id: string;
  source: string;
  eventType: string;
  occurredAt: string;
  subjectLabel: string | null;
};

export type PanelItem = {
  id: string;
  description: string;
  sourceSpan: string;
  ownerConfidence: string | null;
  confidence: number | null;
};

export type PersonPanel = {
  identities: PanelIdentity[];
  events: PanelEvent[];
  items: PanelItem[];
  now: string;
};

// ── Org chart ───────────────────────────────────────────────────────────────

/**
 * One person, as the org chart renders them.
 *
 * ⚠️ `accentVar` is a THEME TOKEN REFERENCE (`var(--chart-2)`), never a colour
 * literal — see @/lib/person-accent. A hex here would not follow the theme.
 */
export type OrgPersonChip = {
  id: string;
  name: string;
  initials: string;
  accentVar: string;
  /** `role.display_name`. DISPLAY ONLY — every branch uses `role.code`. */
  roleLabel: string | null;
  /** Profile link, already carrying its `?from=` value. */
  href: string;
};

/**
 * One column of the org chart's bottom row.
 *
 * ⚠️ `members` EXCLUDES anyone already rendered at the founder or ops-lead level.
 * See the partition comment in ./service.ts.
 */
export type OrgDeptColumn = {
  /** A department uuid, or the literal `'unassigned'` for the synthetic column. */
  id: string;
  name: string;
  accentVar: string;
  members: OrgPersonChip[];
  /**
   * How many of this department's people are rendered at an ELEVATED level
   * instead of in this column.
   *
   * ⚠️ THIS IS WHAT MAKES THE EMPTY-COLUMN COPY HONEST. "All members shown above"
   * and "No members yet" are different facts, and only this number separates
   * them — an empty column alone cannot tell you which. Operations is currently
   * the first case (both its people are the founder and the ops lead); an
   * unstaffed department would be the second, and telling a reader to look above
   * for people who do not exist sends them hunting for a rendering bug.
   */
  elevatedCount: number;
  /**
   * ⚠️ The synthetic "Unassigned" column, which has no `department` row behind it.
   * A flag rather than an id comparison at the call site — the component must not
   * need to know that `'unassigned'` is a magic string.
   */
  isUnassigned: boolean;
};

/**
 * An open role on the recruiting card.
 *
 * ⚠️ MOCKED — there is no ATS integration and no recruiting model. See the note
 * on `PeopleOrg.recruitingIsSample`.
 */
export type OpenRole = {
  id: string;
  title: string;
  /** e.g. "Full-time", "Contract". Free text — no enum exists to constrain it. */
  employmentType: string;
  /** Where the search has got to, e.g. "2 in final round". */
  stage: string;
};

export type PeopleOrg = {
  /**
   * ⚠️ ARRAYS, not single people, at both elevated levels. Nothing in the schema
   * makes `founder` or `ops_lead` singular — `person.role_id` is a plain FK and
   * two people can hold either. Modelling these as `founder: Person | null` would
   * crash or silently drop someone the day a co-founder is added.
   */
  founders: OrgPersonChip[];
  opsLeads: OrgPersonChip[];
  departments: OrgDeptColumn[];
  openRoles: OpenRole[];
  /**
   * ⚠️ Covers `openRoles` ONLY. Everything else on this page is a real query.
   * The caption renders from this flag, so when a real source lands the service
   * flips one field and it disappears — see @/components/sample-data-caption.
   */
  recruitingIsSample: boolean;
  /**
   * Every roster row, including the elevated ones. The org chart must account for
   * all of them — see the "Unassigned" column note in ./service.ts.
   */
  headcount: number;
};

export type RoleProfileOption = { value: string; label: string };
