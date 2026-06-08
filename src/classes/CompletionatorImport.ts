import oracledb from "oracledb";
import { oraQuery, oraMutate, oraWithConnection, oraTransaction } from "../db/SqlManager.js";

export type ImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type ImportItemStatus =
  | "PENDING"
  | "SKIPPED"
  | "IMPORTED"
  | "UPDATED"
  | "ERROR";

export interface ICompletionatorImport {
  importId: number;
  userId: string;
  status: ImportStatus;
  currentIndex: number;
  totalCount: number;
  sourceFilename: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICompletionatorItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  gameTitle: string;
  platformName: string | null;
  regionName: string | null;
  sourceType: string | null;
  timeText: string | null;
  completedAt: Date | null;
  completionType: string | null;
  playtimeHours: number | null;
  status: ImportItemStatus;
  gameDbGameId: number | null;
  completionId: number | null;
  errorText: string | null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapImport(row: {
  IMPORT_ID: number;
  USER_ID: string;
  STATUS: ImportStatus;
  CURRENT_INDEX: number;
  TOTAL_COUNT: number;
  SOURCE_FILENAME: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): ICompletionatorImport {
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
  GAME_TITLE: string;
  PLATFORM_NAME: string | null;
  REGION_NAME: string | null;
  SOURCE_TYPE: string | null;
  TIME_TEXT: string | null;
  COMPLETED_AT: Date | null;
  COMPLETION_TYPE: string | null;
  PLAYTIME_HRS: number | null;
  STATUS: ImportItemStatus;
  GAMEDB_GAME_ID: number | null;
  COMPLETION_ID: number | null;
  ERROR_TEXT: string | null;
}): ICompletionatorItem {
  return {
    itemId: Number(row.ITEM_ID),
    importId: Number(row.IMPORT_ID),
    rowIndex: Number(row.ROW_INDEX),
    gameTitle: row.GAME_TITLE,
    platformName: row.PLATFORM_NAME ?? null,
    regionName: row.REGION_NAME ?? null,
    sourceType: row.SOURCE_TYPE ?? null,
    timeText: row.TIME_TEXT ?? null,
    completedAt: row.COMPLETED_AT
      ? row.COMPLETED_AT instanceof Date
        ? row.COMPLETED_AT
        : new Date(row.COMPLETED_AT as string)
      : null,
    completionType: row.COMPLETION_TYPE ?? null,
    playtimeHours: row.PLAYTIME_HRS == null ? null : Number(row.PLAYTIME_HRS),
    status: row.STATUS,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    completionId: row.COMPLETION_ID == null ? null : Number(row.COMPLETION_ID),
    errorText: row.ERROR_TEXT ?? null,
  };
}

export async function createImportSession(params: {
  userId: string;
  totalCount: number;
  sourceFilename: string | null;
}): Promise<ICompletionatorImport> {
  return oraWithConnection(async (conn) => {
    const result = await oraMutate(
      `INSERT INTO RPG_CLUB_COMPLETIONATOR_IMPORTS (
         USER_ID, STATUS, CURRENT_INDEX, TOTAL_COUNT, SOURCE_FILENAME
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING IMPORT_ID INTO :id`,
      {
        userId: params.userId,
        totalCount: params.totalCount,
        sourceFilename: params.sourceFilename,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      conn,
    );
    await conn.commit();

    const id = Number((result.outBinds as { id?: number[] })?.id?.[0] ?? 0);
    if (!id) throw new Error("Failed to create import session.");

    const session = await getImportById(id, conn);
    if (!session) throw new Error("Failed to load import session.");
    return session;
  });
}

export async function insertImportItems(
  importId: number,
  items: Array<{
    rowIndex: number;
    gameTitle: string;
    platformName: string | null;
    regionName: string | null;
    sourceType: string | null;
    timeText: string | null;
    completedAt: Date | null;
    completionType: string | null;
    playtimeHours: number | null;
  }>,
): Promise<void> {
  if (!items.length) return;
  await oraTransaction(async (conn) => {
    for (const item of items) {
      await oraMutate(
        `INSERT INTO RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           GAME_TITLE,
           PLATFORM_NAME,
           REGION_NAME,
           SOURCE_TYPE,
           TIME_TEXT,
           COMPLETED_AT,
           COMPLETION_TYPE,
           PLAYTIME_HRS,
           STATUS
         ) VALUES (
           :importId,
           :rowIndex,
           :gameTitle,
           :platformName,
           :regionName,
           :sourceType,
           :timeText,
           :completedAt,
           :completionType,
           :playtimeHours,
           'PENDING'
         )`,
        {
          importId,
          rowIndex: item.rowIndex,
          gameTitle: item.gameTitle,
          platformName: item.platformName,
          regionName: item.regionName,
          sourceType: item.sourceType,
          timeText: item.timeText,
          completedAt: item.completedAt,
          completionType: item.completionType,
          playtimeHours: item.playtimeHours,
        },
        conn,
      );
    }
  });
}

export async function getImportById(
  importId: number,
  existingConn?: oracledb.Connection,
): Promise<ICompletionatorImport | null> {
  const rows = await oraQuery(
    `SELECT IMPORT_ID,
            USER_ID,
            STATUS,
            CURRENT_INDEX,
            TOTAL_COUNT,
            SOURCE_FILENAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_COMPLETIONATOR_IMPORTS
      WHERE IMPORT_ID = :id`,
    { id: importId },
    mapImport,
    existingConn,
  );
  return rows[0] ?? null;
}

export async function getActiveImportForUser(
  userId: string,
): Promise<ICompletionatorImport | null> {
  const rows = await oraQuery(
    `SELECT IMPORT_ID,
            USER_ID,
            STATUS,
            CURRENT_INDEX,
            TOTAL_COUNT,
            SOURCE_FILENAME,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_COMPLETIONATOR_IMPORTS
      WHERE USER_ID = :userId
        AND STATUS IN ('ACTIVE', 'PAUSED')
      ORDER BY CREATED_AT DESC, IMPORT_ID DESC
      FETCH FIRST 1 ROWS ONLY`,
    { userId },
    mapImport,
  );
  return rows[0] ?? null;
}

export async function setImportStatus(
  importId: number,
  status: ImportStatus,
): Promise<void> {
  await oraMutate(
    `UPDATE RPG_CLUB_COMPLETIONATOR_IMPORTS
        SET STATUS = :status
      WHERE IMPORT_ID = :importId`,
    { status, importId },
  );
}

export async function updateImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  await oraMutate(
    `UPDATE RPG_CLUB_COMPLETIONATOR_IMPORTS
        SET CURRENT_INDEX = :currentIndex
      WHERE IMPORT_ID = :importId`,
    { currentIndex, importId },
  );
}

export async function getNextPendingItem(
  importId: number,
): Promise<ICompletionatorItem | null> {
  const rows = await oraQuery(
    `SELECT ITEM_ID,
            IMPORT_ID,
            ROW_INDEX,
            GAME_TITLE,
            PLATFORM_NAME,
            REGION_NAME,
            SOURCE_TYPE,
            TIME_TEXT,
            COMPLETED_AT,
            COMPLETION_TYPE,
            PLAYTIME_HRS,
            STATUS,
            GAMEDB_GAME_ID,
            COMPLETION_ID,
            ERROR_TEXT
       FROM RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
        AND STATUS = 'PENDING'
      ORDER BY ROW_INDEX ASC
      FETCH FIRST 1 ROWS ONLY`,
    { importId },
    mapItem,
  );
  return rows[0] ?? null;
}

export async function getImportItemById(
  itemId: number,
): Promise<ICompletionatorItem | null> {
  const rows = await oraQuery(
    `SELECT ITEM_ID,
            IMPORT_ID,
            ROW_INDEX,
            GAME_TITLE,
            PLATFORM_NAME,
            REGION_NAME,
            SOURCE_TYPE,
            TIME_TEXT,
            COMPLETED_AT,
            COMPLETION_TYPE,
            PLAYTIME_HRS,
            STATUS,
            GAMEDB_GAME_ID,
            COMPLETION_ID,
            ERROR_TEXT
       FROM RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
      WHERE ITEM_ID = :itemId`,
    { itemId },
    mapItem,
  );
  return rows[0] ?? null;
}

export async function updateImportItem(
  itemId: number,
  updates: Partial<{
    status: ImportItemStatus;
    gameDbGameId: number | null;
    completionId: number | null;
    errorText: string | null;
  }>,
): Promise<void> {
  const fields: string[] = [];
  const binds: Record<string, string | number | null> = { itemId };

  if (updates.status !== undefined) {
    fields.push("STATUS = :status");
    binds.status = updates.status;
  }
  if (updates.gameDbGameId !== undefined) {
    fields.push("GAMEDB_GAME_ID = :gameDbGameId");
    binds.gameDbGameId = updates.gameDbGameId;
  }
  if (updates.completionId !== undefined) {
    fields.push("COMPLETION_ID = :completionId");
    binds.completionId = updates.completionId;
  }
  if (updates.errorText !== undefined) {
    fields.push("ERROR_TEXT = :errorText");
    binds.errorText = updates.errorText;
  }

  if (!fields.length) return;

  await oraMutate(
    `UPDATE RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
        SET ${fields.join(", ")}
      WHERE ITEM_ID = :itemId`,
    binds,
  );
}

export async function countImportItems(importId: number): Promise<{
  pending: number;
  skipped: number;
  imported: number;
  updated: number;
  error: number;
}> {
  const stats = { pending: 0, skipped: 0, imported: 0, updated: 0, error: 0 };
  const rows = await oraQuery(
    `SELECT STATUS, COUNT(*) AS CNT
       FROM RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
      WHERE IMPORT_ID = :importId
      GROUP BY STATUS`,
    { importId },
    (row: { STATUS: string; CNT: number }) => row,
  );
  for (const row of rows) {
    const status = String(row.STATUS).toUpperCase();
    const count = Number(row.CNT ?? 0);
    if (status === "PENDING") stats.pending = count;
    if (status === "SKIPPED") stats.skipped = count;
    if (status === "IMPORTED") stats.imported = count;
    if (status === "UPDATED") stats.updated = count;
    if (status === "ERROR") stats.error = count;
  }
  return stats;
}
