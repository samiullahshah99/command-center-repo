/**
 * Notion credential verification — `pnpm verify:notion`
 *
 * Read-only. Confirms the integration token works and lists every database that
 * has actually been shared with it. Builds nothing.
 *
 * Exits 0 on success, 1 on auth/API failure, so silence can be told from a pass.
 */

import { existsSync, readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

// This script runs outside Next.js, so .env.local is not loaded for it. Same
// minimal inline loader as drizzle.config.ts rather than another dependency.
// Pre-existing process.env values win, so CI can override.
function loadEnvLocal() {
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

loadEnvLocal();

const NOTION_API_KEY = process.env.NOTION_API_KEY;

// ---------------------------------------------------------------------------
// Request plumbing
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.notion.com/v1';

/**
 * Notion-Version is MANDATORY on every request — omitting it returns 400
 * validation_error, not a default version. It lives here so no call site can
 * forget it.
 */
const NOTION_VERSION = '2022-06-28';

function headers(): Record<string, string> {
  return {
    // The key is only ever read here and never logged or echoed.
    Authorization: `Bearer ${NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  };
}

type NotionError = { object: 'error'; status: number; code: string; message: string };

function isNotionError(v: unknown): v is NotionError {
  return typeof v === 'object' && v !== null && (v as { object?: string }).object === 'error';
}

async function notionFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: headers(),
    signal: AbortSignal.timeout(30_000)
  });

  const body = (await res.json().catch(() => null)) as unknown;

  if (!res.ok) {
    const detail = isNotionError(body) ? `${body.code}: ${body.message}` : `HTTP ${res.status}`;
    throw new Error(detail);
  }

  return body;
}

// ---------------------------------------------------------------------------
// Types (only the fields this script reads)
// ---------------------------------------------------------------------------

type RichText = { plain_text?: string };

type NotionDatabase = {
  id: string;
  title?: RichText[];
  url?: string;
  parent?: { type?: string };
};

type SearchResponse = {
  results: NotionDatabase[];
  has_more: boolean;
  next_cursor: string | null;
};

type BotUser = {
  name?: string;
  type?: string;
  bot?: { owner?: { type?: string } };
};

function titleOf(db: NotionDatabase): string {
  const text = (db.title ?? [])
    .map((t) => t.plain_text ?? '')
    .join('')
    .trim();
  return text === '' ? '(untitled)' : text;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function verifyToken(): Promise<string> {
  const me = (await notionFetch('/users/me')) as BotUser;
  // Name only — never the token, and no other identifying fields.
  return me.name ?? '(unnamed integration)';
}

async function listDatabases(): Promise<NotionDatabase[]> {
  const all: NotionDatabase[] = [];
  let cursor: string | null = null;
  let pages = 0;

  // Cursor pagination: /search caps at 100 per call and signals more via
  // has_more. Returning only page one would silently under-report.
  do {
    const body = (await notionFetch('/search', {
      method: 'POST',
      body: JSON.stringify({
        filter: { property: 'object', value: 'database' },
        page_size: 50,
        ...(cursor ? { start_cursor: cursor } : {})
      })
    })) as SearchResponse;

    all.push(...(body.results ?? []));
    cursor = body.has_more ? body.next_cursor : null;
    pages += 1;

    // Notion allows ~3 req/s on average; pause between pages rather than
    // burst into a 429.
    if (cursor) await new Promise((r) => setTimeout(r, 350));
  } while (cursor);

  if (pages > 1) console.log(`  (followed ${pages} pages of results)\n`);

  return all;
}

function printTable(dbs: NotionDatabase[]) {
  const idWidth = 36;
  console.log(`  ${'DATABASE ID'.padEnd(idWidth)}  TITLE`);
  console.log(`  ${'-'.repeat(idWidth)}  ${'-'.repeat(40)}`);
  for (const db of dbs) {
    console.log(`  ${db.id.padEnd(idWidth)}  ${titleOf(db)}`);
  }
}

function printNothingSharedHelp() {
  console.log('  ⚠️  Token is VALID but zero databases are visible to it.\n');
  console.log('  This is almost certainly a sharing problem, not a token problem.');
  console.log('  Notion is deny-by-default per page: an integration sees nothing');
  console.log('  until a page or database is explicitly shared with it.\n');
  console.log('  To fix, in Notion:');
  console.log('    1. Open the database (or a parent page containing several)');
  console.log('    2. ⋯ menu (top right) → Connections');
  console.log('    3. Add "Command Center"\n');
  console.log('  Sharing a PARENT page cascades to its children, so sharing one');
  console.log('  top-level page is usually enough for everything beneath it.\n');
  console.log('  Then re-run: pnpm verify:notion');
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n  Notion credential verification');
  console.log('  ' + '='.repeat(52) + '\n');

  if (!NOTION_API_KEY) {
    console.error('  ❌ NOTION_API_KEY is not set.');
    console.error('     Add it to .env.local (see .env.example).');
    process.exit(1);
  }

  // Step 1 — token
  let botName: string;
  try {
    botName = await verifyToken();
    console.log(`  ✅ Token valid — integration: ${botName}`);
    console.log(`     Notion-Version: ${NOTION_VERSION}\n`);
  } catch (err) {
    console.error(`  ❌ Token check failed — ${err instanceof Error ? err.message : err}`);
    console.error('     unauthorized => the key is wrong, revoked, or not an');
    console.error('     internal integration secret (should start "ntn_" or "secret_").');
    process.exit(1);
  }

  // Step 2 — databases
  try {
    const dbs = await listDatabases();

    if (dbs.length === 0) {
      printNothingSharedHelp();
      // Deliberately exit 0: the CREDENTIAL is verified, which is what this
      // script is for. Sharing is a separate, manual Notion step.
      process.exit(0);
    }

    console.log(`  Found ${dbs.length} shared database${dbs.length === 1 ? '' : 's'}:\n`);
    printTable(dbs);
    console.log('\n  Set NOTION_DATABASE_ID in .env.local to whichever you need.');
  } catch (err) {
    console.error(`\n  ❌ Database search failed — ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`  ❌ Unexpected failure — ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
