/**
 * Internal backend API client — INTERFACE ONLY, deliberately unimplemented.
 *
 * ── Why this exists instead of a Shopify client ─────────────────────────────
 * PRD §5.5 / §7 lists "Shopify | Read | Context for the copilot and status
 * queries (orders, inventory)". Per the team lead, direct Shopify Admin API
 * access is REPLACED by internal backend endpoints. Do not build a Shopify
 * client — Shopify credentials are not being requested and `SHOPIFY_*` variables
 * should never reappear in .env.example.
 *
 * Those internal endpoints do not exist yet (awaiting the backend engineer).
 * This file exists so calling code can be written and typed against a stable
 * shape, and so the gap is explicit rather than a missing module someone fills
 * in by guessing.
 *
 * Every method throws. Nothing here invents an endpoint path, an auth scheme, or
 * a response shape — a stub that compiles and is wrong is worse than one that
 * throws, because the wrong one survives review.
 *
 * ── Shape: point lookups, not a bulk sync ───────────────────────────────────
 * The copilot answers ad-hoc questions ("where is order 1042?", "do we have SKU
 * X in stock?", "what has Jane ordered?"), so this is a request/response lookup
 * client. It deliberately has no list-everything, no cursor pagination over the
 * full catalogue, and no local mirror of orders or inventory — that data stays
 * in the backend and is read at question time.
 *
 * When the contract lands, mirror the ClickUp client's structure: Zod-validate
 * every response, handle 429 with backoff, and keep auth in one place.
 */

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(
      `${what} is not implemented: the internal backend endpoints do not exist yet. ` +
        `This replaced direct Shopify Admin API access — see CLAUDE.md and ` +
        `src/features/connectors/backend/client.ts.`
    );
    this.name = 'NotImplementedError';
  }
}

// ── Placeholder types ───────────────────────────────────────────────────────
// Every one of these is a GUESS at the shape and must be replaced with the real
// contract. The index signature is there so a field we did not anticipate is
// preserved rather than dropped, and so nothing reads as authoritative.

/** Placeholder — the real shape comes from the backend engineer. */
export type BackendOrder = {
  /** The human-facing number a person would quote, e.g. "1042" or "#1042". */
  orderNumber: string;
  [key: string]: unknown;
};

/** Placeholder — the real shape comes from the backend engineer. */
export type BackendInventoryItem = {
  sku: string;
  [key: string]: unknown;
};

/** Placeholder — the real shape comes from the backend engineer. */
export type BackendCustomerOrderSummary = {
  orderNumber: string;
  [key: string]: unknown;
};

export type CustomerSearchQuery = {
  /** Free-text name as a person would type it. Matching semantics are the backend's call. */
  name: string;
  limit?: number;
};

// ── Interface ───────────────────────────────────────────────────────────────

export interface BackendClient {
  /**
   * Look up a single order by its human-facing number.
   *
   * Returns null when no such order exists — "not found" is an ordinary answer
   * to a copilot question, not an error worth throwing.
   */
  getOrderByNumber(orderNumber: string): Promise<BackendOrder | null>;

  /**
   * Look up stock for one SKU.
   *
   * Returns null when the SKU is unknown, for the same reason as above.
   */
  getInventoryBySku(sku: string): Promise<BackendInventoryItem | null>;

  /**
   * Find a customer's orders by name.
   *
   * The one non-point lookup, because "what has Jane ordered?" is a question the
   * copilot will be asked. Returns an empty array when nothing matches.
   *
   * TODO(contract): name matching is ambiguous — exact, prefix, or fuzzy? Two
   * customers can share a name. Confirm whether the backend disambiguates or
   * returns all matches.
   */
  searchOrdersByCustomerName(query: CustomerSearchQuery): Promise<BackendCustomerOrderSummary[]>;
}

export const backendClient: BackendClient = {
  getOrderByNumber() {
    throw new NotImplementedError('backendClient.getOrderByNumber');
  },
  getInventoryBySku() {
    throw new NotImplementedError('backendClient.getInventoryBySku');
  },
  searchOrdersByCustomerName() {
    throw new NotImplementedError('backendClient.searchOrdersByCustomerName');
  }
};

// ── Questions for the backend engineer ──────────────────────────────────────
//
//  1. Base URL and auth scheme. BACKEND_API_URL / BACKEND_API_TOKEN are
//     reserved in .env.example; is it a Bearer token, a raw header, or
//     something else? (Every connector so far has differed.)
//  2. Order lookup: is the key the display number ("#1042") or an internal id?
//     Does it accept the leading "#"?
//  3. Inventory: is a SKU globally unique, or scoped per location/warehouse?
//  4. Customer search: exact, prefix, or fuzzy matching — and what happens with
//     two customers of the same name?
//  5. Rate limits, and the error shape on exceeding them.
//  6. Are order and inventory reads live, or served from a cache with a lag the
//     copilot should disclose?
