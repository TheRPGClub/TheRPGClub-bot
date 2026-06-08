import oracledb from "oracledb";

let pool: oracledb.Pool | null = null;

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function initOraclePool() {
  if (!pool) {
    pool = await oracledb.createPool({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECT_STRING ?? "localhost:1521/FREEPDB1",
      poolMin: readIntEnv("ORACLE_POOL_MIN", 2),
      poolMax: readIntEnv("ORACLE_POOL_MAX", 16),
      poolIncrement: readIntEnv("ORACLE_POOL_INCREMENT", 1),
      queueTimeout: readIntEnv("ORACLE_POOL_QUEUE_TIMEOUT_MS", 5_000),
      poolTimeout: readIntEnv("ORACLE_POOL_IDLE_TIMEOUT_SECONDS", 60),
      stmtCacheSize: readIntEnv("ORACLE_STMT_CACHE_SIZE", 60),
    });
  }
}

export function getOraclePool(): oracledb.Pool {
  if (!pool) throw new Error("Oracle pool not initialized");
  return pool;
}

/**
 * Runs a SELECT and maps each row with `mapper`. Defaults to OUT_FORMAT_OBJECT.
 * Pass `existingConn` to reuse a connection (caller manages its lifecycle).
 */
export async function oraQuery<RowT extends object, R>(
  sql: string,
  params: oracledb.BindParameters,
  mapper: (row: RowT) => R,
  existingConn?: oracledb.Connection,
): Promise<R[]> {
  const conn = existingConn ?? (await getOraclePool().getConnection());
  try {
    const result = await conn.execute<RowT>(sql, params, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    return (result.rows ?? []).map(mapper);
  } finally {
    if (!existingConn) await conn.close();
  }
}

/**
 * Runs a single DML statement with autoCommit:true.
 * Returns the full Result so callers can inspect rowsAffected / outBinds.
 * Pass `existingConn` to reuse a connection (no autoCommit in that case).
 */
export async function oraMutate(
  sql: string,
  params: oracledb.BindParameters,
  existingConn?: oracledb.Connection,
): Promise<oracledb.Result<unknown>> {
  const conn = existingConn ?? (await getOraclePool().getConnection());
  try {
    return await conn.execute(sql, params, {
      autoCommit: existingConn ? false : true,
    });
  } finally {
    if (!existingConn) await conn.close();
  }
}

/**
 * Acquires a connection, runs `callback`, then closes it.
 * Each statement inside should use autoCommit:true (or pass conn to oraMutate).
 * For atomic multi-statement operations, use oraTransaction instead.
 */
export async function oraWithConnection<T>(
  callback: (conn: oracledb.Connection) => Promise<T>,
): Promise<T> {
  const conn = await getOraclePool().getConnection();
  try {
    return await callback(conn);
  } finally {
    await conn.close();
  }
}

/**
 * Runs `callback` inside a transaction. Commits on success, rolls back on throw.
 */
export async function oraTransaction<T>(
  callback: (conn: oracledb.Connection) => Promise<T>,
): Promise<T> {
  const conn = await getOraclePool().getConnection();
  try {
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.close();
  }
}
