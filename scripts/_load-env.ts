/**
 * Side-effect module: load `.env.local` into process.env.
 *
 *   import './_load-env';        // MUST be the first import
 *   import { db } from '@/db';
 *
 * For scripts run as a bare `pnpm tsx scripts/foo.ts`, with no
 * `--env-file=.env.local`. Most scripts here get env from a package.json alias
 * that passes the flag; this is for the ones documented to run directly.
 *
 * ⚠️ **It has to be a separate module, not a function called at the top of the
 * script.** ES imports are hoisted and evaluated before any of the importing
 * module's own statements, so a `loadEnvLocal()` call in the script body runs
 * AFTER every import has already been evaluated — too late for any module that
 * reads env at import time. `src/features/connectors/fireflies` has two such
 * reads (`NOT_FOUND_GRACE_MS`, `FIREFLIES_JOB_OPTIONS`); both have defaults, so
 * the failure is not a crash but a silently ignored override, which is worse.
 * A side-effect import is ordered, so it genuinely runs first.
 *
 * Same minimal parser as drizzle.config.ts — no extra dependency. Existing
 * process.env values WIN, so CI and one-off overrides beat the file.
 */

import { existsSync, readFileSync } from 'node:fs';

const PATH = '.env.local';

if (existsSync(PATH)) {
  for (const raw of readFileSync(PATH, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
}
