import type { RawEventSource } from '@/db/schema';
import type { ResolveInput } from '@/features/identity/types';

/**
 * One event, mapped out of a payload but not yet written or attributed.
 *
 * Deliberately has no person_id: a normaliser's job is to say WHO the source
 * claims did this (`identity`), not to decide which person that is. Resolution
 * happens once, centrally, so the three-Clerk-instances rule cannot be
 * reimplemented five slightly different ways.
 */
export type NormalisedEvent = {
  /**
   * Which event within one payload. 0 unless a source batches — see
   * unified_event.source_seq.
   */
  sourceSeq: number;

  /** The sender's own type string, verbatim. Unknown values are kept, not rejected. */
  eventType: string;

  occurredAt: Date;
  occurredAtSource: 'payload' | 'received_at';

  /**
   * The actor as the source describes them, for resolvePerson().
   *
   * NULL when the event genuinely has no actor — a system ping, or a payload
   * where the actor block is absent. That is distinct from "an actor with no
   * email", which is an identity that still gets recorded and queued.
   */
  identity: ResolveInput | null;

  subjectType: string | null;
  subjectId: string | null;
  subjectLabel: string | null;

  /** Source-specific remainder. NOT the whole payload — that is raw_event's job. */
  metadata: Record<string, unknown>;
};

export type NormaliseContext = {
  /** When we received it. The fallback for an unparseable timestamp. */
  receivedAt: Date;
};

/**
 * One per source, behind a shared shape.
 *
 * Pure: no database, no network, no clock beyond what ctx supplies. That is what
 * lets the tests run every real stored payload through them without a
 * connection, and what makes re-normalising deterministic.
 */
export type Normaliser = {
  source: RawEventSource;
  /**
   * Zero or more events from one payload.
   *
   * Returning [] means "this payload carries nothing mappable" — an off-contract
   * body, or an envelope whose shape we do not recognise. The caller leaves such
   * a row unprocessed so it stays visible rather than being silently consumed.
   */
  normalise(payload: unknown, ctx: NormaliseContext): NormalisedEvent[];
};

/** Narrowing helper — payloads arrive as `unknown` from jsonb. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  // ClickUp sends numeric ids; external ids are text everywhere downstream.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}
