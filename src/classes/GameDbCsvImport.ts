import oracledb from "oracledb";
import {
  dbQuery,
  dbMutate,
  oraQuery,
  oraMutate,
  oraWithConnection,
  oraTransaction,
} from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { GameDbCsvImportSql } from "../db/sql/index.js";

const dialect = getDialect();

export type GameDbCsvImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type GameDbCsvItemStatus = "PENDING" | "SKIPPED" | "IMPORTED" | "ERROR";

export interface IGameDbCsvImport {
  importId: number;
  userId: string;
  status: GameDbCsvImportStatus;
  currentIndex: number;
  totalCount: number;
  sourceFilename: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGameDbCsvImportItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  gameTitle: string;
  rawGameTitle: string | null;
  platformName: string | null;
  regionName: string | null;
  initialReleaseDate: Date | null;
  status: GameDbCsvItemStatus;
  gameDbGameId: number | null;
  errorText: string | null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapImport(row: {
  IMPORT_ID: number;
  USER_ID: string;
  STATUS: GameDbCsvImportStatus;
  CURRENT_INDEX: number;
  TOTAL_COUNT: number;
  SOURCE_FILENAME: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): IGameDbCsvImport {
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
  RAW_GAME_TITLE: string | null;
  PLATFORM_NAME: string | null;
  REGION_NAME: string | null;
  INITIAL_RELEASE_DATE: Date | null;
  STATUS: GameDbCsvItemStatus;
  GAMEDB_GAME_ID: number | null;
  ERROR_TEXT: string | null;
}): IGameDbCsvImportItem {
  return {
    itemId: Number(row.ITEM_ID),
    importId: Number(row.IMPORT_ID),
    rowIndex: Number(row.ROW_INDEX),
    gameTitle: row.GAME_TITLE,
    rawGameTitle: row.RAW_GAME_TITLE ?? null,
    platformName: row.PLATFORM_NAME ?? null,
    regionName: row.REGION_NAME ?? null,
    initialReleaseDate: row.INITIAL_RELEASE_DATE
      ? row.INITIAL_RELEASE_DATE instanceof Date
        ? row.INITIAL_RELEASE_DATE
        : new Date(row.INITIAL_RELEASE_DATE as string)
      : null,
    status: row.STATUS,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    errorText: row.ERROR_TEXT ?? null,
  };
}

export async function createGameDbCsvImportSession(params: {
  userId: string;
  totalCount: number;
  sourceFilename: string | null;
}): Promise<IGameDbCsvImport> {
  return oraWithConnection(async (conn) => {
    const result = await oraMutate(
      getSql(GameDbCsvImportSql.createImport, dialect),
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

    const session = await getGameDbCsvImportById(id, conn);
    if (!session) throw new Error("Failed to load import session.");
    return session;
  });
}

export async function insertGameDbCsvImportItems(
  importId: number,
  items: Array<{
    rowIndex: number;
    gameTitle: string;
    rawGameTitle: string | null;
    platformName: string | null;
    regionName: string | null;
    initialReleaseDate: Date | null;
  }>,
): Promise<void> {
  if (!items.length) return;
  await oraTransaction(async (conn) => {
    for (const item of items) {
      await oraMutate(
        getSql(GameDbCsvImportSql.insertItem, dialect),
        {
          importId,
          rowIndex: item.rowIndex,
          gameTitle: item.gameTitle,
          rawGameTitle: item.rawGameTitle,
          platformName: item.platformName,
          regionName: item.regionName,
          initialReleaseDate: item.initialReleaseDate,
        },
        conn,
      );
    }
  });
}

export async function getGameDbCsvImportById(
  importId: number,
  existingConn?: oracledb.Connection,
): Promise<IGameDbCsvImport | null> {
  const rows = await oraQuery(
    getSql(GameDbCsvImportSql.getImportById, dialect),
    { id: importId },
    mapImport,
    existingConn,
  );
  return rows[0] ?? null;
}

export async function getActiveGameDbCsvImportForUser(
  userId: string,
): Promise<IGameDbCsvImport | null> {
  const rows = await dbQuery(
    GameDbCsvImportSql.getActiveForUser,
    { userId },
    mapImport,
  );
  return rows[0] ?? null;
}

export async function setGameDbCsvImportStatus(
  importId: number,
  status: GameDbCsvImportStatus,
): Promise<void> {
  await dbMutate(
    GameDbCsvImportSql.setStatus,
    { status, importId },
  );
}

export async function updateGameDbCsvImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  await dbMutate(
    GameDbCsvImportSql.updateIndex,
    { currentIndex, importId },
  );
}

export async function getNextGameDbCsvImportItem(
  importId: number,
): Promise<IGameDbCsvImportItem | null> {
  const rows = await dbQuery(
    GameDbCsvImportSql.getNextPendingItem,
    { importId },
    mapItem,
  );
  return rows[0] ?? null;
}

export async function getGameDbCsvImportItemById(
  itemId: number,
): Promise<IGameDbCsvImportItem | null> {
  const rows = await dbQuery(
    GameDbCsvImportSql.getItemById,
    { itemId },
    mapItem,
  );
  return rows[0] ?? null;
}

export async function updateGameDbCsvImportItem(
  itemId: number,
  updates: Partial<{
    status: GameDbCsvItemStatus;
    gameDbGameId: number | null;
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
  if (updates.errorText !== undefined) {
    fields.push("ERROR_TEXT = :errorText");
    binds.errorText = updates.errorText;
  }

  if (!fields.length) return;

  await dbMutate(
    GameDbCsvImportSql.updateItem(fields),
    binds,
  );
}

export async function countGameDbCsvImportItems(importId: number): Promise<{
  pending: number;
  skipped: number;
  imported: number;
  error: number;
}> {
  const stats = { pending: 0, skipped: 0, imported: 0, error: 0 };
  const rows = await dbQuery(
    GameDbCsvImportSql.countItems,
    { importId },
    (row: { STATUS: string; CNT: number }) => row,
  );
  for (const row of rows) {
    const status = String(row.STATUS).toUpperCase();
    const count = Number(row.CNT ?? 0);
    if (status === "PENDING") stats.pending = count;
    if (status === "SKIPPED") stats.skipped = count;
    if (status === "IMPORTED") stats.imported = count;
    if (status === "ERROR") stats.error = count;
  }
  return stats;
}
