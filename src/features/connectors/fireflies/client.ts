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
  graphqlEnvelope,
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
/** One entry of a GraphQL `errors` array, as far as we read it. */
export type FirefliesGraphQLErrorEntry = {
  message: string;
  extensions?: Record<string, unknown> | null;
};

/**
 * Error codes seen in `extensions.code` on real responses.
 *
 * Preferred over matching the message text: the code is a stable identifier and
 * the prose is not. `paid_required` was captured live, with
 * `extensions.status = 403` and `metadata.tier = 'pro_or_higher'`.
 */
export const FIREFLIES_PERMANENT_CODES = [
  'paid_required',
  'forbidden',
  'unauthorized',
  'invalid_api_key',
  'account_suspended'
] as const;

function codeOf(e: FirefliesGraphQLErrorEntry): string {
  const c = e.extensions?.code;
  return typeof c === 'string' ? c.toLowerCase() : '';
}

function statusOf(e: FirefliesGraphQLErrorEntry): number | null {
  const s = e.extensions?.status;
  return typeof s === 'number' ? s : null;
}

export class FirefliesGraphQLError extends Error {
  constructor(
    readonly errors: FirefliesGraphQLErrorEntry[],
    readonly query: string
  ) {
    super(`Fireflies GraphQL error: ${errors.map((e) => e.message).join('; ')}`);
    this.name = 'FirefliesGraphQLError';
  }

  /**
   * PERMANENT: the plan does not include this endpoint.
   *
   * Captured live on a free account:
   *   "You need to be subscribed to a paid plan to perform this action"
   *   extensions: { code: 'paid_required', status: 403, metadata: { tier: 'pro_or_higher' } }
   *
   * No amount of retrying changes a billing tier.
   */
  get isPlanError(): boolean {
    return this.errors.some(
      (e) => codeOf(e) === 'paid_required' || /paid plan|subscription|upgrade/i.test(e.message)
    );
  }

  /** PERMANENT: a revoked, wrong, or unprivileged key. Retrying re-sends the same key. */
  get isAuthError(): boolean {
    return this.errors.some((e) => {
      const code = codeOf(e);
      const status = statusOf(e);
      return (
        code === 'unauthorized' ||
        code === 'forbidden' ||
        code === 'invalid_api_key' ||
        code === 'account_suspended' ||
        status === 401 ||
        (status === 403 && code !== 'paid_required') ||
        /unauthorized|invalid api key|authentication|not authorized/i.test(e.message)
      );
    });
  }

  /**
   * The transcript is not retrievable *right now*.
   *
   * ⚠️ AMBIGUOUS ON ITS OWN, which is why nothing calls this to make a retry
   * decision directly. Fireflies can announce a meeting before the transcript is
   * queryable — retryable — but the same message is returned for an id that will
   * never exist. Only elapsed time since the webhook arrived separates them; the
   * worker resolves it, not the client. See classifyTranscriptFetchError().
   */
  get isNotFoundOrNotReady(): boolean {
    return this.errors.some((e) =>
      /not found|not ready|still processing|processing|does not exist/i.test(e.message)
    );
  }

  /**
   * Retained for compatibility with existing callers and tests.
   * @deprecated Ambiguous — prefer classifyTranscriptFetchError(), which weighs
   * elapsed time. A bare "not found" is only *probably* a not-ready.
   */
  get isNotReady(): boolean {
    return this.isNotFoundOrNotReady && !this.isPlanError && !this.isAuthError;
  }

