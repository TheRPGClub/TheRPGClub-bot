import pg from "pg";

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
    console.error("[PostgreSQL] Unexpected client error:", err);
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
 * Convenience helper -- runs a parameterised query and returns all rows.
 *
 * @example
 * const rows = await pgQuery<{ id: number }>("SELECT id FROM users WHERE name = $1", ["alice"]);
 */
export async function pgQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<T[]> {
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
  text: string,
  values?: unknown[],
): Promise<number> {
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
