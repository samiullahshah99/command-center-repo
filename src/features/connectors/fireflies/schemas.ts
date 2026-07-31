import * as z from 'zod';

/**
 * Zod schemas for the Fireflies GraphQL API.
 *
 * Permissive about fields we do not read (unknown keys pass through by default)
 * and strict about the ones we do. Almost everything is nullish: Fireflies omits
 * fields rather than sending null, and a transcript still processing has far
 * fewer populated fields than a finished one.
 */

// ── Webhook payload ─────────────────────────────────────────────────────────

/**
 * The whole webhook body — metadata only, no transcript content.
 *
 * ⚠️ THIS IS THE v2 (Integrations page) SHAPE, CONFIRMED FROM LIVE DELIVERIES
 * SENT BY `Fireflies-Webhook/2.0`:
 *
 *     { "event": "test", "timestamp": 1785510895435, "meeting_id": "test_00000000" }
 *
 * docs.fireflies.ai/graphql-api/webhooks documents the DEPRECATED v1 webhook and
 * is wrong on every field. Do not build against it:
 *
 *     v1 (docs, deprecated)     v2 (actual)
 *     ─────────────────────     ──────────────────────────
 *     meetingId                 meeting_id     ← snake_case
 *     eventType                 event
 *     clientReferenceId         (does not exist)
 *     (not mentioned)           timestamp      ← epoch MILLIseconds
 *
 * `meeting_id` is the same value as the transcript id, so it goes straight into
 * the `transcript(id:)` query.
 *
 * `event` is a plain string on purpose. Fireflies' catalog is expected to grow
 * and an unknown value must be STORED, not rejected — an event never stored
 * cannot be replayed.
 */
export const firefliesWebhookSchema = z.object({
  event: z.string().min(1),
  meeting_id: z.string().min(1),
  /**
   * Epoch MILLIseconds (13 digits), not seconds. Optional because it is
   * undocumented — it appears on every delivery observed so far, but nothing
   * guarantees it, and a missing timestamp must not make the envelope
   * unparseable.
   */
  timestamp: z.number().nullish()
});

export type FirefliesWebhookPayload = z.infer<typeof firefliesWebhookSchema>;

/**
 * Setup test deliveries.
 *
 * Fireflies sends `event: "test"` with the CONSTANT `meeting_id "test_00000000"`
 * — both live test deliveries carried exactly that id, differing only in
 * `timestamp`. Same hazard as UGC's `evt_test` and Vision's all-zero id: keying
 * on a constant would make the second ping vanish, which during setup is
 * indistinguishable from a broken handler.
 *
 * The prefix check is the belt to the `event` value's braces — a future
 * `meeting_id` of `test_…` under a different event name should still not be
 * mistaken for a real meeting to fetch.
 */
export const FIREFLIES_TEST_EVENT = 'test';
export const FIREFLIES_TEST_MEETING_PREFIX = 'test_';

export function isFirefliesTestEvent(payload: { event: string; meeting_id: string }): boolean {
  return (
    payload.event === FIREFLIES_TEST_EVENT ||
    payload.meeting_id.startsWith(FIREFLIES_TEST_MEETING_PREFIX)
  );
}

// ── Transcript ──────────────────────────────────────────────────────────────

export const firefliesSpeakerSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  name: z.string().nullish()
});

export const firefliesSentenceSchema = z.object({
  index: z.number().nullish(),
  speaker_name: z.string().nullish(),
  speaker_id: z.union([z.string(), z.number()]).nullish(),
  text: z.string().nullish(),
  raw_text: z.string().nullish(),
  start_time: z.number().nullish(),
  end_time: z.number().nullish()
});

export const firefliesSummarySchema = z.object({
  keywords: z.array(z.string()).nullish(),
  action_items: z.union([z.string(), z.array(z.string())]).nullish(),
  outline: z.union([z.string(), z.array(z.string())]).nullish(),
  overview: z.string().nullish(),
  topics_discussed: z.union([z.string(), z.array(z.string())]).nullish(),
  transcript_chapters: z.unknown().nullish()
});

export const firefliesTranscriptSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  /** Epoch millis as a number, or an ISO string depending on the field used. */
  date: z.union([z.number(), z.string()]).nullish(),
  dateString: z.string().nullish(),
  duration: z.number().nullish(),
  host_email: z.string().nullish(),
  organizer_email: z.string().nullish(),
  transcript_url: z.string().nullish(),
  audio_url: z.string().nullish(),
  video_url: z.string().nullish(),
  participants: z.array(z.string()).nullish(),
  speakers: z.array(firefliesSpeakerSchema).nullish(),
  sentences: z.array(firefliesSentenceSchema).nullish(),
  summary: firefliesSummarySchema.nullish()
});

export type FirefliesTranscript = z.infer<typeof firefliesTranscriptSchema>;

// ── GraphQL envelopes ───────────────────────────────────────────────────────

/**
 * ⚠️ GraphQL returns HTTP 200 even when the operation fails — the failure is in
 * an `errors` array alongside a null `data`. Checking `res.ok` alone would treat
 * every GraphQL error as a success.
 */
export const graphqlErrorSchema = z.object({
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).nullish(),
  extensions: z.record(z.string(), z.unknown()).nullish()
});

export function graphqlEnvelope<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema.nullish(),
    errors: z.array(graphqlErrorSchema).nullish()
  });
}

export const transcriptQuerySchema = graphqlEnvelope(
  z.object({ transcript: firefliesTranscriptSchema.nullish() })
);

export const transcriptsQuerySchema = graphqlEnvelope(
  z.object({ transcripts: z.array(firefliesTranscriptSchema).nullish() })
);
