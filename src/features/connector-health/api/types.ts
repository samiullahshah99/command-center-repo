import type { RawEventSource } from '@/db/schema/raw-event';

export type { RawEventSource };

/** Job counts for one source's `parse.<source>` queue, last 7 days. */
export type QueueHealth = {
  completed: number;
  /** pg-boss `retry` state — mid-ladder, not yet given up on. */
  retry: number;
  failed: number;
  /** Jobs still waiting: `created` + `active`. */
  pending: number;
};

export type ConnectorRow = {
  source: RawEventSource;
  /** ISO string, or null when this source has never delivered anything. */
  lastEventAt: string | null;
  count24h: number;
  count7d: number;
  countTotal: number;
  queue: QueueHealth;
  /** Hours of silence after which this source is considered quiet. */
  staleAfterHours: number;
};

export type ConnectorHealth = {
  sources: ConnectorRow[];
  /** Events received since UTC midnight, across all sources. */
  eventsToday: number;
  /** `failed` jobs across every queue in the last 7 days, including extraction. */
  jobsFailed: number;
  /**
   * Jobs sitting in the shared `parse.dead-letter` queue.
   *
   * ⚠️ NOT attributed per source, deliberately. Dead-lettered jobs all land in
   * ONE queue, so `pgboss.job.name` no longer says where they came from — the
   * origin is only inside `data`, and digging it out would mean a JSON join for
   * a number that is actionable globally anyway ("something is stuck, go look").
   */
  deadLettered: number;
  /**
   * The oldest `raw_event` still `processed = false`, if any. A growing age here
   * means the worker is not draining — the single most useful number on the page.
   */
  oldestUnprocessedAt: string | null;
  unprocessedCount: number;
  /**
   * Resolved ONCE on the server and threaded down. Every relative time and every
   * staleness comparison derives from this instant — a per-render clock differs
   * between SSR and hydration and drops the subtree.
   */
  now: string;
};
