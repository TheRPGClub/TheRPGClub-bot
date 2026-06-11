import pg from "pg";
import { logError } from "../utilities/LogUtils.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Initialise the shared PostgreSQL connection pool.
 *
 * Reads PG_CONNECTION_STRING from the environment (required).
 * Optional pool tuning via env vars:
 *   PG_POOL_MIN              -- minimum idle connections (default 2)
 *   PG_POOL_MAX              -- maximum connections      (default 16)
 *   PG_IDLE_TIMEOUT_MS       -- idle connection timeout  (default 30000 ms)
 *   PG_CONN_TIMEOUT_MS       -- connection acquire timeout (default 5000 ms)
 *   PG_KEEPALIVE_DELAY_MS    -- initial TCP keepalive delay (default 10000 ms)
 */
export async function initPostgresPool(): Promise<void> {
  if (pool) return;

  const connectionString = process.env.PG_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("PG_CONNECTION_STRING is not set in the environment");
  }

  pool = new Pool({
    connectionString,
    min: readIntEnv("PG_POOL_MIN", 2),
    max: readIntEnv("PG_POOL_MAX", 16),
    idleTimeoutMillis: readIntEnv("PG_IDLE_TIMEOUT_MS", 30_000),
    connectionTimeoutMillis: readIntEnv("PG_CONN_TIMEOUT_MS", 5_000),
    // TCP keepalive prevents NAT/firewall from silently dropping idle connections,
    // which would otherwise surface as "Connection terminated unexpectedly" errors.
    keepAlive: true,
    keepAliveInitialDelayMillis: readIntEnv("PG_KEEPALIVE_DELAY_MS", 10_000),
  });

  pool.on("error", (err: Error) => {
    logError("postgresClient.clientError", err);
  });

  // Verify connectivity immediately so startup fails fast on bad credentials.
  const client = await pool.connect();
  client.release();
}

/**
 * Returns the active PostgreSQL pool.
 * Throws if {@link initPostgresPool} has not been called yet.
 */
export function getPostgresPool(): pg.Pool {
  if (!pool) throw new Error("PostgreSQL pool not initialized");
  return pool;
}

/**
 * Converts a SQL string using Oracle-style `:name` placeholders and a named
 * bind object into a positional `$N` SQL string and ordered values array.
 * Repeated uses of the same name get the same `$N`. Array params are returned
 * unchanged so callers that already use positional style still work.
 */
export function namedToPositional(
  sql: string,
  params: Record<string, unknown> | unknown[],
): { text: string; values: unknown[] } {
  if (Array.isArray(params)) {
    return { text: sql, values: params };
  }
  const values: unknown[] = [];
  const seen = new Map<string, number>();
  const text = sql.replace(/(?<!:):([A-Za-z_]\w*)/g, (_, name: string) => {
    if (!seen.has(name)) {
      seen.set(name, values.length + 1);
      values.push(params[name]);
    }
    return `$${seen.get(name)}`;
  });
  return { text, values };
}

/**
 * Convenience helper -- runs a parameterised query and returns all rows.
 * Accepts either positional `unknown[]` or named `:param` bind objects.
 *
 * @example
 * const rows = await pgQuery<{ id: number }>("SELECT id FROM users WHERE name = :name", { name: "alice" });
 */
export async function pgQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: Record<string, unknown> | unknown[],
): Promise<T[]> {
  const { text, values } = namedToPositional(sql, params ?? []);
  const result = await getPostgresPool().query<T>(text, values);
  return result.rows;
}

/**
 * Convenience helper -- runs a parameterised query inside an explicit
 * transaction and returns all rows from the final statement.
 * Rolls back automatically if the callback throws.
 */
export async function pgTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Runs a DML statement and returns the number of rows affected. */
export async function pgMutate(
  sql: string,
  params?: Record<string, unknown> | unknown[],
): Promise<number> {
  const { text, values } = namedToPositional(sql, params ?? []);
  const result = await getPostgresPool().query(text, values);
  return result.rowCount ?? 0;
}

/** Acquires a client from the pool, runs callback, then releases it. */
export async function pgWithConnection<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

/** Runs a SELECT on an existing PoolClient and returns all rows. */
export async function pgQueryConn<T extends pg.QueryResultRow = pg.QueryResultRow>(
  client: pg.PoolClient,
  sql: string,
  params?: Record<string, unknown> | unknown[],
): Promise<T[]> {
  const { text, values } = namedToPositional(sql, params ?? []);
  const result = await client.query<T>(text, values);
  return result.rows;
}

/** Runs a DML statement on an existing PoolClient and returns rows affected. */
export async function pgMutateConn(
  client: pg.PoolClient,
  sql: string,
  params?: Record<string, unknown> | unknown[],
): Promise<number> {
  const { text, values } = namedToPositional(sql, params ?? []);
  const result = await client.query(text, values);
  return result.rowCount ?? 0;
}

/**
 * Runs an INSERT...RETURNING on a pool (no existing connection) and returns
 * the first column of the first returned row as a number (the generated id).
 */
export async function pgInsert(
  sql: string,
  params?: Record<string, unknown> | unknown[],
): Promise<number> {
  const { text, values } = namedToPositional(sql, params ?? []);
  const result = await getPostgresPool().query(text, values);
  const row = result.rows[0];
  return Number(Object.values(row ?? {})[0] ?? 0);
}

/**
 * Runs an INSERT...RETURNING on an existing PoolClient and returns
 * the first column of the first returned row as a number.
 */
export async function pgInsertConn(
  client: pg.PoolClient,
  sql: string,
  params?: Record<string, unknown> | unknown[],
): Promise<number> {
  const { text, values } = namedToPositional(sql, params ?? []);
  const result = await client.query(text, values);
  const row = result.rows[0];
  return Number(Object.values(row ?? {})[0] ?? 0);
}