  /** True when no retry can help, ignoring the ambiguous not-found case. */
  get isDefinitelyPermanent(): boolean {
    return this.isPlanError || this.isAuthError;
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

// ── Retry classification ────────────────────────────────────────────────────

/**
 * How long after the webhook arrived a "transcript not found" is still treated
 * as "not ready yet" rather than "will never exist".
 *
 * ── Why a time threshold, and why 30 minutes ────────────────────────────────
 * Fireflies returns the same "not found" for two opposite situations: a
 * transcript still being produced (retry, it will appear) and an id that is
 * gone or was never real (do not retry). Nothing in the response distinguishes
 * them, so the only available signal is how long ago we were told about it.
 *
 * 30 minutes is chosen against the retry ladder rather than plucked out of the
 * air. FIREFLIES_JOB_OPTIONS is 3 retries at 60s with backoff — roughly
 * 60s → 2m → 4m, so a live webhook exhausts its attempts about 7 minutes after
 * arrival and dead-letters on its own. A threshold shorter than that would fire
 * during normal operation and cut a legitimate wait short; much longer and it
 * never fires at all. 30 minutes sits clear of the ladder while still failing
 * fast for the case that actually matters:
 *
 *   a BACKFILL re-enqueuing rows from hours or days ago. There, "not found" is
 *   permanent from the first attempt, and retrying each row four times against a
 *   500-per-DAY budget can exhaust the quota on events that can never resolve.
 */
export const NOT_FOUND_GRACE_MS =
  Number(process.env.FIREFLIES_NOT_FOUND_GRACE_MINUTES ?? 30) * 60_000;

export type FetchErrorClass = 'permanent' | 'transient';

/**
 * Decide whether a failed transcript fetch is worth retrying.
 *
 * `receivedAt` is when the WEBHOOK landed, not when this attempt ran — the
 * question is how long the transcript has had to appear, which a retry timestamp
 * would not answer.
 */
export function classifyTranscriptFetchError(
  err: unknown,
  receivedAt: Date,
  now: Date = new Date()
): { class: FetchErrorClass; reason: string } {
  const ageMs = now.getTime() - receivedAt.getTime();

  // A response we cannot parse means the API changed shape. Retrying re-parses
  // the same unfamiliar body; a human has to look.
  if (err instanceof FirefliesSchemaError) {
    return { class: 'permanent', reason: 'response_shape_changed' };
  }

  if (err instanceof FirefliesApiError) {
    // 429 is transient by definition, and 5xx is the server's problem, not ours.
    if (err.status === 429) return { class: 'transient', reason: 'rate_limited' };
    if (err.status >= 500) return { class: 'transient', reason: `http_${err.status}` };
    // Any other 4xx is a request we should not repeat unchanged.
    if (err.status >= 400) return { class: 'permanent', reason: `http_${err.status}` };
    return { class: 'transient', reason: 'network_or_unknown' };
  }

  if (err instanceof FirefliesGraphQLError) {
    if (err.isPlanError) return { class: 'permanent', reason: 'paid_plan_required' };
    if (err.isAuthError) return { class: 'permanent', reason: 'auth_failed' };

    if (err.isNotFoundOrNotReady) {
      return ageMs <= NOT_FOUND_GRACE_MS
        ? { class: 'transient', reason: `not_ready_yet (${Math.round(ageMs / 1000)}s old)` }
        : {
            class: 'permanent',
            reason: `not_found_after_${Math.round(ageMs / 60_000)}min — past the ${Math.round(
              NOT_FOUND_GRACE_MS / 60_000
            )}min grace, treating as gone`
          };
    }

    // An unrecognised GraphQL error: a malformed query, an unknown field, a new
    // code. None of those improve on retry.
    return { class: 'permanent', reason: 'unrecognised_graphql_error' };
  }

  // Anything else is most likely a network fault mid-flight — worth another go.
  return { class: 'transient', reason: 'network_or_unknown' };
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

/**
 * ⚠️ `audio_url` and `video_url` ARE DELIBERATELY ABSENT.
 *
 * Those two fields — and only those two — are gated behind a paid plan. Because
 * GraphQL fails the WHOLE operation when any requested field is unauthorised,
 * including them made every transcript fetch return
 *
 *   "You need to be subscribed to a paid plan to perform this action"
 *
 * which reads exactly like the entire API being unavailable. It is not: probed
 * field by field, `id`, `title`, `date`, `dateString`, `duration`, `host_email`,
 * `organizer_email`, `participants`, `speakers`, `sentences`, `summary` and even
 * `transcript_url` all return fine on the current plan.
 *
 * We do not use the media URLs — the text is what gets extracted — so removing
 * them costs nothing and unblocks the entire connector. Do not add them back
 * without re-checking the plan.
 */
const TRANSCRIPT_FIELDS = `
  id
  title
  date
  dateString
  duration
  host_email
  organizer_email
  transcript_url
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

/**
 * The four fields a meeting LIST needs, and nothing else.
 *
 * ⚠️ Deliberately not TRANSCRIPT_FIELDS. That pulls `sentences` — every line of
 * every meeting — plus speakers and the AI summary. For a 25-row picker that is
 * megabytes of payload to render four columns, and it makes the page's latency
 * scale with how much people talked rather than with how many meetings there
 * are. The full fetch happens once, later, for the one meeting chosen.
 */
const TRANSCRIPT_LIST_FIELDS = `
  id
  title
  date
  duration
`;

const LIST_TRANSCRIPTS = `
  query TranscriptsList($limit: Int, $skip: Int) {
    transcripts(limit: $limit, skip: $skip) {${TRANSCRIPT_LIST_FIELDS}}
  }
`;

export const firefliesTranscriptListItemSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  date: z.union([z.number(), z.string()]).nullish(),
  duration: z.number().nullish()
});

export type FirefliesTranscriptListItem = z.infer<typeof firefliesTranscriptListItemSchema>;

const listTranscriptsSchema = graphqlEnvelope(
  z.object({ transcripts: z.array(firefliesTranscriptListItemSchema).nullish() })
);

/**
 * List recent meetings — id, title, date, duration only.
 *
 * Note this succeeds for meetings whose FULL transcript is not retrievable on
 * the current plan: the list endpoint is not plan-gated, `transcript(id:)` is.
 * That asymmetry is why the picker can show a meeting it cannot yet open, and
 * why the UI has a dedicated "not available on the current Fireflies plan" state
 * rather than a generic error.
 */
export async function listTranscripts(
  limit = 25,
  skip = 0,
  opts: FirefliesClientOptions = {}
): Promise<FirefliesTranscriptListItem[]> {
  const body = await graphql(
    'transcripts',
    LIST_TRANSCRIPTS,
    { limit, skip },
    listTranscriptsSchema,
    opts
  );
  return body.data?.transcripts ?? [];
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
