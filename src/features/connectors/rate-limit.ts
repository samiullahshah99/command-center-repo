/**
 * Rate-limit headroom logging, shared by the REST connectors.
 *
 * ── What each provider ACTUALLY exposes (measured, not assumed) ─────────────
 *
 *   ClickUp   ✅ x-ratelimit-limit: 100
 *             ✅ x-ratelimit-remaining: 99
 *             ✅ x-ratelimit-reset: 1785527372   (epoch SECONDS, not millis)
 *             Present on every 200. Real headroom is readable per call.
 *
 *   Slack     ❌ NOTHING. A successful auth.test returns no x-ratelimit-*,
 *             no x-remaining, nothing quota-related at all — verified against
 *             the live workspace. Slack's limits are per-METHOD tiers and the
 *             only signal is `Retry-After` on a 429, i.e. after you have already
 *             exceeded them. Headroom cannot be logged for Slack; see
 *             noteSlackResponse().
 *
 *   Fireflies ❌ No quota headers either, and its limit is per DAY, so a 429 is
 *             a much bigger deal there. Handled in its own client's backoff.
 *
 * The asymmetry matters: writing one "log the remaining quota" helper and
 * pointing it at both would silently log nothing for Slack while looking like it
 * worked, which is the failure this file exists to avoid.
 */

/** Warn when fewer than this fraction of the window remains. */
const DEFAULT_WARN_FRACTION = Number(process.env.RATE_LIMIT_WARN_FRACTION ?? 0.2);

/** Warn regardless of fraction once the absolute count drops this low. */
const DEFAULT_WARN_FLOOR = Number(process.env.RATE_LIMIT_WARN_FLOOR ?? 10);

export type RateLimitSnapshot = {
  provider: string;
  limit: number | null;
  remaining: number | null;
  /** Seconds until the window resets, or null when unknown. */
  resetInSeconds: number | null;
  low: boolean;
};

function num(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read and log ClickUp's headroom.
 *
 * ⚠️ `x-ratelimit-reset` is epoch SECONDS. Treating it as millis yields a reset
 * ~56 years in the past and a nonsense negative countdown — the same
 * seconds-vs-millis trap the normaliser's time parsing documents.
 */
export function noteClickUpResponse(res: Response, method: string): RateLimitSnapshot {
  const limit = num(res.headers.get('x-ratelimit-limit'));
  const remaining = num(res.headers.get('x-ratelimit-remaining'));
  const resetEpochSeconds = num(res.headers.get('x-ratelimit-reset'));

  const resetInSeconds =
    resetEpochSeconds === null
      ? null
      : Math.max(0, Math.round(resetEpochSeconds - Date.now() / 1000));

  const low =
    remaining !== null &&
    (remaining <= DEFAULT_WARN_FLOOR ||
      (limit !== null && limit > 0 && remaining / limit <= DEFAULT_WARN_FRACTION));

  const snapshot: RateLimitSnapshot = {
    provider: 'clickup',
    limit,
    remaining,
    resetInSeconds,
    low
  };

  if (remaining === null) {
    // Worth noticing: it means the contract changed, and headroom is now blind.
    console.warn(`[ratelimit:clickup] ${method} — no x-ratelimit-remaining header on the response`);
    return snapshot;
  }

  const line =
    `[ratelimit:clickup] ${method} ${remaining}/${limit ?? '?'} remaining` +
    (resetInSeconds !== null ? `, resets in ${resetInSeconds}s` : '');

  // console.warn, not log: next.config.ts strips console.* in production except
  // error and warn, and production is exactly where headroom matters.
  if (low) {
    console.warn(`⚠️  ${line} — LOW HEADROOM (limit is 100/min on our plan)`);
  } else {
    console.warn(line);
  }

  return snapshot;
}

/**
 * Slack has no headroom to read, so this records what it DOES tell us.
 *
 * Two useful things come back instead:
 *
 *  - `retry-after` on a 429, in seconds. That is the only quota signal Slack
 *    gives, and it arrives after the fact.
 *  - `x-oauth-scopes` on every response — the scopes actually granted. That is
 *    a far better way to detect a missing scope than inferring it from empty
 *    results, which is what the identity backfill had to do.
 */
export function noteSlackResponse(res: Response, method: string): RateLimitSnapshot {
  const retryAfter = num(res.headers.get('retry-after'));

  if (res.status === 429) {
    console.warn(
      `⚠️  [ratelimit:slack] ${method} 429 RATE LIMITED — retry after ${retryAfter ?? '?'}s. ` +
        `Slack limits are per-method tiers and expose no remaining-quota header, so this is the ` +
        `first and only warning.`
    );
  }

  return {
    provider: 'slack',
    // Genuinely unknowable, and null says so rather than implying zero.
    limit: null,
    remaining: null,
    resetInSeconds: retryAfter,
    low: res.status === 429
  };
}

/** The scopes Slack says this token holds, from any response. */
export function slackGrantedScopes(res: Response): string[] {
  return (res.headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Warn once per process when a scope we depend on is absent.
 *
 * Cheaper and more direct than the identity backfill's inference from "nobody
 * has an email", and it fires on ANY Slack call rather than only during a
 * backfill run.
 */
const warnedScopes = new Set<string>();

export function warnIfScopeMissing(res: Response, scope: string, consequence: string): void {
  if (warnedScopes.has(scope)) return;

  const granted = slackGrantedScopes(res);
  // No header means we cannot tell; do not cry wolf.
  if (granted.length === 0) return;

  if (!granted.includes(scope)) {
    warnedScopes.add(scope);
    console.warn(
      `⚠️  [slack:scope] "${scope}" is NOT granted. ${consequence} ` +
        `Granted: ${granted.join(', ')}. Add it at api.slack.com/apps → OAuth & Permissions, ` +
        `then REINSTALL the app and update SLACK_BOT_TOKEN.`
    );
  }
}
