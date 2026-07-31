/**
 * Slack client — the email-scope trap.
 *
 * No database and no network: the behaviour under test is how we INTERPRET a
 * Slack response, and the response shapes below are copied from the live
 * workspace (30 humans, 0 emails, profile carrying only real_name/display_name).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  isLinkableSlackUser,
  listUsers,
  requireEmailScope,
  SLACK_EMAIL_SCOPE,
  SlackApiError,
  SlackScopeError,
  type SlackUser
} from './client';

const user = (over: Partial<SlackUser> & { id: string }): SlackUser =>
  ({
    name: 'someone',
    real_name: 'Some One',
    deleted: false,
    is_bot: false,
    profile: { real_name: 'Some One', display_name: 'someone' },
    ...over
  }) as SlackUser;

function mockFetch(pages: unknown[]) {
  let i = 0;
  return (async () => {
    const body = pages[Math.min(i, pages.length - 1)];
    i += 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as unknown as typeof fetch;
}

describe('requireEmailScope', () => {
  it('⚠️ throws when NO human has an email — the real missing-scope symptom', () => {
    // Slack does not error. It returns ok:true and drops profile.email, so this
    // is the only detectable signal. Verified live: 30 humans, 0 emails.
    const users = [user({ id: 'U1' }), user({ id: 'U2' }), user({ id: 'U3' })];
    expect(() => requireEmailScope(users, 'users.list')).toThrow(SlackScopeError);
  });

  it('the message names the scope, the reinstall, and the manual-linking consequence', () => {
    try {
      requireEmailScope([user({ id: 'U1' })], 'users.list');
      expect.unreachable('should have thrown');
    } catch (err) {
      const m = (err as Error).message;
      expect(m).toContain(SLACK_EMAIL_SCOPE);
      // A bare 401 sends the reader hunting for a bad token; say it is not that.
      expect(m).toContain('NOT an auth failure');
      expect(m).toMatch(/REINSTALL/i);
      expect(m).toContain('SLACK_BOT_TOKEN');
      expect(m).toMatch(/linked to a person by hand/i);
    }
  });

  it('does NOT throw when at least one human has an email', () => {
    const users = [
      user({ id: 'U1' }),
      user({ id: 'U2', profile: { email: 'someone@example.com' } })
    ];
    expect(() => requireEmailScope(users, 'users.list')).not.toThrow();
  });

  it('stays quiet on a workspace with no humans — nothing to conclude', () => {
    // Blaming the scope for an empty member list would be a false diagnosis.
    const bots = [user({ id: 'B1', is_bot: true }), user({ id: 'U2', deleted: true })];
    expect(() => requireEmailScope(bots, 'users.list')).not.toThrow();
  });

  it('ignores bots and deactivated accounts when judging', () => {
    // A bot with an email must not mask the fact that no human has one.
    const users = [
      user({ id: 'B1', is_bot: true, profile: { email: 'bot@example.com' } }),
      user({ id: 'U1' })
    ];
    expect(() => requireEmailScope(users, 'users.list')).toThrow(SlackScopeError);
  });
});

describe('isLinkableSlackUser', () => {
  it('excludes bots, deleted accounts and Slackbot', () => {
    expect(isLinkableSlackUser(user({ id: 'U1' }))).toBe(true);
    expect(isLinkableSlackUser(user({ id: 'B1', is_bot: true }))).toBe(false);
    expect(isLinkableSlackUser(user({ id: 'U2', deleted: true }))).toBe(false);
    expect(isLinkableSlackUser(user({ id: 'USLACKBOT' }))).toBe(false);
  });
});

describe('listUsers', () => {
  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-not-real';
  });

  it('follows cursor pagination — one page silently under-reports', async () => {
    const impl = mockFetch([
      { ok: true, members: [user({ id: 'U1' })], response_metadata: { next_cursor: 'abc' } },
      { ok: true, members: [user({ id: 'U2' })], response_metadata: { next_cursor: '' } }
    ]);
    const users = await listUsers({ fetchImpl: impl });
    expect(users.map((u) => u.id)).toEqual(['U1', 'U2']);
  });

  it('⚠️ treats ok:false as a failure even though the HTTP status is 200', async () => {
    const impl = mockFetch([{ ok: false, error: 'ratelimited' }]);
    await expect(listUsers({ fetchImpl: impl })).rejects.toThrow(SlackApiError);
  });

  it('maps an explicit missing_scope error to SlackScopeError', async () => {
    // Not the path that bites for users.list, but other methods do send this.
    const impl = mockFetch([
      { ok: false, error: 'missing_scope', needed: 'users:read.email', provided: 'users:read' }
    ]);
    await expect(listUsers({ fetchImpl: impl })).rejects.toThrow(SlackScopeError);
  });

  it('throws rather than sending an empty Authorization header', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    await expect(listUsers({ fetchImpl: mockFetch([{ ok: true, members: [] }]) })).rejects.toThrow(
      /SLACK_BOT_TOKEN/
    );
  });
});
