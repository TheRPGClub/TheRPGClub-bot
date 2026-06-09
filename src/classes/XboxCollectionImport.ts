import {
  dbQuery, dbMutate, dbInsert, dbTransaction, dbMutateConn,
} from "../db/SqlManager.js";
import { XboxCollectionImportSql } from "../db/sql/index.js";

export type XboxCollectionImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type XboxCollectionImportItemStatus =
  | "PENDING"
  | "ADDED"
  | "UPDATED"
  | "SKIPPED"
  | "FAILED";
export type XboxCollectionMatchConfidence = "EXACT" | "FUZZY" | "MANUAL";
export type XboxTitleGameDbMapStatus = "MAPPED" | "SKIPPED";
export type XboxCollectionImportResultReason =
  | "AUTO_MATCH"
  | "XBOX_GAMEDB_ID"
  | "XBOX_IGDB_ID"
  | "MANUAL_REMAP"
  | "DUPLICATE"
  | "MANUAL_SKIP"
  | "SKIP_MAPPED"
  | "NO_CANDIDATE"
  | "INVALID_REMAP"
  | "PLATFORM_UNRESOLVED"
  | "ADD_FAILED"
  | "INVALID_ROW";

export interface IXboxCollectionImport {
  importId: number;
  userId: string;
  status: XboxCollectionImportStatus;
  currentIndex: number;
  totalCount: number;
  xuid: string | null;
  gamertag: string | null;
  sourceType: "API" | "CSV";
  sourceFileName: string | null;
  sourceFileSize: number | null;
  templateVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IXboxCollectionImportItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  xboxTitleId: string | null;
  xboxProductId: string | null;
  xboxTitleName: string;
  rawPlatform: string | null;
  rawOwnershipType: string | null;
  rawNote: string | null;
  rawGameDbId: number | null;
  rawIgdbId: number | null;
  platformId: number | null;
  ownershipType: string | null;
  note: string | null;
  status: XboxCollectionImportItemStatus;
  matchConfidence: XboxCollectionMatchConfidence | null;
  matchCandidateJson: string | null;
  gameDbGameId: number | null;
  collectionEntryId: number | null;
  resultReason: XboxCollectionImportResultReason | null;
  errorText: string | null;
}

