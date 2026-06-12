import pg from "pg";
import type { ISqlEntry } from "./sql/types.js";
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
export type { ISqlEntry } from "./sql/types.js";

export async function dbQuery<RowT extends object, R>(
  entry: ISqlEntry,
  params: Record<string, unknown> | unknown[],
  mapper: (row: RowT) => R,
): Promise<R[]> {
  const rows = await pgQuery<Record<string, unknown>>(
    entry.postgres,
    params as Record<string, unknown> | unknown[],
  );
  return rows.map((row) => mapper(toUpperCaseKeys(row) as RowT));
}

export async function dbMutate(
  entry: ISqlEntry,
  params: Record<string, unknown> | unknown[],
): Promise<number> {
  return pgMutate(entry.postgres, params as Record<string, unknown> | unknown[]);
}

/**
 * Acquires a connection, runs callback, then releases it. Each statement inside
 * should commit individually. For atomic multi-statement operations, use dbTransaction.
 */
export async function dbWithConnection<T>(
  callback: (conn: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return pgWithConnection(callback);
}

/** Commits on success, rolls back on throw. */
export async function dbTransaction<T>(
  callback: (conn: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return pgTransaction(callback);
}

/**
 * Runs the SQL (which must end with RETURNING <col>) and returns the first column value.
 */
export async function dbInsert(
  entry: ISqlEntry,
  params: Record<string, unknown>,
  bindOutKey: string,
): Promise<number> {
  void bindOutKey;
  return pgInsert(entry.postgres, params as Record<string, unknown>);
}

/** Use inside dbWithConnection / dbTransaction callbacks. */
export async function dbQueryConn<RowT extends object, R>(
  conn: pg.PoolClient,
  entry: ISqlEntry,
  params: Record<string, unknown> | unknown[],
  mapper: (row: RowT) => R,
): Promise<R[]> {
  const rows = await pgQueryConn<Record<string, unknown>>(
    conn,
    entry.postgres,
    params as Record<string, unknown> | unknown[],
  );
  return rows.map((row) => mapper(toUpperCaseKeys(row) as RowT));
}

/** Use inside dbWithConnection / dbTransaction callbacks. */
export async function dbMutateConn(
  conn: pg.PoolClient,
  entry: ISqlEntry,
  params: Record<string, unknown> | unknown[],
): Promise<number> {
  return pgMutateConn(
    conn,
    entry.postgres,
    params as Record<string, unknown> | unknown[],
  );
}

/** Use inside dbWithConnection / dbTransaction callbacks. */
export async function dbInsertConn(
  conn: pg.PoolClient,
  entry: ISqlEntry,
  params: Record<string, unknown>,
  bindOutKey: string,
): Promise<number> {
  void bindOutKey;
  return pgInsertConn(conn, entry.postgres, params as Record<string, unknown>);
}
