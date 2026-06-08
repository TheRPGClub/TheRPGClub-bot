import oracledb from "oracledb";
import { dbQuery, dbMutate, oraQuery, oraMutate, oraWithConnection, getSql } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { SuggestionSql } from "../db/sql/index.js";

const dialect = getDialect();

export interface ISuggestionItem {
  suggestionId: number;
  title: string;
  details: string | null;
  labels: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

type SuggestionRow = {
  SUGGESTION_ID: number;
  TITLE: string;
  DETAILS: string | null;
  LABELS: string | null;
  CREATED_BY: string | null;
  CREATED_BY_NAME: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function mapSuggestionRow(row: SuggestionRow): ISuggestionItem {
  return {
    suggestionId: Number(row.SUGGESTION_ID),
    title: row.TITLE,
    details: row.DETAILS ?? null,
    labels: row.LABELS ?? null,
    createdBy: row.CREATED_BY ?? null,
    createdByName: row.CREATED_BY_NAME ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

export async function createSuggestion(
  title: string,
  details: string | null,
  labels: string | null,
  createdBy: string | null,
  createdByName: string | null,
): Promise<ISuggestionItem> {
  return oraWithConnection(async (conn) => {
    const result = await oraMutate(
      getSql(SuggestionSql.create, dialect),
      {
        title,
        details,
        labels,
        createdBy,
        createdByName,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      conn,
    );
    await conn.commit();

    const id = Number((result.outBinds as { id?: number[] })?.id?.[0] ?? 0);
    if (!id) throw new Error("Failed to create suggestion.");

    const suggestion = await getSuggestionById(id, conn);
    if (!suggestion) throw new Error("Failed to load suggestion after creation.");
    return suggestion;
  });
}

export async function listSuggestions(limit: number = 50): Promise<ISuggestionItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return dbQuery(SuggestionSql.list, { limit: safeLimit }, mapSuggestionRow);
}

export async function countSuggestions(): Promise<number> {
  const rows = await dbQuery(
    SuggestionSql.count,
    {},
    (row: { TOTAL: number | null }) => row,
  );
  return Number(rows[0]?.TOTAL ?? 0);
}

export async function getSuggestionById(
  suggestionId: number,
  existingConnection?: oracledb.Connection,
): Promise<ISuggestionItem | null> {
  const rows = await oraQuery(
    getSql(SuggestionSql.getById, dialect),
    { id: suggestionId },
    mapSuggestionRow,
    existingConnection,
  );
  return rows[0] ?? null;
}

export async function deleteSuggestion(suggestionId: number): Promise<boolean> {
  const count = await dbMutate(SuggestionSql.delete, { id: suggestionId });
  return count > 0;
}
