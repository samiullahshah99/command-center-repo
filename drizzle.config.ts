import { defineConfig } from 'drizzle-kit';
import { existsSync, readFileSync } from 'node:fs';

// drizzle-kit runs outside Next.js, so it does not get .env.local loaded for
// free. Minimal inline loader rather than pulling in another dependency.
// Existing process.env values win, so CI can override without editing files.
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

// Migrations always run from a laptop or CI, never from inside Railway's private
// network, so they need the PUBLIC host. The deployed app is the opposite: it
// should use DATABASE_URL pointed at postgres.railway.internal to keep query
// traffic on the private network. Hence two variables with a fallback, so a
// single-URL local setup keeps working.
const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'Neither DATABASE_PUBLIC_URL nor DATABASE_URL is set. Migrations need a publicly reachable Postgres URL.'
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/',
  out: './drizzle',
  // Scope drizzle-kit to `public` ONLY. pg-boss owns the `pgboss` schema and
  // manages its own migrations; without this, a future `drizzle-kit push` or
  // introspect could see those ~9 tables as drift and try to drop them.
  // `public` is drizzle-kit's default, so this makes the guarantee explicit
  // rather than relying on it.
  schemaFilter: ['public'],
  dbCredentials: {
    url,
    // Railway's Postgres proxy terminates TLS with a certificate that does not
    // chain to a public root, so strict verification fails even though the
    // connection genuinely is TLS 1.3 (verified via pg_stat_ssl).
    ssl: { rejectUnauthorized: false }
  },
  verbose: true,
  strict: true
});
