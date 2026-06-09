import oracledb from "oracledb";
import {
  dbQuery, dbMutate, dbInsert, dbTransaction, dbMutateConn, dbWithConnection,
} from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { SteamCollectionImportSql } from "../db/sql/index.js";

export type SteamCollectionImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type SteamCollectionImportItemStatus =
  | "PENDING"
  | "ADDED"
  | "UPDATED"
  | "SKIPPED"
  | "FAILED";
export type SteamCollectionMatchConfidence = "EXACT" | "FUZZY" | "MANUAL";
export type SteamAppGameDbMapStatus = "MAPPED" | "SKIPPED";
export type SteamCollectionImportResultReason =
  | "AUTO_MATCH"
  | "MANUAL_REMAP"
  | "DUPLICATE"
  | "MANUAL_SKIP"
  | "SKIP_MAPPED"
  | "NO_CANDIDATE"
  | "INVALID_REMAP"
  | "PLATFORM_UNRESOLVED"
  | "ADD_FAILED";

export interface ISteamCollectionImport {
  importId: number;
  userId: string;
  status: SteamCollectionImportStatus;
  currentIndex: number;
  totalCount: number;
  steamId64: string;
  steamProfileRef: string | null;
  sourceProfileName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISteamCollectionImportItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  steamAppId: number;
  steamAppName: string;
  playtimeForeverMin: number | null;
  playtimeWindowsMin: number | null;
  playtimeMacMin: number | null;
  playtimeLinuxMin: number | null;
  playtimeDeckMin: number | null;
  lastPlayedAt: Date | null;
  status: SteamCollectionImportItemStatus;
  matchConfidence: SteamCollectionMatchConfidence | null;
  matchCandidateJson: string | null;
  gameDbGameId: number | null;
  collectionEntryId: number | null;
  resultReason: SteamCollectionImportResultReason | null;
  errorText: string | null;
}

