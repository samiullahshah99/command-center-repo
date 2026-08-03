import { z } from 'zod';

/**
 * The action-item contract — the seam Week 2 is built on.
 *
 * Day 1 extracts these from transcripts, Day 2 syncs them to Notion, Day 3
 * announces them in Slack, Day 4 reviews them. Every one of those consumes THIS
 * shape, so a change here ripples through all four.
 *
 * ⚠️ DESTINATION IS NOTION (Ocean), not ClickUp. Nothing in this file names a
 * vendor: the destination lives in `externalSystem`/`externalTaskId` on the
 * database row, deliberately generic. Naming a column after one vendor is how a
 * whole day's work got retargeted.
 */

// ── Owner resolution ────────────────────────────────────────────────────────

/**
 * How confidently the owner was identified.
 *
 * ⚠️ 'fuzzy' EXISTS HERE AND NOWHERE ELSE.
 *
 * `person_identity.confidence` is deliberately limited to 'exact' | 'email' |
 * 'manual' — there is NO name tier, because two people can share a display name
 * and a wrong auto-link silently attributes one person's work to another.
 *
 * A name-similarity match is legitimate on a CANDIDATE because this table is a
 * review queue: `reviewStatus` starts 'pending' and nothing reaches a real
 * system until a human approves it. That is exactly the sanctioned
 * "suggestion requiring explicit confirmation" pattern.
 *
 * ⚠️ THE HARD RULE: a 'fuzzy' owner must NEVER be written into
 * `person_identity`. When a reviewer approves one, the identity link is created
 * with confidence='manual' — because by then a human really did confirm it. The
 * person_identity CHECK constraint has no 'fuzzy' value, so the database will
 * reject the mistake, but do not rely on that as the only guard.
 *
 * Mapping from resolvePerson():
 *   {status:'resolved', confidence:'exact'} → 'exact'
 *   {status:'resolved', confidence:'email'} → 'email'
 *   {status:'unresolved'}                   → 'unresolved', unless the extractor
 *                                             offered a name-similarity guess,
 *                                             which becomes 'fuzzy'
 */
export const OWNER_CONFIDENCE = ['exact', 'email', 'fuzzy', 'unresolved'] as const;
export type OwnerConfidence = (typeof OWNER_CONFIDENCE)[number];

/** The confidences that may be promoted to a person_identity link on approval. */
export const AUTO_LINKABLE_OWNER_CONFIDENCE = ['exact', 'email'] as const;

// ── Review ──────────────────────────────────────────────────────────────────

/**
 * 'auto_approved' is distinct from 'approved' on purpose: Day 4's precision
 * metric compares what the model produced against what a human corrected, and
 * lumping the two together would flatter the model with items nobody looked at.
 */
export const REVIEW_STATUS = ['pending', 'approved', 'rejected', 'auto_approved'] as const;
export type ReviewStatus = (typeof REVIEW_STATUS)[number];

// ⚠️ Re-exported, NOT redeclared. This file previously held its own
// ['notion','internal'] literal; once tracked_item.source_system and
// project.external_system joined the same value space, two lists meant two
// places to forget. The DB CHECK constraints are generated from the shared one.
export { EXTERNAL_SYSTEMS, type ExternalSystem } from '@/db/schema/external-system';

// ── What the LLM must return ────────────────────────────────────────────────

/**
 * The extractor's output for ONE item, before any owner resolution.
 *
 * Kept separate from the stored row so the model is never asked to invent things
 * it cannot know — a person_id, a review status, a content hash. Anything the
 * model returns is, by definition, a guess; anything derived is computed here.
 */
