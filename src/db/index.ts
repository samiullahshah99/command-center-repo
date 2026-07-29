import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// This app runs as a long-lived container on Railway (output: 'standalone'),
// NOT on a serverless platform. A connection pool is therefore correct — a
// per-request client would pay TCP + TLS handshake cost on every query.
//
// Runtime uses DATABASE_URL, which in Railway should point at
// postgres.railway.internal so queries stay on the private network. Migrations
// use DATABASE_PUBLIC_URL instead (see drizzle.config.ts).
//
// ── Why this is lazy ────────────────────────────────────────────────────────
// Everything below is created on FIRST USE, never at module load.
//
// Next.js's "Collecting page data" step imports every route module during
// `next build`. Any route importing this file used to run the DATABASE_URL check
// immediately, so the Docker build failed with:
//
//   Error: Failed to collect configuration for /dashboard/people
//     [cause]: Error: DATABASE_URL is not set.
//
// A build must not require database credentials — it does not query anything,
// and the builder cannot reach postgres.railway.internal regardless. So the
// check moved inside the lazy initialiser: importing this module is free, and
// only an actual query demands a connection string.

type Db = NodePgDatabase<typeof schema>;

// Cached on globalThis so dev hot-reloads reuse one pool. Without this, every
// edit leaks a pool and Postgres eventually refuses new connections.
const globalForDb = globalThis as unknown as { commandCenterPool?: Pool; commandCenterDb?: Db };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. It is required at RUNTIME only — if you are seeing this during `next build`, something is querying the database at build time, which it should not.'
    );
  }

  return new Pool({
    connectionString,
    // Railway's proxy presents a certificate that does not chain to a public
    // root. The connection is still TLS 1.3; this disables chain verification
    // only, so it protects confidentiality but not against an active MITM.
    // Acceptable inside Railway's network and for the migration path.
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });
}

function resolvePool(): Pool {
  globalForDb.commandCenterPool ??= createPool();
  return globalForDb.commandCenterPool;
}

function resolveDb(): Db {
  globalForDb.commandCenterDb ??= drizzle(resolvePool(), { schema });
  return globalForDb.commandCenterDb;
}

/**
 * Lazy proxies. Property access is what triggers initialisation, so `import { db }`
 * costs nothing and `db.select(...)` connects. Functions are bound to the real
 * instance so `this` stays correct inside pg and Drizzle.
 */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const real = resolve() as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === 'function' ? value.bind(real) : value;
    },
    has(_target, prop) {
      return prop in (resolve() as object);
    }
  });
}

export const pool = lazy<Pool>(resolvePool);
export const db = lazy<Db>(resolveDb);

export { schema };
