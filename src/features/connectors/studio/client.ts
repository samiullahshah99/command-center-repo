/**
 * Studio API client — INTERFACE ONLY, deliberately unimplemented.
 *
 * The Studio endpoints do not exist yet (awaiting Usama). This file exists so
 * calling code can be written and typed against a stable shape, and so the
 * absence is explicit rather than a missing file someone silently invents.
 *
 * Every method throws. Nothing here guesses at an endpoint path, an auth scheme,
 * or a response shape — inventing those would produce code that compiles, looks
 * finished, and is wrong.
 *
 * When the contract lands, implement against docs/webhook-contract.md (the pull
 * endpoint section) and mirror the ClickUp client's structure: Zod-validate every
 * response, handle 429, and keep auth in one place.
 */

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(
      `${what} is not implemented: the Studio API does not exist yet. ` +
        `See docs/webhook-contract.md and src/features/connectors/studio/client.ts.`
    );
    this.name = 'NotImplementedError';
  }
}

/** Placeholder — the real shape comes from the platform owner. */
export type StudioStat = {
  id: string;
  occurred_at: string;
  [key: string]: unknown;
};

export type StudioEventsQuery = {
  /** ISO 8601. Backfill and gap recovery — see the pull endpoint in the contract doc. */
  since: string;
  limit?: number;
  cursor?: string;
};

export interface StudioClient {
  /**
   * GET /events?since=<iso>
   *
   * The pull endpoint the contract requires alongside webhooks, so a delivery
   * gap can be recovered rather than silently lost.
   */
  getEvents(query: StudioEventsQuery): Promise<{ events: StudioStat[]; nextCursor?: string }>;
}

export const studioClient: StudioClient = {
  getEvents() {
    throw new NotImplementedError('studioClient.getEvents');
  }
};
