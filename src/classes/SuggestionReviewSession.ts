import oracledb from "oracledb";
import {
  dbMutate,
  oraQuery,
  oraMutate,
  oraWithConnection,
  getSql,
} from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { SuggestionReviewSessionSql } from "../db/sql/index.js";

const dialect = getDialect();

export interface ISuggestionReviewSession {
  sessionId: string;
  reviewerId: string;
  suggestionIds: number[];
  index: number;
  totalCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type SuggestionReviewSessionRow = {
  SESSION_ID: string;
  REVIEWER_ID: string;
  SUGGESTION_IDS: string | null;
  CURRENT_INDEX: number | null;
  TOTAL_COUNT: number | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeSuggestionIds(ids: number[]): number[] {
  return ids
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function serializeSuggestionIds(ids: number[]): string {
  const normalized = normalizeSuggestionIds(ids);
  const payload = JSON.stringify(normalized);
  if (payload.length > 4000) {
    throw new Error("Too many suggestion ids to persist.");
  }
  return payload;
}

function parseSuggestionIds(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeSuggestionIds(parsed as number[]);
  } catch {
    return [];
  }
}

function mapSessionRow(row: SuggestionReviewSessionRow): ISuggestionReviewSession {
  return {
    sessionId: row.SESSION_ID,
    reviewerId: row.REVIEWER_ID,
    suggestionIds: parseSuggestionIds(row.SUGGESTION_IDS),
    index: Number(row.CURRENT_INDEX ?? 0),
    totalCount: Number(row.TOTAL_COUNT ?? 0),
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

export async function createSuggestionReviewSessionRecord(session: {
  sessionId: string;
  reviewerId: string;
  suggestionIds: number[];
  index: number;
  totalCount: number;
}): Promise<ISuggestionReviewSession> {
  return oraWithConnection(async (conn) => {
    const suggestionIds = serializeSuggestionIds(session.suggestionIds);
    await oraMutate(
      getSql(SuggestionReviewSessionSql.create, dialect),
      {
        sessionId: session.sessionId,
        reviewerId: session.reviewerId,
        suggestionIds,
        currentIndex: Math.max(session.index, 0),
        totalCount: Math.max(session.totalCount, 0),
      },
      conn,
    );
    await conn.commit();

    const saved = await getSuggestionReviewSession(session.sessionId, conn);
    if (!saved) throw new Error("Failed to create suggestion review session.");
    return saved;
  });
}

export async function getSuggestionReviewSession(
  sessionId: string,
  existingConnection?: oracledb.Connection,
): Promise<ISuggestionReviewSession | null> {
  const rows = await oraQuery(
    getSql(SuggestionReviewSessionSql.getById, dialect),
    { sessionId },
    mapSessionRow,
    existingConnection,
  );
  return rows[0] ?? null;
}

export async function updateSuggestionReviewSession(
  session: ISuggestionReviewSession,
): Promise<void> {
  const suggestionIds = serializeSuggestionIds(session.suggestionIds);
  await dbMutate(SuggestionReviewSessionSql.update, {
    reviewerId: session.reviewerId,
    suggestionIds,
    currentIndex: Math.max(session.index, 0),
    totalCount: Math.max(session.totalCount, 0),
    sessionId: session.sessionId,
  });
}

export async function deleteSuggestionReviewSession(sessionId: string): Promise<boolean> {
  const count = await dbMutate(SuggestionReviewSessionSql.delete, { sessionId });
  return count > 0;
}

export async function deleteSuggestionReviewSessionsForReviewer(
  reviewerId: string,
): Promise<number> {
  return dbMutate(SuggestionReviewSessionSql.deleteForReviewer, { reviewerId });
}

export async function deleteExpiredSuggestionReviewSessions(
  cutoffDate: Date,
): Promise<number> {
  return dbMutate(SuggestionReviewSessionSql.deleteExpired, { cutoff: cutoffDate });
}