export const extractedActionItemSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, 'description is required')
    .max(2000, 'description is implausibly long — likely a transcript chunk, not an item'),

  /**
   * The name EXACTLY as the transcript said it, before any resolution.
   *
   * Kept permanently, even once owner_person_id is set. It is the audit record
   * of what the model actually saw: if an attribution turns out wrong, this is
   * how you tell a bad extraction from a bad resolution.
   */
  owner_name: z.string().trim().min(1, 'owner_name is required — record what the model saw'),

  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'due_date must be YYYY-MM-DD')
    .nullable(),

  /**
   * Dependent items mentioned alongside this one, as free text.
   *
   * Not modelled as relations: at extraction time these are phrases, not
   * identified items, and resolving them into FKs would be inventing structure
   * the transcript does not contain.
   */
  follow_ups: z.array(z.string().trim().min(1)).default([]),

  /** The model's own confidence. Its self-report — not a measured quantity. */
  confidence: z.number().min(0).max(1),

  /**
   * ⚠️ REQUIRED, NEVER OPTIONAL.
   *
   * The quoted transcript text this item came from. Without it a reviewer cannot
   * verify the item against the source, which makes Day 4's review UI useless —
   * a reviewer would be approving the model's assertion on trust. It is also the
   * only defence against a confidently-worded hallucination.
   *
   * A minimum length is enforced because an empty or one-word span is not
   * evidence.
   */
  source_span: z
    .string()
    .trim()
    .min(10, 'source_span must quote enough transcript to verify the item against')
});

export type ExtractedActionItem = z.infer<typeof extractedActionItemSchema>;

/** What the model returns for a whole transcript. */
/**
 * ⚠️ `items` is REQUIRED, deliberately not `.default([])`.
 *
 * A default here is indistinguishable from a correct empty extraction. A model
 * that drifts to `{"action_items": [...]}` — a plausible rename, and the kind of
 * thing that changes with a model version — would have validated as zero items,
 * the job would have completed, and the meeting's commitments would have been
 * lost with nothing in the logs. Requiring the key turns that into a loud parse
 * failure. (Caught by a test asserting exactly that payload throws.)
 *
 * The object stays non-strict: unknown SIBLING keys are stripped, so a model
 * that volunteers a "reasoning" field alongside a correct `items` still passes.
 */
export const extractionResultSchema = z.object({
  items: z.array(extractedActionItemSchema)
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

// ── The resolved item ───────────────────────────────────────────────────────

/**
 * An extracted item plus the owner resolution, ready to persist.
 *
 * ⚠️ Owner fields live ON the item rather than in a candidates table. A
 * transcript names one person per commitment in practice, and Day 4's reviewer
 * needs a single field to accept or correct — which is also what keeps
 * `edited_fields` a clean precision signal. If genuine multi-candidate ambiguity
 * turns up, a `candidate_action_item_owner` table is additive and does not
 * change this shape.
 */
export const resolvedActionItemSchema = extractedActionItemSchema.extend({
  owner_person_id: z.string().uuid().nullable(),
  owner_confidence: z.enum(OWNER_CONFIDENCE)
});

export type ResolvedActionItem = z.infer<typeof resolvedActionItemSchema>;

/**
 * A resolved owner and its confidence must agree.
 *
 * 'unresolved' with a person_id is incoherent, and so is 'exact' without one.
 * Checked here as well as by a database CHECK, so a bad object fails at the
 * boundary with a readable message rather than as a constraint violation.
 */
export const resolvedActionItemStrictSchema = resolvedActionItemSchema.refine(
  (v) =>
    v.owner_confidence === 'unresolved' ? v.owner_person_id === null : v.owner_person_id !== null,
  {
    message:
      'owner_confidence and owner_person_id disagree: only "unresolved" may have a null owner_person_id',
    path: ['owner_confidence']
  }
);

// ── Idempotency ─────────────────────────────────────────────────────────────

/**
 * The natural key for an extracted item.
 *
 * ⚠️ Hashes source_span + owner_name, NOT the description. Re-running extraction
 * over the same transcript — after a prompt change, or a model swap — produces
 * slightly different wording for the same commitment. Hashing the description
 * would make every re-run a new row and the review queue would fill with
 * duplicates.
 *
 * The source span is the stable thing: it is quoted from a transcript that does
 * not change. Same span + same owner = same commitment, however the model chose
 * to phrase it this time.
 *
 * Normalised whitespace and case so trivial formatting differences do not create
 * a new hash.
 */
function normaliseForHash(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function contentHashInput(item: { owner_name: string; source_span: string }): string {
  return `${normaliseForHash(item.owner_name)} ${normaliseForHash(item.source_span)}`;
}
