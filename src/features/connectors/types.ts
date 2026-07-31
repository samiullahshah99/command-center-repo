/**
 * Shared connector types.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 * No shared HTTP client, no retry/backoff helper, no pagination abstraction, no
 * base class to extend.
 *
 * The four planned connectors have almost nothing in common at the request
 * layer: Slack and ClickUp are REST, Fireflies is GraphQL-only, Studio is TBD.
 * Their pagination models differ (cursor / page number / GraphQL), as do their
 * rate limits and signature schemes. Any shared request layer written now would
 * need special-casing for at least two of them on day one.
 *
 * What they genuinely share is exactly two things, and that is all this file
 * abstracts:
 *   1. ONE write path into raw_event  -> ingestRawEvent (./ingest.ts)
 *   2. An auth-header convention that must not be hand-written at call sites
 *
 * Extract more only once two connectors provably want the same thing.
 */

import { RAW_EVENT_SOURCES, type RawEventSource } from '@/db/schema';

// ── Sources ─────────────────────────────────────────────────────────────────

/**
 * Derived from the DB schema rather than redeclared, so a connector can never
 * write a `source` value the table does not recognise.
 *
 * Note this is the full set of raw_event writers, which is a superset of the
 * connectors that exist: 'fireflies' has no connector yet (day 4).
 */
export type ConnectorSource = RawEventSource;

export { RAW_EVENT_SOURCES as CONNECTOR_SOURCES };

// ── Auth ────────────────────────────────────────────────────────────────────

/**
 * Builds the auth headers for one provider.
 *
 * This exists for one reason: a wrong Authorization header returns a 401 that is
 * indistinguishable from a revoked or mistyped token, and the conventions are
 * inconsistent enough to get wrong from memory:
 *
 *   slack      Authorization: Bearer xoxb-...
 *   clickup    Authorization: <token>            ← RAW, no "Bearer " prefix
 *   fireflies  Authorization: Bearer ...         ← GraphQL only
 *   studio     TBD                               ← BACKEND_API_TOKEN
 *
 * Each connector encodes its own convention once. Nothing else builds these.
 *
 * Implementations read from process.env and must THROW when the variable is
 * missing, rather than emitting `Bearer undefined` and producing that same
 * ambiguous 401.
 */
export type AuthHeaders = () => Record<string, string>;

// ── Inbound webhooks ────────────────────────────────────────────────────────

/**
 * Optional. Pull-only providers have none — Notion, for example, has no webhook
 * API for internal integrations at all.
 */
export interface WebhookSupport {
  /** Header carrying the signature. Recorded for diagnostics and logging. */
  readonly signatureHeader: string;

  /**
   * Verify an inbound request.
   *
   * ⚠️ `rawBody` MUST be the raw request text, exactly as received. Parsing to
   * JSON and re-serialising changes key order and whitespace, so the recomputed
   * HMAC will not match. This is the single most common way webhook
   * verification gets built wrong.
   *
   * Implementations must use a timing-safe comparison, and should reject stale
   * timestamps where the provider supplies one (Slack sends one specifically to
   * make replay attacks detectable).
   */
  verify(input: { rawBody: string; headers: Headers }): Promise<boolean>;

  /**
   * The provider's own event id, for idempotency. Return null when the provider
   * sends none — ingest then falls back to non-deduplicated insert.
   */
  externalIdOf(payload: unknown): string | null;

  /**
   * Registration handshake, where the provider validates the URL at the moment
   * it is saved. Slack posts a `url_verification` event whose `challenge` must be
   * echoed back within 3 seconds.
   *
   * Return null when the payload is not a handshake.
   */
  handshake?(payload: unknown): { status: number; body: string } | null;
}

// ── Connector descriptor ────────────────────────────────────────────────────

/**
 * A plain object, not a class and not a base to extend. Each connector exports
 * one of these plus whatever client it needs; there is no inherited behaviour.
 */
export interface Connector {
  readonly source: ConnectorSource;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly authHeaders: AuthHeaders;
  /** Absent for pull-only providers. */
  readonly webhook?: WebhookSupport;
}

// ── Ingest ──────────────────────────────────────────────────────────────────

export interface IngestRawEventInput {
  source: ConnectorSource;

  /**
   * Stored VERBATIM. Do not normalise, reshape, or strip fields — the whole
   * point of raw_event is that a parser bug is replayable.
   */
  payload: unknown;

  /** Defaults to now(). Pass the provider's own timestamp when it sends one. */
  receivedAt?: Date;

  /**
   * The provider's event id. When present, ingest is idempotent on
   * (source, externalId) via a partial unique index. When absent, every call
   * inserts — providers that send no id cannot be deduplicated.
   */
  externalId?: string | null;
}

export interface IngestResult {
  /** false when an existing row with the same (source, externalId) suppressed it. */
  inserted: boolean;
  /** raw_event.id on insert; null when suppressed as a duplicate. */
  id: string | null;
  duplicate: boolean;
}
