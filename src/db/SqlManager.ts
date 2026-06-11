import oracledb from "oracledb";
import pg from "pg";
import { getDialect } from "./dialect.js";
import type { ISqlEntry } from "./sql/types.js";
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
  pgInsert,
  pgQueryConn,
  pgMutateConn,
  pgInsertConn,
} from "./postgresClient.js";

function toUpperCaseKeys(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toUpperCase(), v]));
}

export { oraQuery, oraMutate, oraWithConnection, oraTransaction } from "./oracleClient.js";
export {
  pgQuery,
  pgMutate,
  pgTransaction,
  pgWithConnection,
  pgInsert,
  pgQueryConn,
  pgMutateConn,
  pgInsertConn,
} from "./postgresClient.js";
export type { Dialect, ISqlEntry } from "./sql/types.js";
export { getSql, getSqlDynamic } from "./sql/index.js";

/**
 * Dialect-agnostic SELECT. Passes the dialect-appropriate SQL from `entry`
 * to the underlying driver and maps each row with `mapper`.
 */
export async function dbQuery<RowT extends object, R>(
  entry: ISqlEntry,
  params: oracledb.BindParameters | Record<string, unknown> | unknown[],
  mapper: (row: RowT) => R,
): Promise<R[]> {
  const dialect = getDialect();
  if (dialect === "oracle") {
    return oraQuery(entry.oracle, params as oracledb.BindParameters, mapper);
  }
  const rows = await pgQuery<Record<string, unknown>>(
    entry.postgres,
    params as Record<string, unknown> | unknown[],
  );
  return rows.map((row) => mapper(toUpperCaseKeys(row) as RowT));
}

/**
 * Dialect-agnostic DML. Returns the number of rows affected.
 * For Oracle INSERT...RETURNING (BIND_OUT) cases, use oraMutate directly.
 */
export async function dbMutate(
  entry: ISqlEntry,
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

/**
 * Dialect-agnostic INSERT...RETURNING / BIND_OUT.
 * On Oracle: runs the SQL with a BIND_OUT param for `bindOutKey` and returns the generated id.
 * On Postgres: runs the SQL (which must end with RETURNING <col>) and returns the first column value.
 * Pass `params` WITHOUT the BIND_OUT entry -- the function adds it for Oracle.
 */
export async function dbInsert(
  entry: ISqlEntry,
  params: oracledb.BindParameters | Record<string, unknown>,
  bindOutKey: string,
): Promise<number> {
  const dialect = getDialect();
  if (dialect === "postgres") {
    return pgInsert(entry.postgres, params as Record<string, unknown>);
  }
  const oraParams = {
    ...(params as oracledb.BindParameters),
    [bindOutKey]: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
  const result = await oraMutate(entry.oracle, oraParams);
  return Number((result.outBinds as Record<string, number[]>)?.[bindOutKey]?.[0] ?? 0);
}

/**
 * Dialect-agnostic SELECT on an existing connection.
 * Use inside dbWithConnection / dbTransaction callbacks.
 */
export async function dbQueryConn<RowT extends object, R>(
  conn: oracledb.Connection | pg.PoolClient,
  entry: ISqlEntry,
  params: oracledb.BindParameters | Record<string, unknown> | unknown[],
  mapper: (row: RowT) => R,
): Promise<R[]> {
  const dialect = getDialect();
  if (dialect === "postgres") {
    const rows = await pgQueryConn<Record<string, unknown>>(
      conn as pg.PoolClient,
      entry.postgres,
      params as Record<string, unknown> | unknown[],
    );
    return rows.map((row) => mapper(toUpperCaseKeys(row) as RowT));
  }
  return oraQuery(
    entry.oracle,
    params as oracledb.BindParameters,
    mapper,
    conn as oracledb.Connection,
  );
}

/**
 * Dialect-agnostic DML on an existing connection. Returns rows affected.
 * Use inside dbWithConnection / dbTransaction callbacks.
 */
export async function dbMutateConn(
  conn: oracledb.Connection | pg.PoolClient,
  entry: ISqlEntry,
  params: oracledb.BindParameters | Record<string, unknown> | unknown[],
): Promise<number> {
  const dialect = getDialect();
  if (dialect === "postgres") {
    return pgMutateConn(
      conn as pg.PoolClient,
      entry.postgres,
      params as Record<string, unknown> | unknown[],
    );
  }
  const result = await oraMutate(
    entry.oracle,
    params as oracledb.BindParameters,
    conn as oracledb.Connection,
  );
  return result.rowsAffected ?? 0;
}

/**
 * Dialect-agnostic INSERT...RETURNING / BIND_OUT on an existing connection.
 * Pass `params` WITHOUT the BIND_OUT entry -- the function adds it for Oracle.
 * Use inside dbWithConnection / dbTransaction callbacks.
 */
export async function dbInsertConn(
  conn: oracledb.Connection | pg.PoolClient,
  entry: ISqlEntry,
  params: oracledb.BindParameters | Record<string, unknown>,
  bindOutKey: string,
): Promise<number> {
  const dialect = getDialect();
  if (dialect === "postgres") {
    return pgInsertConn(conn as pg.PoolClient, entry.postgres, params as Record<string, unknown>);
  }
  const oraParams = {
    ...(params as oracledb.BindParameters),
    [bindOutKey]: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
  const result = await oraMutate(
    entry.oracle,
    oraParams,
    conn as oracledb.Connection,
  );
  return Number((result.outBinds as Record<string, number[]>)?.[bindOutKey]?.[0] ?? 0);
}
