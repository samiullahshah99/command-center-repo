/**
 * Shared plumbing for the ClickUp webhook scripts.
 *
 * These scripts are run MANUALLY and never on boot. Registering a webhook is a
 * side-effecting call against a live workspace, and ClickUp does NOT deduplicate
 * registrations — running it twice creates two webhooks that both deliver.
 */

import { existsSync, readFileSync } from 'node:fs';

/**
 * These scripts run outside Next.js, so .env.local is not loaded for them.
 * Same minimal inline loader as drizzle.config.ts and verify-notion.ts rather
 * than another dependency. Pre-existing process.env values win, so CI can
 * override.
 */
export function loadEnvLocal() {
  if (!existsSync('.env.local')) return;
  for (const raw of readFileSync('.env.local', 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
}

export const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`  ❌ ${name} is not set. Add it to .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}

/**
 * ClickUp takes the token RAW — no "Bearer " prefix. Adding one returns
 * OAUTH_025; omitting the header returns OAUTH_017.
 */
export function clickUpHeaders(token: string): Record<string, string> {
  return { Authorization: token, 'Content-Type': 'application/json' };
}

type ClickUpErrorBody = { err?: string; ECODE?: string };

export async function clickUpFetch<T>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${CLICKUP_BASE_URL}${path}`, {
    ...init,
    headers: clickUpHeaders(token),
    signal: AbortSignal.timeout(30_000)
  });

  const body = (await res.json().catch(() => null)) as unknown;

  if (!res.ok || (body as ClickUpErrorBody)?.err) {
    const e = body as ClickUpErrorBody;
    const detail = e?.err ? `${e.ECODE ?? 'ERR'}: ${e.err}` : `HTTP ${res.status}`;
    throw new Error(detail);
  }

  return body as T;
}

export type ClickUpWebhook = {
  id: string;
  endpoint?: string;
  /** Present only in the CREATE response, never when listing. */
  secret?: string;
  events?: string[];
  health?: { status?: string; fail_count?: number };
  space_id?: number | null;
  folder_id?: number | null;
  list_id?: number | null;
  task_id?: string | null;
};

export function banner(title: string) {
  console.log(`\n  ${title}`);
  console.log('  ' + '='.repeat(Math.max(title.length, 52)) + '\n');
}
