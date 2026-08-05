// ============================================================
// Extraction Demo — Response shapes and filters
// ============================================================
// Types live here rather than in service.ts because that file is 'use server':
// every export of a Server Actions module must be an async function, so a type
// exported from it is a build error.
// ============================================================

/** Why a meeting cannot currently be opened. Drives the inline row message. */
export type MeetingBlockedReason = 'plan' | 'auth' | 'not_ready' | 'error';

export type MeetingStatus =
  /** No transcript row for this fireflies_id. */
  | 'not_fetched'
  /** Transcript stored, extraction has produced candidate items. */
  | 'extracted'
  /** Transcript stored, extraction ran and found nothing. A VALID result. */
  | 'extracted_empty'
  /** Transcript stored, extraction has not completed yet. */
  | 'pending'
  /** A previous fetch failed for a reason worth showing on the row. */
  | 'blocked';

export type MeetingRow = {
  /** Fireflies transcript id. The natural key everywhere. */
  firefliesId: string;
  title: string | null;
  /** ISO string; null when Fireflies sends neither `date` nor a parseable one. */
  date: string | null;
  /** SECONDS. Fireflies reports minutes; the conversion happens at the boundary. */
  durationSeconds: number | null;
  status: MeetingStatus;
  itemCount: number;
  /** Present only when status is 'blocked'. */
  blockedReason?: MeetingBlockedReason;
  blockedMessage?: string;
  /** Set once stored — what the detail page and the extraction job key on. */
  unifiedEventId: string | null;
};

export type MeetingListResponse = {
  meetings: MeetingRow[];
  /**
   * Non-fatal problem reaching Fireflies. The page still renders — already
   * fetched meetings live in our database and stay browsable when the upstream
   * list is unavailable.
   */
  listError?: { reason: MeetingBlockedReason; message: string };
};

// ── Detail ──────────────────────────────────────────────────────────────────

export type OwnerConfidenceLevel = 'exact' | 'email' | 'fuzzy' | 'unresolved';

export type ActionItemRow = {
  id: string;
  description: string;
  ownerName: string;
  /** The person the owner resolved to, when one was confident enough to link. */
  ownerPersonId: string | null;
  ownerPersonName: string | null;
  ownerConfidence: OwnerConfidenceLevel;
  /** ISO date (yyyy-mm-dd) or null. Null is explicit, not missing. */
  dueDate: string | null;
  /** The model's own 0–1 estimate that this is a real commitment. */
  confidence: number;
  /** Verbatim transcript quote. The reviewer's only way to verify the item. */
  sourceSpan: string;
  followUps: string[];
  reviewStatus: string;
  /** Which fields a reviewer corrected. Empty = accepted as the model wrote it. */
  editedFields: string[];
  createdAt: string;
};

export type ExtractionDetail = {
  firefliesId: string;
  title: string | null;
  date: string | null;
  durationSeconds: number | null;
  speakers: string[];
  sentenceCount: number;
  unifiedEventId: string | null;
  items: ActionItemRow[];
  /** True when the transcript is stored but extraction has not produced rows. */
  pending: boolean;
};

// ── Capture queue ───────────────────────────────────────────────────────────
//
// ⚠️ ADDED for the Capture queue restyle. Every type below is NEW and additive —
// nothing above changed, so the meetings list, the detail page and the review
// mutations keep their exact shapes.

/**
 * One incoming-source provenance card.
 *
 * ⚠️ A READ-ONLY DISPLAY, never an ingest control. The mockup puts "Ingest"
 * buttons on these cards; a button that fabricates `raw_event` rows beside real
 * webhook deliveries is precisely the landmine flagged on the person profile's
 * "Capture from Slack" affordance. Ingestion is webhook-driven.
 */
export type CaptureProvenance = {
  /** Right-hand header meta: "#channel · 11:38" or "Dev Sync · 29 Jul 2026". */
  contextLabel: string | null;
  /** Who said it, when known. Slack shows a resolved person or the raw actor. */
  authorName: string | null;
  /** Pre-formatted server-side. Never a raw ISO string. */
  when: string | null;
  /** The candidate's `source_span` — the verbatim quote. */
  quote: string | null;
  /**
   * Copy for when nothing has arrived from this source yet. Non-null exactly when
   * `quote` is null. ⚠️ NEVER a fabricated message — an empty source says so.
   */
  emptyCopy: string | null;
};

