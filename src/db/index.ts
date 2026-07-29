import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// This app runs as a long-lived container on Railway (output: 'standalone'),
// NOT on a serverless platform. A connection pool is therefore correct — a
// per-request client would pay TCP + TLS handshake cost on every query.
//
// Runtime uses DATABASE_URL, which in Railway should point at
// postgres.railway.internal so queries stay on the private network. Migrations
// use DATABASE_PUBLIC_URL instead (see drizzle.config.ts).
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set.');
}

// Reuse the pool across hot reloads in development. Without this, every edit
// leaks a pool and Postgres eventually refuses new connections.
const globalForDb = globalThis as unknown as { __dbPool?: Pool };

function createPool() {
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

export const pool = globalForDb.__dbPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__dbPool = pool;
}

export const db = drizzle(pool, { schema });

export { schema };