export interface ISteamAppGameDbMap {
  mapId: number;
  steamAppId: number;
  gameDbGameId: number | null;
  status: SteamAppGameDbMapStatus;
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
  STATUS: SteamCollectionImportStatus;
  CURRENT_INDEX: number;
  TOTAL_COUNT: number;
  STEAM_ID64: string;
  STEAM_PROFILE_REF: string | null;
  SOURCE_PROFILE_NAME: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function mapImport(row: ImportRow): ISteamCollectionImport {
  return {
    importId: Number(row.IMPORT_ID),
    userId: row.USER_ID,
    status: row.STATUS,
    currentIndex: Number(row.CURRENT_INDEX ?? 0),
    totalCount: Number(row.TOTAL_COUNT ?? 0),
    steamId64: row.STEAM_ID64,
    steamProfileRef: row.STEAM_PROFILE_REF ?? null,
    sourceProfileName: row.SOURCE_PROFILE_NAME ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

type ItemRow = {
  ITEM_ID: number;
  IMPORT_ID: number;
  ROW_INDEX: number;
  STEAM_APP_ID: number;
  STEAM_APP_NAME: string;
  PLAYTIME_FOREVER_MIN: number | null;
  PLAYTIME_WINDOWS_MIN: number | null;
  PLAYTIME_MAC_MIN: number | null;
  PLAYTIME_LINUX_MIN: number | null;
  PLAYTIME_DECK_MIN: number | null;
  LAST_PLAYED_AT: Date | string | null;
  STATUS: SteamCollectionImportItemStatus;
  MATCH_CONFIDENCE: SteamCollectionMatchConfidence | null;
  MATCH_CANDIDATE_JSON: string | null;
  GAMEDB_GAME_ID: number | null;
  COLLECTION_ENTRY_ID: number | null;
  RESULT_REASON: SteamCollectionImportResultReason | null;
  ERROR_TEXT: string | null;
};

function mapItem(row: ItemRow): ISteamCollectionImportItem {
  return {
    itemId: Number(row.ITEM_ID),
    importId: Number(row.IMPORT_ID),
    rowIndex: Number(row.ROW_INDEX),
    steamAppId: Number(row.STEAM_APP_ID),
    steamAppName: row.STEAM_APP_NAME,
    playtimeForeverMin: row.PLAYTIME_FOREVER_MIN == null
      ? null
      : Number(row.PLAYTIME_FOREVER_MIN),
    playtimeWindowsMin: row.PLAYTIME_WINDOWS_MIN == null
      ? null
      : Number(row.PLAYTIME_WINDOWS_MIN),
    playtimeMacMin: row.PLAYTIME_MAC_MIN == null ? null : Number(row.PLAYTIME_MAC_MIN),
    playtimeLinuxMin: row.PLAYTIME_LINUX_MIN == null ? null : Number(row.PLAYTIME_LINUX_MIN),
    playtimeDeckMin: row.PLAYTIME_DECK_MIN == null ? null : Number(row.PLAYTIME_DECK_MIN),
    lastPlayedAt: row.LAST_PLAYED_AT ? toDate(row.LAST_PLAYED_AT) : null,
    status: row.STATUS,
    matchConfidence: row.MATCH_CONFIDENCE ?? null,
    matchCandidateJson: row.MATCH_CANDIDATE_JSON ?? null,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    collectionEntryId: row.COLLECTION_ENTRY_ID == null ? null : Number(row.COLLECTION_ENTRY_ID),
    resultReason: row.RESULT_REASON ?? null,
    errorText: row.ERROR_TEXT ?? null,
  };
}

type AppMapRow = {
  MAP_ID: number;
  STEAM_APP_ID: number;
  GAMEDB_GAME_ID: number | null;
  STATUS: SteamAppGameDbMapStatus;
  CREATED_BY: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function mapAppMap(row: AppMapRow): ISteamAppGameDbMap {
  return {
    mapId: Number(row.MAP_ID),
    steamAppId: Number(row.STEAM_APP_ID),
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    status: row.STATUS,
    createdBy: row.CREATED_BY ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}


export async function createSteamCollectionImportSession(params: {
  userId: string;
  totalCount: number;
  steamId64: string;
  steamProfileRef: string | null;
  sourceProfileName: string | null;
}): Promise<ISteamCollectionImport> {
  const id = await dbInsert(
    SteamCollectionImportSql.createImport,
    {
      userId: params.userId,
      totalCount: params.totalCount,
      steamId64: params.steamId64,
      steamProfileRef: params.steamProfileRef,
      sourceProfileName: params.sourceProfileName,
    },
    "id",
  );
  if (!id) throw new Error("Failed to create Steam collection import session.");

  const session = await getSteamCollectionImportById(id);
  if (!session) throw new Error("Failed to load Steam collection import session.");
  return session;
}

export async function insertSteamCollectionImportItems(
  importId: number,
  items: Array<{
    rowIndex: number;
    steamAppId: number;
    steamAppName: string;
    playtimeForeverMin: number | null;
    playtimeWindowsMin: number | null;
    playtimeMacMin: number | null;
    playtimeLinuxMin: number | null;
    playtimeDeckMin: number | null;
    lastPlayedAt: Date | null;
  }>,
): Promise<void> {
  if (!items.length) return;

  await dbTransaction(async (conn) => {
    for (const item of items) {
      await dbMutateConn(conn, SteamCollectionImportSql.insertItem, {
        importId,
        rowIndex: item.rowIndex,
        steamAppId: item.steamAppId,
        steamAppName: item.steamAppName,
        playtimeForeverMin: item.playtimeForeverMin,
        playtimeWindowsMin: item.playtimeWindowsMin,
        playtimeMacMin: item.playtimeMacMin,
        playtimeLinuxMin: item.playtimeLinuxMin,
        playtimeDeckMin: item.playtimeDeckMin,
        lastPlayedAt: item.lastPlayedAt,
      });
    }
  });
}

export async function getSteamCollectionImportById(
  importId: number,
): Promise<ISteamCollectionImport | null> {
  const rows = await dbQuery(SteamCollectionImportSql.getImportById, { importId }, mapImport);
  return rows[0] ?? null;
}

export async function getActiveSteamCollectionImportForUser(
  userId: string,
): Promise<ISteamCollectionImport | null> {
  const rows = await dbQuery(
    SteamCollectionImportSql.getActiveForUser,
    { userId },
    mapImport,
  );
  return rows[0] ?? null;
}

export async function setSteamCollectionImportStatus(
  importId: number,
  status: SteamCollectionImportStatus,
): Promise<void> {
  await dbMutate(
    SteamCollectionImportSql.setStatus,
    { status, importId },
  );
}

export async function updateSteamCollectionImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  await dbMutate(
    SteamCollectionImportSql.updateIndex,
    { currentIndex, importId },
  );
}

async function fetchItemWithJsonCol(
  entry: { oracle: string; postgres: string },
  binds: Record<string, string | number>,
): Promise<ISteamCollectionImportItem | null> {
  return dbWithConnection(async (conn) => {
    if (getDialect() === "oracle") {
      const result = await (conn as oracledb.Connection).execute<ItemRow>(entry.oracle, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        fetchInfo: { MATCH_CANDIDATE_JSON: { type: oracledb.STRING } },
      });
      const row = result.rows?.[0];
      return row ? mapItem(row) : null;
    }
    const rows = await dbQuery(entry, binds, mapItem);
    return rows[0] ?? null;
  });
}

export async function getSteamCollectionImportItemById(
  itemId: number,
): Promise<ISteamCollectionImportItem | null> {
  return fetchItemWithJsonCol(SteamCollectionImportSql.getItemById, { itemId });
}

export async function getNextPendingSteamCollectionImportItem(
  importId: number,
): Promise<ISteamCollectionImportItem | null> {
  return fetchItemWithJsonCol(SteamCollectionImportSql.getNextPendingItem, { importId });
}

export async function updateSteamCollectionImportItem(
  itemId: number,
  updates: {
    status?: SteamCollectionImportItemStatus;
    matchConfidence?: SteamCollectionMatchConfidence | null;
    matchCandidateJson?: string | null;
    gameDbGameId?: number | null;
    collectionEntryId?: number | null;
    resultReason?: SteamCollectionImportResultReason | null;
    errorText?: string | null;
  },
): Promise<void> {
  const setParts: string[] = [];
  const binds: Record<string, string | number | null> = { itemId };

  if (updates.status !== undefined) {
    setParts.push("STATUS = :status");
    binds.status = updates.status;
  }
  if (updates.matchConfidence !== undefined) {
    setParts.push("MATCH_CONFIDENCE = :matchConfidence");
    binds.matchConfidence = updates.matchConfidence;
  }
  if (updates.matchCandidateJson !== undefined) {
    setParts.push("MATCH_CANDIDATE_JSON = :matchCandidateJson");
    binds.matchCandidateJson = updates.matchCandidateJson;
  }
  if (updates.gameDbGameId !== undefined) {
    setParts.push("GAMEDB_GAME_ID = :gameDbGameId");
    binds.gameDbGameId = updates.gameDbGameId;
  }
  if (updates.collectionEntryId !== undefined) {
    setParts.push("COLLECTION_ENTRY_ID = :collectionEntryId");
    binds.collectionEntryId = updates.collectionEntryId;
  }
  if (updates.resultReason !== undefined) {
    setParts.push("RESULT_REASON = :resultReason");
    binds.resultReason = updates.resultReason;
  }
  if (updates.errorText !== undefined) {
    setParts.push("ERROR_TEXT = :errorText");
    binds.errorText = updates.errorText;
  }

  if (!setParts.length) return;

  await dbMutate(
    SteamCollectionImportSql.updateItem(setParts),
    binds,
  );
}

export async function countSteamCollectionImportItems(
  importId: number,
): Promise<{
  pending: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const rows = await dbQuery(
    SteamCollectionImportSql.countItemsByStatus,
    { importId },
    (row: { STATUS: SteamCollectionImportItemStatus; CNT: number }) => row,
  );
  const counts = { pending: 0, added: 0, updated: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    const status = String(row.STATUS).toUpperCase();
    const value = Number(row.CNT ?? 0);
    if (status === "PENDING") counts.pending = value;
    else if (status === "ADDED") counts.added = value;
    else if (status === "UPDATED") counts.updated = value;
    else if (status === "SKIPPED") counts.skipped = value;
    else if (status === "FAILED") counts.failed = value;
  }
  return counts;
}

export async function countSteamCollectionImportResultReasons(
  importId: number,
): Promise<Record<string, number>> {
  const rows = await dbQuery(
    SteamCollectionImportSql.countItemsByReason,
    { importId },
    (row: { RESULT_REASON: string | null; CNT: number }) => row,
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row.RESULT_REASON ?? "").trim();
    if (!key.length) continue;
    counts[key] = Number(row.CNT ?? 0);
  }
  return counts;
}

export async function getSteamAppGameDbMapByAppId(
  steamAppId: number,
): Promise<ISteamAppGameDbMap | null> {
  const rows = await dbQuery(SteamCollectionImportSql.getAppMap, { steamAppId }, mapAppMap);
  return rows[0] ?? null;
}

export async function upsertSteamAppGameDbMap(params: {
  steamAppId: number;
  gameDbGameId: number | null;
  status: SteamAppGameDbMapStatus;
  createdBy: string | null;
}): Promise<ISteamAppGameDbMap> {
  await dbMutate(SteamCollectionImportSql.upsertAppMap, {
    steamAppId: params.steamAppId,
    gameDbGameId: params.gameDbGameId,
    status: params.status,
    createdBy: params.createdBy,
  });

  const mapping = await getSteamAppGameDbMapByAppId(params.steamAppId);
  if (!mapping) throw new Error("Failed to load Steam app mapping.");
  return mapping;
}

export async function getSteamAppHistoricalMappedGameIds(params: {
  steamAppId: number;
  excludeUserId?: string;
  limit?: number;
}): Promise<number[]> {
  const limit = Number.isInteger(params.limit) && (params.limit ?? 0) > 0
    ? Number(params.limit) : 5;

  const rows = await dbQuery(
    SteamCollectionImportSql.getHistoricalMappedIds,
    {
      steamAppId: params.steamAppId,
      excludeUserId: params.excludeUserId ?? null,
      limit,
    },
    (row: { GAMEDB_GAME_ID: number }) => Number(row.GAMEDB_GAME_ID),
  );
  return rows.filter((value) => Number.isInteger(value) && value > 0);
}