/** A pending candidate, as the review queue renders it. */
export type QueueCandidate = {
  id: string;
  /** The proposed task — `candidate_action_item.description`. Immutable. */
  description: string;
  /** Verbatim transcript/thread quote. The reviewer's only verification path. */
  sourceSpan: string;
  /** Name exactly as the source said it. Kept permanently as the model's record. */
  ownerName: string;
  /** The resolved roster person, when one was confident enough to link. */
  ownerPersonName: string | null;
  ownerConfidence: OwnerConfidenceLevel;
  /** ISO date (yyyy-mm-dd) or null. Rendered via @/lib/format-date. */
  dueDate: string | null;
  /** The model's own 0–1 estimate. Rendered as a percentage. */
  confidence: number;
  /** 'Meeting' | 'Slack' — humanised in the DTO from the originating event. */
  sourceLabel: string;
};

/** A candidate that was approved and has a `tracked_item` to show for it. */
export type TrackerLanded = {
  candidateId: string;
  trackedItemId: string;
  /** The tracked_item's title — the reviewer's wording if they edited it. */
  title: string;
  /** Resolved owner, else the name the source used. */
  ownerLabel: string;
  projectId: string | null;
  projectName: string | null;
};

/**
 * One auto-completion ledger row.
 *
 * ⚠️ HYBRID — read the per-field notes. `task` and `owner` come from REAL
 * `recurring_task` rows; `evidence` and `when` are INVENTED because the completion
 * engine does not exist (`completion_event`: 0 rows, no writer).
 */
export type LedgerRow = {
  id: string;
  /** REAL — derived from the rule's event via @/lib/recurring-label. */
  task: string;
  /** REAL — the recurring task's owner. */
  owner: string;
  /** ⚠️ INVENTED. There is no evidence store yet. */
  evidence: string;
  /** ⚠️ INVENTED. Pre-formatted; there is no completion timestamp to read. */
  when: string;
};

export type CaptureLedger = {
  /** ⚠️ Applies to `evidence` and `when`; the task and owner are real. */
  detailIsSample: boolean;
  rows: LedgerRow[];
};

export type CaptureQueue = {
  /** The newest pending Slack-sourced capture, or its empty state. */
  slack: CaptureProvenance;
  /** The newest pending meeting-sourced capture, or its empty state. */
  meeting: CaptureProvenance;
  pending: QueueCandidate[];
  /** Uncapped count — `pending` is capped for the page. */
  pendingTotal: number;
  landed: TrackerLanded[];
  ledger: CaptureLedger;
  /**
   * Resolved ONCE on the server. Every date on the page derives from it — a
   * per-render clock differs between SSR and hydration and React discards the
   * subtree.
   */
  now: string;
};

// ── The fetch-and-extract action ────────────────────────────────────────────

export type FetchExtractResult =
  | { ok: true; firefliesId: string; unifiedEventId: string; jobId: string | null }
  | { ok: false; reason: MeetingBlockedReason; message: string };

export type ExtractionJobState = 'pending' | 'complete' | 'complete_empty' | 'failed' | 'unknown';

export type ExtractionStatusResponse = {
  firefliesId: string;
  state: ExtractionJobState;
  itemCount: number;
  unifiedEventId: string | null;
  message?: string;
};

// ── Review: approve / reject ────────────────────────────────────────────────

export type PromotedItem = {
  trackedItemId: string;
  projectId: string;
  projectName: string;
  title: string;
};

/**
 * `already_decided` is its own outcome, not an error.
 *
 * A second click on an approve button is the common case, not a fault — the
 * first one already worked. Reporting it as a failure would train reviewers to
 * distrust a queue that is behaving correctly.
 */
export type ReviewResult =
  | { ok: true; status: 'approved'; editedFields: string[]; promoted: PromotedItem }
  | { ok: true; status: 'rejected' }
  | { ok: false; reason: 'already_decided'; currentStatus: string }
  | { ok: false; reason: 'not_found' | 'invalid'; message: string };
