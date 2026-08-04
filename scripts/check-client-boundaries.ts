/**
 * Fail if a client component imports a server-only module.
 *
 *   pnpm lint:boundaries
 *
 * ── Why this exists alongside `server-only` ──────────────────────────────────
 * `import 'server-only'` is the better guard where it can be used: it fails the
 * BUILD with a message naming the boundary. But it cannot be applied to
 * `src/db/index.ts`, which is the module that actually pulls in `pg`:
 * `server-only` resolves to a throwing module under Node's DEFAULT condition, and
 * 14 tsx scripts (db:seed, events:attribute, renormalise, eval:extraction …) plus
 * the node-env vitest suites import `@/db` directly. Marking it would break every
 * one of them.
 *
 * So this covers the gap: a cheap, deterministic scan that needs no new
 * dependency and no ESLint (this repo is oxlint-only by convention, and oxlint
 * cannot express "files containing 'use client'" — client-ness is a file marker
 * here, not a path convention, so a glob-scoped rule cannot see it).
 *
 * ── What it catches ─────────────────────────────────────────────────────────
 * The real regression: `home-view.tsx` ('use client') imported `BRIEF_STATES`
 * from `@/lib/brief-fold`, which imports `db`. The symptom was seven Turbopack
 * errors naming `dns` / `net` / `tls` / `fs` inside pg internals — no mention of
 * the import that caused it.
 *
 * ⚠️ DIRECT imports only. This does not walk the module graph, so a client file
 * importing a clean module that itself imports `@/db` still slips through. That
 * bound is deliberate: a full graph walk needs a bundler, and the direct case is
 * the one that has actually bitten. `server-only` catches the transitive case on
 * any module it can be applied to.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Module specifiers no client component may import.
 *
 * ⚠️ PRECISION MATTERS MORE THAN REACH HERE. A first version forbade all of
 * `@/db/*` and bare `drizzle-orm`, and flagged two files that build and run
 * perfectly — `person-identities-card.tsx` importing `IDENTITY_SOURCES` and
 * `kanban-view.tsx` importing `TRACKED_ITEM_STATUSES`. Both are CONSTANTS from
 * schema modules, which pull in `drizzle-orm/pg-core` (a query builder, no
 * driver) and never `pg`. Proven by the build passing today with both in place.
 *
 * A gate that fails on working code gets disabled or ignored, and then it is
 * worth less than no gate. So this lists only what actually breaks:
 *
 *   ✗ `@/db`                      — creates `new Pool()` from pg
 *   ✗ `drizzle-orm/node-postgres` — the pg driver adapter
 *   ✗ the two src/lib modules that import `@/db`
 *   ✓ `@/db/schema/*`             — table defs + zod, client-safe
 *   ✓ bare `drizzle-orm`          — isomorphic core
 */
const FORBIDDEN = [
  {
    // `@/db` exactly — NOT `@/db/schema/...`. The `'` terminator is what makes
    // that distinction; a `@/db(/...)?` pattern is what produced the false
    // positives described above.
    pattern: /from\s+'@\/db'/,
    why: "'@/db' creates a pg Pool (needs dns/net/tls). Query behind a 'use server' function."
  },
  {
    pattern: /from\s+'drizzle-orm\/node-postgres'/,
    why: "the pg driver adapter is server-only"
  },
  {
    pattern: /from\s+'@\/lib\/brief-fold'/,
    why: "'@/lib/brief-fold' imports db — import state constants from '@/lib/brief-states'"
  },
  {
    pattern: /from\s+'@\/lib\/nav-counts'/,
    why: "'@/lib/nav-counts' imports db — fetch it through /api/nav-badges"
  }
];

/**
 * A `type`-only import is erased at compile time and never reaches the bundle, so
 * it is legal from a client component. Excluding it avoids false positives that
 * would push people to duplicate types instead.
 */
const TYPE_ONLY = /^\s*import\s+type\s/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk('src');
let violations = 0;
let clientFiles = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  // 'use client' must be the first statement, so checking the head is sufficient
  // and avoids matching the string inside a comment further down.
  if (!/^\s*(['"])use client\1/m.test(source.slice(0, 400))) continue;
  clientFiles += 1;

  source.split('\n').forEach((line, i) => {
    if (TYPE_ONLY.test(line)) return;
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(line)) {
        violations += 1;
        console.error(`\n  ${file}:${i + 1}`);
        console.error(`    ${line.trim()}`);
        console.error(`    ✗ ${why}`);
      }
    }
  });
}

if (violations > 0) {
  console.error(
    `\n  ${violations} boundary violation(s) across ${clientFiles} client component(s).`
  );
  console.error(
    '  A client component cannot reach the database. Move the query behind a'
  );
  console.error(
    "  'use server' function and consume it through a TanStack queryFn, as in"
  );
  console.error('  src/features/people/api/service.ts.\n');
  process.exit(1);
}

console.log(`  ✓ ${clientFiles} client component(s) — no server-only imports.`);
