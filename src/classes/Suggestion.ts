import oracledb from "oracledb";
import { oraQuery, oraMutate, oraWithConnection } from "../db/SqlManager.js";

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
      `INSERT INTO RPG_CLUB_SUGGESTIONS (TITLE, DETAILS, LABELS, CREATED_BY, CREATED_BY_NAME)
       VALUES (:title, :details, :labels, :createdBy, :createdByName)
       RETURNING SUGGESTION_ID INTO :id`,
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
  return oraQuery(
    `SELECT SUGGESTION_ID,
            TITLE,
            DETAILS,
            LABELS,
            CREATED_BY,
            CREATED_BY_NAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_SUGGESTIONS
      ORDER BY CREATED_AT DESC, SUGGESTION_ID DESC
      FETCH FIRST :limit ROWS ONLY`,
    { limit: safeLimit },
    mapSuggestionRow,
  );
}

export async function countSuggestions(): Promise<number> {
  const rows = await oraQuery(
    "SELECT COUNT(*) AS TOTAL FROM RPG_CLUB_SUGGESTIONS",
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
    `SELECT SUGGESTION_ID,
            TITLE,
            DETAILS,
            LABELS,
            CREATED_BY,
            CREATED_BY_NAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_SUGGESTIONS
      WHERE SUGGESTION_ID = :id`,
    { id: suggestionId },
    mapSuggestionRow,
    existingConnection,
  );
  return rows[0] ?? null;
}

export async function deleteSuggestion(suggestionId: number): Promise<boolean> {
  const result = await oraMutate(
    `DELETE FROM RPG_CLUB_SUGGESTIONS WHERE SUGGESTION_ID = :id`,
    { id: suggestionId },
  );
  return (result.rowsAffected ?? 0) > 0;
}
