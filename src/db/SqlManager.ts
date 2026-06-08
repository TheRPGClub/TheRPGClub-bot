import oracledb from "oracledb";
import { getOraclePool } from "./oracleClient.js";

export { pgQuery, pgTransaction } from "./postgresClient.js";

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
