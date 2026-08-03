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
