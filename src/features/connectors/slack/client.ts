/**
 * Slack Web API client — only what identity backfill needs.
 *
 * ⚠️⚠️ SLACK IDENTITIES HAVE NO AUTOMATIC RESOLUTION PATH TODAY.
 *
 * Slack event envelopes carry a user id (`U…`) and nothing else — no email, no
 * name. Email is the only automatic cross-system join key we have, so the ONLY
 * way to resolve a Slack account without a human is `users.info`, and that
 * returns `user.profile.email` **only** when the token holds the
 * `users:read.email` scope.
 *
 * We currently hold `users:read`, which is NOT sufficient. Until the scope is
 * added and the app reinstalled, EVERY Slack user must be linked by hand in the
 * admin UI. That is the single largest manual cost in the identity model.
 *
 * ── ⚠️ HOW THE MISSING SCOPE ACTUALLY MANIFESTS (verified live) ─────────────
 * NOT as an error. `users.list` and `users.info` return HTTP 200 with
 * `ok: true` and simply OMIT `profile.email`. Confirmed against the real
 * workspace on the current token: 60 members, 30 humans, **0 with an email**,
 * and `profile` containing only `real_name` and `display_name`.
 *
 * This is the worst possible failure shape — a backfill would report success,
 * link nobody, and say nothing about why. So absence is detected explicitly and
 * converted into SlackScopeError by requireEmailScope(); it is not inferred from
 * an error Slack never sends.
 *
 * Some other Slack methods DO return `{ ok: false, error: "missing_scope" }`, so
 * that path is handled too — but it is not the one that bites here.
 */

import * as z from 'zod';
import { noteSlackResponse, warnIfScopeMissing } from '../rate-limit';
import { slackAuthHeaders } from './index';

export const SLACK_API_BASE = 'https://slack.com/api';

/** The scope `users.info` needs before it will include an email. */
export const SLACK_EMAIL_SCOPE = 'users:read.email';

export class SlackApiError extends Error {
  constructor(
    readonly slackError: string,
    readonly method: string
  ) {
    super(`Slack ${method} failed: ${slackError}`);
    this.name = 'SlackApiError';
  }
}

/**
 * Raised specifically for a missing OAuth scope.
 *
 * Separate from SlackApiError because the remedy is a workspace-admin action,
 * not a retry or a code fix, and the message has to say exactly which scope and
 * that a reinstall is required — a bare "missing_scope" or a 401 sends whoever
 * reads it looking for a bad token instead.
 */
export class SlackScopeError extends Error {
  constructor(
    readonly neededScope: string,
    readonly method: string,
    readonly detail?: string
  ) {
    super(
      `Slack ${method} needs the "${neededScope}" scope and this token does not have it.\n` +
        `\n` +
        `      This is NOT an auth failure and NOT a 401 — the token is valid and the call\n` +
        `      returned HTTP 200. Slack signals the missing scope by OMITTING profile.email\n` +
        `      from every user, so nothing looks wrong until no identity resolves.\n` +
        (detail ? `      ${detail}\n` : '') +
        `\n` +
        `      Fix: api.slack.com/apps -> your app -> OAuth & Permissions ->\n` +
        `           Bot Token Scopes -> add "${neededScope}", then REINSTALL the app to the\n` +
        `           workspace (new scopes do not apply to an existing installation) and put\n` +
        `           the new xoxb- token in SLACK_BOT_TOKEN.\n` +
        `\n` +
        `      Until then Slack has NO automatic identity resolution: every Slack user must\n` +
        `      be linked to a person by hand.`
    );
    this.name = 'SlackScopeError';
  }
}

const slackErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  needed: z.string().nullish(),
  provided: z.string().nullish()
});

const slackUserSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  real_name: z.string().nullish(),
  deleted: z.boolean().nullish(),
  is_bot: z.boolean().nullish(),
  profile: z
    .object({
      email: z.string().nullish(),
      real_name: z.string().nullish(),
      display_name: z.string().nullish()
    })
    .nullish()
});

const usersInfoSchema = z.object({ ok: z.literal(true), user: slackUserSchema });
const usersListSchema = z.object({
  ok: z.literal(true),
  members: z.array(slackUserSchema).default([]),
  response_metadata: z.object({ next_cursor: z.string().nullish() }).nullish()
});

