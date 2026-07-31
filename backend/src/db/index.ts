import pg from 'pg';
import { env, isProduction } from '../config/env.js';

const { Pool } = pg;

/**
 * Supabase hands out connection strings ending in `?sslmode=require`. Recent
 * pg-connection-string upgrades that to `verify-full`, which overrides the
 * `ssl` object below and rejects Supabase's self-signed chain with
 * "self-signed certificate in certificate chain" — at boot, as
 * "database unreachable".
 *
 * TLS is governed by PGSSL here, so strip the parameter rather than leaving
 * two mechanisms to fight over it.
 *
 * Do NOT reach for NODE_TLS_REJECT_UNAUTHORIZED=0 instead. That disables
 * certificate verification for every outbound TLS connection in the process —
 * SMTP and any HTTPS call included — where this is scoped to Postgres.
 */
function sanitizedConnectionString(): string {
  try {
    const url = new URL(env.DATABASE_URL);
    url.searchParams.delete('sslmode');
    url.searchParams.delete('uselibpqcompat');
    return url.toString();
  } catch {
    // Not a parseable URL (a libpq key=value DSN). Hand it over untouched.
    return env.DATABASE_URL;
  }
}

export const pool = new Pool({
  connectionString: sanitizedConnectionString(),
  ssl: env.PGSSL ? { rejectUnauthorized: false } : undefined,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // An idle client blowing up must not take the process down.
  console.error('[db] idle client error', err);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params as never);

  if (!isProduction) {
    const ms = Date.now() - start;
    if (ms > 100) console.warn(`[db] slow query ${ms}ms: ${text.slice(0, 90)}`);
  }

  return result;
}

/**
 * Ticket issuance writes a ticket plus 1 or 5 QR codes. That must be one
 * transaction — a ticket with a partial set of codes admits the wrong
 * number of people.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function healthcheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
