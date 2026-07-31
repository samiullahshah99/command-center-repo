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
 * The whole webhook body. Three fields — metadata only, no transcript content.
 *
 * `meetingId` and `transcriptId` are the same value on the Fireflies platform,
 * so this id goes straight into the `transcript(id:)` query.
 */
export const firefliesWebhookSchema = z.object({
  meetingId: z.string().min(1),
  eventType: z.string().min(1),
  clientReferenceId: z.string().nullish()
});

export type FirefliesWebhookPayload = z.infer<typeof firefliesWebhookSchema>;

/** The only event type documented today. Others must be tolerated, not rejected. */
export const FIREFLIES_TRANSCRIPTION_COMPLETED = 'Transcription completed';

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