export type SlackUser = z.infer<typeof slackUserSchema>;

export type SlackClientOptions = { fetchImpl?: typeof fetch; baseUrl?: string };

async function call<T>(
  method: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
  opts: SlackClientOptions = {}
): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? SLACK_API_BASE;
  const url = `${base}/${method}?${new URLSearchParams(params).toString()}`;

  const res = await doFetch(url, { method: 'GET', headers: slackAuthHeaders() });

  // ⚠️ Slack exposes NO remaining-quota header — measured, not assumed. The only
  // quota signal is Retry-After on a 429, i.e. after the fact. This records that
  // and, more usefully, reads x-oauth-scopes: a direct answer to "do we have the
  // scope?", instead of inferring it from every user having no email.
  noteSlackResponse(res, method);
  warnIfScopeMissing(
    res,
    SLACK_EMAIL_SCOPE,
    'Slack identities therefore have NO automatic resolution path and must be linked by hand.'
  );

  const body: unknown = await res.json().catch(() => null);

  // ⚠️ Order matters: check Slack's own `ok` BEFORE res.ok. A missing scope is a
  // 200, so an HTTP-first check would misreport it as success.
  const failure = slackErrorSchema.safeParse(body);
  if (failure.success) {
    if (failure.data.error === 'missing_scope') {
      throw new SlackScopeError(
        failure.data.needed ?? SLACK_EMAIL_SCOPE,
        method,
        failure.data.provided ?? undefined
      );
    }
    throw new SlackApiError(failure.data.error, method);
  }

  if (!res.ok) throw new SlackApiError(`http_${res.status}`, method);

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SlackApiError(
      `unexpected response shape: ${parsed.error.issues[0]?.message}`,
      method
    );
  }
  return parsed.data;
}

/**
 * One user by id.
 *
 * ⚠️ Returns successfully WITHOUT an email when the users:read.email scope is
 * absent — it does not throw. Verified live. Callers that need the address must
 * run the result through requireEmailScope(), or they will treat a scope problem
 * as "this person has no email".
 */
export async function getUserInfo(userId: string, opts: SlackClientOptions = {}) {
  const body = await call('users.info', { user: userId }, usersInfoSchema, opts);
  return body.user;
}

/**
 * Every member of the workspace, following cursor pagination.
 *
 * Reading only the first page silently under-reports, which for a backfill means
 * quietly leaving people unlinked.
 */
export async function listUsers(opts: SlackClientOptions = {}): Promise<SlackUser[]> {
  const all: SlackUser[] = [];
  let cursor = '';

  do {
    const page = await call(
      'users.list',
      { limit: '200', ...(cursor ? { cursor } : {}) },
      usersListSchema,
      opts
    );
    all.push(...page.members);
    cursor = page.response_metadata?.next_cursor?.trim() ?? '';
  } while (cursor);

  return all;
}

/** Real humans only — bots and deactivated accounts are not people in the roster. */
export function isLinkableSlackUser(u: SlackUser): boolean {
  return !u.is_bot && !u.deleted && u.id !== 'USLACKBOT';
}

/**
 * Turn a silently email-less response into the actionable error it deserves.
 *
 * ⚠️ THIS is how the missing scope is really caught. Slack does not refuse the
 * call — it drops `profile.email` and returns ok:true, so the only detectable
 * symptom is that NOBODY has an email. Verified live: 30 humans, 0 emails.
 *
 * Every real Slack member has an email address, so zero-out-of-N is scope, not
 * data. The check needs at least one human to be meaningful; with none, there is
 * nothing to conclude and it stays quiet rather than blaming the scope for an
 * empty workspace.
 */
export function requireEmailScope(users: SlackUser[], method: string): void {
  const humans = users.filter(isLinkableSlackUser);
  if (humans.length === 0) return;

  const withEmail = humans.filter((u) => u.profile?.email);
  if (withEmail.length > 0) return;

  throw new SlackScopeError(
    SLACK_EMAIL_SCOPE,
    method,
    `Checked ${humans.length} non-bot member(s) and not one had profile.email.`
  );
}
