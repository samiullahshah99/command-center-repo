/**
 * Fireflies GraphQL client.
 *
 * GraphQL-only — there is no REST surface. One endpoint, POST, Bearer auth.
 *
 * ── Rate limits (from their docs) ───────────────────────────────────────────
 *   Free                 50 requests per DAY
 *   Pro                  500 requests per DAY
 *   Business/Enterprise  60 requests per minute
 *
 * Per-DAY on the lower tiers, which is unusually tight. The error response and
 * any Retry-After are undocumented, so the 429 path below is best-effort: it
 * honours Retry-After when present and otherwise backs off exponentially.
 *
 * This is why the Fireflies queue uses a smaller retry budget with longer delays
 * than the other connectors — see FIREFLIES_JOB_OPTIONS in ./index.ts.
 */

import * as z from 'zod';
import {
  firefliesTranscriptSchema,
  transcriptQuerySchema,
  transcriptsQuerySchema,
  type FirefliesTranscript
} from './schemas';

export const FIREFLIES_GRAPHQL_URL = 'https://api.fireflies.ai/graphql';

export const FIREFLIES_RATE_LIMITS = {
  free: '50/day',
  pro: '500/day',
  business: '60/min'
} as const;

const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

export class FirefliesApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'FirefliesApiError';
  }
}

/**
 * A GraphQL-level failure: HTTP 200 with a populated `errors` array.
 *
 * Kept distinct from FirefliesApiError because the retry decision differs — a
 * "transcript not found yet" error is worth retrying, a malformed query is not.
 */
export class FirefliesGraphQLError extends Error {
  constructor(
    readonly errors: { message: string }[],
    readonly query: string
  ) {
    super(`Fireflies GraphQL error: ${errors.map((e) => e.message).join('; ')}`);
    this.name = 'FirefliesGraphQLError';
  }

  /**
   * True when the transcript exists but is not retrievable yet.
   *
   * Fireflies can fire the webhook before the transcript is queryable, so this
   * is the expected-and-retryable case rather than a bug.
   */
  get isNotReady(): boolean {
    return this.errors.some((e) =>
      /not found|not ready|still processing|processing/i.test(e.message)
    );
  }
}

export class FirefliesSchemaError extends Error {
  constructor(
    readonly issues: z.core.$ZodIssue[],
    operation: string
  ) {
    super(
      `Fireflies response for ${operation} did not match the expected shape — the API likely changed. ` +
        issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    );
    this.name = 'FirefliesSchemaError';
  }
}

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export type FirefliesClientOptions = {
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
  endpoint?: string;
};

/**
 * Bearer auth. Throws on a missing key rather than sending `Bearer undefined`,
 * which returns the same 401 as a revoked key and is far harder to diagnose.
 */
export function firefliesAuthHeaders(): Record<string, string> {
  const key = process.env.FIREFLIES_API_KEY;
  if (!key) {
    throw new Error(
      'FIREFLIES_API_KEY is not set — refusing to send an empty Authorization header.'
    );
  }
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
}

function backoffMs(attempt: number, res?: Response): number {
  const retryAfter = res?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

async function graphql<T>(
  operation: string,
  query: string,
  variables: Record<string, unknown>,
  schema: z.ZodType<T>,
  opts: FirefliesClientOptions = {}
): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? realSleep;
  const endpoint = opts.endpoint ?? FIREFLIES_GRAPHQL_URL;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: firefliesAuthHeaders(),
      body: JSON.stringify({ query, variables })
    });

    if (res.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new FirefliesApiError(
          `Rate limited by Fireflies (limits: free ${FIREFLIES_RATE_LIMITS.free}, pro ${FIREFLIES_RATE_LIMITS.pro}, business ${FIREFLIES_RATE_LIMITS.business}).`,
          429
        );
      }
      await sleep(backoffMs(attempt, res));
      continue;
    }

    const body: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      throw new FirefliesApiError(`HTTP ${res.status} from Fireflies`, res.status);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new FirefliesSchemaError(parsed.error.issues, operation);
    }

    // ⚠️ THE GRAPHQL TRAP: status is 200, but the operation failed. Checking
    // res.ok alone would return a null `data` as if it were success.
    const envelope = parsed.data as { errors?: { message: string }[] | null };
    if (envelope.errors && envelope.errors.length > 0) {
      throw new FirefliesGraphQLError(envelope.errors, operation);
    }

    return parsed.data;
  }

  throw new FirefliesApiError(`Fireflies request for ${operation} failed`, 0);
}

// ── Queries ─────────────────────────────────────────────────────────────────

const TRANSCRIPT_FIELDS = `
  id
  title
  date
  dateString
  duration
  host_email
  organizer_email
  transcript_url
  audio_url
  video_url
  participants
  speakers { id name }
  sentences { index speaker_name speaker_id text raw_text start_time end_time }
  summary { keywords action_items outline overview topics_discussed }
`;

const GET_TRANSCRIPT = `
  query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {${TRANSCRIPT_FIELDS}}
  }
`;

const GET_TRANSCRIPTS = `
  query Transcripts($limit: Int, $skip: Int) {
    transcripts(limit: $limit, skip: $skip) {${TRANSCRIPT_FIELDS}}
  }
`;

/**
 * Fetch one transcript in full, with speaker segments.
 *
 * `transcriptId` is the same value the webhook calls `meetingId`.
 *
 * Throws FirefliesGraphQLError when the transcript is not yet retrievable —
 * check `.isNotReady` to distinguish that from a real error.
 */
export async function getTranscript(
  transcriptId: string,
  opts: FirefliesClientOptions = {}
): Promise<FirefliesTranscript> {
  const body = await graphql(
    'transcript',
    GET_TRANSCRIPT,
    { transcriptId },
    transcriptQuerySchema,
    opts
  );

  const t = body.data?.transcript;
  if (!t) {
    // No errors array, but no transcript either. Treated as retryable: this is
    // what a not-yet-ready transcript can look like.
    throw new FirefliesGraphQLError(
      [{ message: `transcript ${transcriptId} not found or not ready` }],
      'transcript'
    );
  }
  return firefliesTranscriptSchema.parse(t);
}

/** Backfill / reconciliation. Also the recovery path for webhooks we never received. */
export async function getTranscripts(
  limit = 25,
  skip = 0,
  opts: FirefliesClientOptions = {}
): Promise<FirefliesTranscript[]> {
  const body = await graphql(
    'transcripts',
    GET_TRANSCRIPTS,
    { limit, skip },
    transcriptsQuerySchema,
    opts
  );
  return body.data?.transcripts ?? [];
}
