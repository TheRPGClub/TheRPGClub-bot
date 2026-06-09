import oracledb from "oracledb";
import pg from "pg";
import { getDialect } from "./dialect.js";
import type { SqlEntry } from "./sql/types.js";
import {
  oraQuery,
  oraMutate,
  oraWithConnection,
  oraTransaction,
} from "./oracleClient.js";
import {
  pgQuery,
  pgMutate,
  pgTransaction,
  pgWithConnection,
} from "./postgresClient.js";

export { oraQuery, oraMutate, oraWithConnection, oraTransaction } from "./oracleClient.js";
export { pgQuery, pgMutate, pgTransaction, pgWithConnection } from "./postgresClient.js";
export type { Dialect, SqlEntry } from "./sql/types.js";
export { getSql, getSqlDynamic } from "./sql/index.js";

/**
 * Dialect-agnostic SELECT. Passes the dialect-appropriate SQL from `entry`
 * to the underlying driver and maps each row with `mapper`.
 */
export async function dbQuery<RowT extends object, R>(
  entry: SqlEntry,
  params: oracledb.BindParameters | Record<string, unknown> | unknown[],
  mapper: (row: RowT) => R,
): Promise<R[]> {
  const dialect = getDialect();
  if (dialect === "oracle") {
    return oraQuery(entry.oracle, params as oracledb.BindParameters, mapper);
  }
  const rows = await pgQuery<RowT>(
    entry.postgres,
    params as Record<string, unknown> | unknown[],
  );
  return rows.map(mapper);
}

/**
 * Dialect-agnostic DML. Returns the number of rows affected.
 * For Oracle INSERT...RETURNING (BIND_OUT) cases, use oraMutate directly.
 */
export async function dbMutate(
  entry: SqlEntry,
  params: oracledb.BindParameters | Record<string, unknown> | unknown[],
): Promise<number> {
  const dialect = getDialect();
  if (dialect === "oracle") {
    const result = await oraMutate(entry.oracle, params as oracledb.BindParameters);
    return result.rowsAffected ?? 0;
  }
  return pgMutate(entry.postgres, params as Record<string, unknown> | unknown[]);
}

/**
 * Dialect-agnostic connection scope. Acquires a connection, runs callback,
 * then releases it. Each statement inside should commit individually.
 * For atomic multi-statement operations, use dbTransaction instead.
 */
export async function dbWithConnection<T>(
  callback: (conn: oracledb.Connection | pg.PoolClient) => Promise<T>,
): Promise<T> {
  const dialect = getDialect();
  if (dialect === "oracle") {
    return oraWithConnection(callback as (conn: oracledb.Connection) => Promise<T>);
  }
  return pgWithConnection(callback as (client: pg.PoolClient) => Promise<T>);
}

/**
 * Dialect-agnostic transaction. Commits on success, rolls back on throw.
 */
export async function dbTransaction<T>(
  callback: (conn: oracledb.Connection | pg.PoolClient) => Promise<T>,
): Promise<T> {
  const dialect = getDialect();
  if (dialect === "oracle") {
    return oraTransaction(callback as (conn: oracledb.Connection) => Promise<T>);
  }
  return pgTransaction(callback as (client: pg.PoolClient) => Promise<T>);
}