export interface IXboxTitleGameDbMap {
  mapId: number;
  xboxTitleId: string;
  gameDbGameId: number | null;
  status: XboxTitleGameDbMapStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

type ImportRow = {
  IMPORT_ID: number;
  USER_ID: string;
  STATUS: XboxCollectionImportStatus;
  CURRENT_INDEX: number;
  TOTAL_COUNT: number;
  XUID: string | null;
  GAMERTAG: string | null;
  SOURCE_TYPE: "API" | "CSV";
  SOURCE_FILE_NAME: string | null;
  SOURCE_FILE_SIZE: number | null;
  TEMPLATE_VERSION: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function mapImport(row: ImportRow): IXboxCollectionImport {
  return {
    importId: Number(row.IMPORT_ID),
    userId: row.USER_ID,
    status: row.STATUS,
    currentIndex: Number(row.CURRENT_INDEX ?? 0),
    totalCount: Number(row.TOTAL_COUNT ?? 0),
    xuid: row.XUID ?? null,
    gamertag: row.GAMERTAG ?? null,
    sourceType: row.SOURCE_TYPE,
    sourceFileName: row.SOURCE_FILE_NAME ?? null,
    sourceFileSize: row.SOURCE_FILE_SIZE == null ? null : Number(row.SOURCE_FILE_SIZE),
    templateVersion: row.TEMPLATE_VERSION ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

type ItemRow = {
  ITEM_ID: number;
  IMPORT_ID: number;
  ROW_INDEX: number;
  XBOX_TITLE_ID: string | null;
  XBOX_PRODUCT_ID: string | null;
  XBOX_TITLE_NAME: string;
  RAW_PLATFORM: string | null;
  RAW_OWNERSHIP_TYPE: string | null;
  RAW_NOTE: string | null;
  RAW_GAMEDB_ID: number | null;
  RAW_IGDB_ID: number | null;
  PLATFORM_ID: number | null;
  OWNERSHIP_TYPE: string | null;
  NOTE: string | null;
  STATUS: XboxCollectionImportItemStatus;
  MATCH_CONFIDENCE: XboxCollectionMatchConfidence | null;
  MATCH_CANDIDATE_JSON: string | null;
  GAMEDB_GAME_ID: number | null;
  COLLECTION_ENTRY_ID: number | null;
  RESULT_REASON: XboxCollectionImportResultReason | null;
  ERROR_TEXT: string | null;
};

function mapItem(row: ItemRow): IXboxCollectionImportItem {
  return {
    itemId: Number(row.ITEM_ID),
    importId: Number(row.IMPORT_ID),
    rowIndex: Number(row.ROW_INDEX),
    xboxTitleId: row.XBOX_TITLE_ID ?? null,
    xboxProductId: row.XBOX_PRODUCT_ID ?? null,
    xboxTitleName: row.XBOX_TITLE_NAME,
    rawPlatform: row.RAW_PLATFORM ?? null,
    rawOwnershipType: row.RAW_OWNERSHIP_TYPE ?? null,
    rawNote: row.RAW_NOTE ?? null,
    rawGameDbId: row.RAW_GAMEDB_ID == null ? null : Number(row.RAW_GAMEDB_ID),
    rawIgdbId: row.RAW_IGDB_ID == null ? null : Number(row.RAW_IGDB_ID),
    platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
    ownershipType: row.OWNERSHIP_TYPE ?? null,
    note: row.NOTE ?? null,
    status: row.STATUS,
    matchConfidence: row.MATCH_CONFIDENCE ?? null,
    matchCandidateJson: row.MATCH_CANDIDATE_JSON ?? null,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    collectionEntryId: row.COLLECTION_ENTRY_ID == null ? null : Number(row.COLLECTION_ENTRY_ID),
    resultReason: row.RESULT_REASON ?? null,
    errorText: row.ERROR_TEXT ?? null,
  };
}

type TitleMapRow = {
  MAP_ID: number;
  XBOX_TITLE_ID: string;
  GAMEDB_GAME_ID: number | null;
  STATUS: XboxTitleGameDbMapStatus;
  CREATED_BY: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function mapTitleMap(row: TitleMapRow): IXboxTitleGameDbMap {
  return {
    mapId: Number(row.MAP_ID),
    xboxTitleId: row.XBOX_TITLE_ID,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    status: row.STATUS,
    createdBy: row.CREATED_BY ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}


export async function createXboxCollectionImportSession(params: {
  userId: string;
  totalCount: number;
  xuid: string | null;
  gamertag: string | null;
  sourceType: "API" | "CSV";
  sourceFileName: string | null;
  sourceFileSize: number | null;
  templateVersion: string | null;
}): Promise<IXboxCollectionImport> {
  const id = await dbInsert(
    XboxCollectionImportSql.createImport,
    {
      userId: params.userId,
      totalCount: params.totalCount,
      xuid: params.xuid,
      gamertag: params.gamertag,
      sourceType: params.sourceType,
      sourceFileName: params.sourceFileName,
      sourceFileSize: params.sourceFileSize,
      templateVersion: params.templateVersion,
    },
    "id",
  );
  if (!id) throw new Error("Failed to create Xbox collection import session.");

  const session = await getXboxCollectionImportById(id);
  if (!session) throw new Error("Failed to load Xbox collection import session.");
  return session;
}

export async function insertXboxCollectionImportItems(
  importId: number,
  items: Array<{
    rowIndex: number;
    xboxTitleId: string | null;
    xboxProductId: string | null;
    xboxTitleName: string;
    rawPlatform: string | null;
    rawOwnershipType: string | null;
    rawNote: string | null;
    rawGameDbId: number | null;
    rawIgdbId: number | null;
    platformId: number | null;
    ownershipType: string | null;
    note: string | null;
  }>,
): Promise<void> {
  if (!items.length) return;

  await dbTransaction(async (conn) => {
    for (const item of items) {
      await dbMutateConn(conn, XboxCollectionImportSql.insertItem, {
        importId,
        rowIndex: item.rowIndex,
        xboxTitleId: item.xboxTitleId,
        xboxProductId: item.xboxProductId,
        xboxTitleName: item.xboxTitleName,
        rawPlatform: item.rawPlatform,
        rawOwnershipType: item.rawOwnershipType,
        rawNote: item.rawNote,
        rawGameDbId: item.rawGameDbId,
        rawIgdbId: item.rawIgdbId,
        platformId: item.platformId,
        ownershipType: item.ownershipType,
        note: item.note,
      });
    }
  });
}

export async function getXboxCollectionImportById(
  importId: number,
): Promise<IXboxCollectionImport | null> {
  const rows = await dbQuery(XboxCollectionImportSql.getImportById, { importId }, mapImport);
  return rows[0] ?? null;
}

export async function getActiveXboxCollectionImportForUser(
  userId: string,
): Promise<IXboxCollectionImport | null> {
  const rows = await dbQuery(
    XboxCollectionImportSql.getActiveForUser,
    { userId },
    mapImport,
  );
  return rows[0] ?? null;
}

export async function setXboxCollectionImportStatus(
  importId: number,
  status: XboxCollectionImportStatus,
): Promise<void> {
  await dbMutate(
    XboxCollectionImportSql.setStatus,
    { importId, status },
  );
}

export async function updateXboxCollectionImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  await dbMutate(
    XboxCollectionImportSql.updateIndex,
    { importId, currentIndex },
  );
}

export async function getXboxCollectionImportItemById(
  itemId: number,
): Promise<IXboxCollectionImportItem | null> {
  const rows = await dbQuery(
    XboxCollectionImportSql.getItemById,
    { itemId },
    mapItem,
  );
  return rows[0] ?? null;
}

export async function getNextPendingXboxCollectionImportItem(
  importId: number,
): Promise<IXboxCollectionImportItem | null> {
  const rows = await dbQuery(
    XboxCollectionImportSql.getNextPendingItem,
    { importId },
    mapItem,
  );
  return rows[0] ?? null;
}

export async function updateXboxCollectionImportItem(
  itemId: number,
  updates: {
    status?: XboxCollectionImportItemStatus;
    matchConfidence?: XboxCollectionMatchConfidence | null;
    matchCandidateJson?: string | null;
    gameDbGameId?: number | null;
    collectionEntryId?: number | null;
    resultReason?: XboxCollectionImportResultReason | null;
    errorText?: string | null;
  },
): Promise<void> {
  const fields: string[] = [];
  const binds: Record<string, string | number | null> = { itemId };

  if (updates.status) {
    fields.push("STATUS = :status");
    binds.status = updates.status;
  }
  if (updates.matchConfidence !== undefined) {
    fields.push("MATCH_CONFIDENCE = :matchConfidence");
    binds.matchConfidence = updates.matchConfidence;
  }
  if (updates.matchCandidateJson !== undefined) {
    fields.push("MATCH_CANDIDATE_JSON = :matchCandidateJson");
    binds.matchCandidateJson = updates.matchCandidateJson;
  }
  if (updates.gameDbGameId !== undefined) {
    fields.push("GAMEDB_GAME_ID = :gameDbGameId");
    binds.gameDbGameId = updates.gameDbGameId;
  }
  if (updates.collectionEntryId !== undefined) {
    fields.push("COLLECTION_ENTRY_ID = :collectionEntryId");
    binds.collectionEntryId = updates.collectionEntryId;
  }
  if (updates.resultReason !== undefined) {
    fields.push("RESULT_REASON = :resultReason");
    binds.resultReason = updates.resultReason;
  }
  if (updates.errorText !== undefined) {
    fields.push("ERROR_TEXT = :errorText");
    binds.errorText = updates.errorText;
  }

  if (!fields.length) return;

  await dbMutate(
    XboxCollectionImportSql.updateItem(fields),
    binds,
  );
}

export async function countXboxCollectionImportItems(
  importId: number,
): Promise<{
  pending: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const rows = await dbQuery(
    XboxCollectionImportSql.countItemsByStatus,
    { importId },
    (row: { STATUS: XboxCollectionImportItemStatus; CNT: number }) => row,
  );
  const counts = { pending: 0, added: 0, updated: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    const count = Number(row.CNT ?? 0);
    if (row.STATUS === "PENDING") counts.pending = count;
    if (row.STATUS === "ADDED") counts.added = count;
    if (row.STATUS === "UPDATED") counts.updated = count;
    if (row.STATUS === "SKIPPED") counts.skipped = count;
    if (row.STATUS === "FAILED") counts.failed = count;
  }
  return counts;
}

export async function countXboxCollectionImportResultReasons(
  importId: number,
): Promise<Record<string, number>> {
  const rows = await dbQuery(
    XboxCollectionImportSql.countItemsByReason,
    { importId },
    (row: { RESULT_REASON: XboxCollectionImportResultReason | null; CNT: number }) => row,
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.RESULT_REASON) continue;
    counts[row.RESULT_REASON] = Number(row.CNT ?? 0);
  }
  return counts;
}

export async function getXboxTitleGameDbMapByTitleId(
  xboxTitleId: string,
): Promise<IXboxTitleGameDbMap | null> {
  const rows = await dbQuery(XboxCollectionImportSql.getTitleMap, { xboxTitleId }, mapTitleMap);
  return rows[0] ?? null;
}

export async function upsertXboxTitleGameDbMap(params: {
  xboxTitleId: string;
  gameDbGameId: number | null;
  status: XboxTitleGameDbMapStatus;
  createdBy: string | null;
}): Promise<IXboxTitleGameDbMap> {
  await dbMutate(XboxCollectionImportSql.upsertTitleMap, {
    xboxTitleId: params.xboxTitleId,
    gameDbGameId: params.gameDbGameId,
    status: params.status,
    createdBy: params.createdBy,
  });

  const mapping = await getXboxTitleGameDbMapByTitleId(params.xboxTitleId);
  if (!mapping) throw new Error("Failed to load Xbox title mapping.");
  return mapping;
}

export async function getXboxTitleHistoricalMappedGameIds(params: {
  xboxTitleId: string;
  excludeUserId?: string;
  limit?: number;
}): Promise<number[]> {
  const limit = Number.isInteger(params.limit) &&
    (params.limit ?? 0) > 0 ? Number(params.limit) : 5;

  const rows = await dbQuery(
    XboxCollectionImportSql.getHistoricalMappedIds,
    {
      xboxTitleId: params.xboxTitleId,
      excludeUserId: params.excludeUserId ?? null,
      limit,
    },
    (row: { GAMEDB_GAME_ID: number }) => Number(row.GAMEDB_GAME_ID),
  );
  return rows.filter((value) => Number.isInteger(value) && value > 0);
}
