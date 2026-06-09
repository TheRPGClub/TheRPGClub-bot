import { dbQuery, dbMutate, dbInsert, dbTransaction, dbMutateConn } from "../db/SqlManager.js";
import { GotmAuditImportSql } from "../db/sql/index.js";

export type GotmAuditStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type GotmAuditItemStatus = "PENDING" | "SKIPPED" | "IMPORTED" | "ERROR";
export type GotmAuditKind = "gotm" | "nr-gotm";

export interface IGotmAuditImport {
  importId: number;
  userId: string;
  status: GotmAuditStatus;
  currentIndex: number;
  totalCount: number;
  sourceFilename: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGotmAuditItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  kind: GotmAuditKind;
  roundNumber: number;
  monthYear: string;
  gameIndex: number;
  gameTitle: string;
  threadId: string | null;
  redditUrl: string | null;
  status: GotmAuditItemStatus;
  gameDbGameId: number | null;
  errorText: string | null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapImport(row: {
  IMPORT_ID: number;
  USER_ID: string;
  STATUS: GotmAuditStatus;
  CURRENT_INDEX: number;
  TOTAL_COUNT: number;
  SOURCE_FILENAME: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): IGotmAuditImport {
  return {
    importId: Number(row.IMPORT_ID),
    userId: row.USER_ID,
    status: row.STATUS,
    currentIndex: Number(row.CURRENT_INDEX ?? 0),
    totalCount: Number(row.TOTAL_COUNT ?? 0),
    sourceFilename: row.SOURCE_FILENAME ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

function mapItem(row: {
  ITEM_ID: number;
  IMPORT_ID: number;
  ROW_INDEX: number;
  KIND: string;
  ROUND_NUMBER: number;
  MONTH_YEAR: string;
  GAME_INDEX: number;
  GAME_TITLE: string;
  THREAD_ID: string | null;
  REDDIT_URL: string | null;
  STATUS: GotmAuditItemStatus;
  GAMEDB_GAME_ID: number | null;
  ERROR_TEXT: string | null;
}): IGotmAuditItem {
  return {
    itemId: Number(row.ITEM_ID),
    importId: Number(row.IMPORT_ID),
    rowIndex: Number(row.ROW_INDEX),
    kind: row.KIND === "nr-gotm" ? "nr-gotm" : "gotm",
    roundNumber: Number(row.ROUND_NUMBER),
    monthYear: row.MONTH_YEAR,
    gameIndex: Number(row.GAME_INDEX),
    gameTitle: row.GAME_TITLE,
    threadId: row.THREAD_ID ?? null,
    redditUrl: row.REDDIT_URL ?? null,
    status: row.STATUS,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    errorText: row.ERROR_TEXT ?? null,
  };
}

export async function createGotmAuditImportSession(params: {
  userId: string;
  totalCount: number;
  sourceFilename: string | null;
}): Promise<IGotmAuditImport> {
  const id = await dbInsert(GotmAuditImportSql.createSession, {
    userId: params.userId,
    totalCount: params.totalCount,
    sourceFilename: params.sourceFilename,
  }, "id");
  if (!id) throw new Error("Failed to create GOTM audit session.");

  const session = await getGotmAuditImportById(id);
  if (!session) throw new Error("Failed to load GOTM audit session.");
  return session;
}

export async function insertGotmAuditImportItems(
  importId: number,
  items: Array<{
    rowIndex: number;
    kind: GotmAuditKind;
    roundNumber: number;
    monthYear: string;
    gameIndex: number;
    gameTitle: string;
    threadId: string | null;
    redditUrl: string | null;
    gameDbGameId: number | null;
  }>,
): Promise<void> {
  if (!items.length) return;
  await dbTransaction(async (conn) => {
    for (const item of items) {
      await dbMutateConn(conn, GotmAuditImportSql.insertItems, {
        importId,
        rowIndex: item.rowIndex,
        kind: item.kind,
        roundNumber: item.roundNumber,
        monthYear: item.monthYear,
        gameIndex: item.gameIndex,
        gameTitle: item.gameTitle,
        threadId: item.threadId,
        redditUrl: item.redditUrl,
        gameDbGameId: item.gameDbGameId,
      });
    }
  });
}

export async function getGotmAuditImportById(
  importId: number,
): Promise<IGotmAuditImport | null> {
  const rows = await dbQuery(GotmAuditImportSql.getById, { id: importId }, mapImport);
  return rows[0] ?? null;
}

export async function getActiveGotmAuditImportForUser(
  userId: string,
): Promise<IGotmAuditImport | null> {
  const rows = await dbQuery(
    GotmAuditImportSql.getActiveForUser,
    { userId },
    mapImport,
  );
  return rows[0] ?? null;
}

export async function setGotmAuditImportStatus(
  importId: number,
  status: GotmAuditStatus,
): Promise<void> {
  await dbMutate(
    GotmAuditImportSql.setStatus,
    { importId, status },
  );
}

export async function updateGotmAuditImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  await dbMutate(
    GotmAuditImportSql.updateIndex,
    { importId, currentIndex },
  );
}

export async function getNextGotmAuditItem(
  importId: number,
): Promise<IGotmAuditItem | null> {
  const rows = await dbQuery(
    GotmAuditImportSql.getNextPendingItem,
    { importId },
    mapItem,
  );
  return rows[0] ?? null;
}

export async function getGotmAuditItemById(
  itemId: number,
): Promise<IGotmAuditItem | null> {
  const rows = await dbQuery(
    GotmAuditImportSql.getItemById,
    { itemId },
    mapItem,
  );
  return rows[0] ?? null;
}

export async function updateGotmAuditItem(
  itemId: number,
  changes: Partial<{
    status: GotmAuditItemStatus;
    gameDbGameId: number | null;
    errorText: string | null;
  }>,
): Promise<void> {
  const fields: string[] = [];
  const binds: Record<string, string | number | null> = { itemId };

  if (changes.status) {
    fields.push("STATUS = :status");
    binds.status = changes.status;
  }
  if (changes.gameDbGameId !== undefined) {
    fields.push("GAMEDB_GAME_ID = :gameDbGameId");
    binds.gameDbGameId = changes.gameDbGameId;
  }
  if (changes.errorText !== undefined) {
    fields.push("ERROR_TEXT = :errorText");
    binds.errorText = changes.errorText;
  }

  if (!fields.length) return;

  await dbMutate(
    GotmAuditImportSql.updateItem(fields),
    binds,
  );
}

export async function getGotmAuditItemsForRound(
  importId: number,
  kind: GotmAuditKind,
  roundNumber: number,
): Promise<IGotmAuditItem[]> {
  return dbQuery(
    GotmAuditImportSql.getItemsForRound,
    { importId, kind, roundNumber },
    mapItem,
  );
}

export async function countGotmAuditItems(importId: number): Promise<{
  pending: number;
  imported: number;
  skipped: number;
  error: number;
}> {
  const stats = { pending: 0, imported: 0, skipped: 0, error: 0 };
  const rows = await dbQuery(
    GotmAuditImportSql.countItems,
    { importId },
    (row: { STATUS: GotmAuditItemStatus; CNT: number }) => row,
  );
  for (const row of rows) {
    const count = Number(row.CNT ?? 0);
    if (row.STATUS === "PENDING") stats.pending = count;
    else if (row.STATUS === "IMPORTED") stats.imported = count;
    else if (row.STATUS === "SKIPPED") stats.skipped = count;
    else if (row.STATUS === "ERROR") stats.error = count;
  }
  return stats;
}
