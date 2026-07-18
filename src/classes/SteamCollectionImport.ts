import { apiGet, apiPatch, apiPost } from "../services/RpgClubApiClient.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";

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
  testMode: boolean;
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

type SteamCollectionImportApiData = {
  import_id: number;
  user_id: string;
  status: string;
  current_index: number;
  total_count: number;
  steam_id64: string;
  steam_profile_ref: string | null;
  source_profile_name: string | null;
  test_mode: boolean;
  created_at: string;
  updated_at: string;
};

type SteamCollectionImportItemApiData = {
  item_id: number;
  import_id: number;
  row_index: number;
  steam_app_id: number;
  steam_app_name: string;
  playtime_forever_min: number | null;
  playtime_windows_min: number | null;
  playtime_mac_min: number | null;
  playtime_linux_min: number | null;
  playtime_deck_min: number | null;
  last_played_at: string | null;
  status: string;
  match_confidence: string | null;
  match_candidate_json: string | null;
  gamedb_game_id: number | null;
  collection_entry_id: number | null;
  result_reason: string | null;
  error_text: string | null;
};

type SteamAppGameDbMapApiData = {
  map_id: number;
  steam_app_id: number;
  gamedb_game_id: number | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SteamCollectionImportItemCountsApiData = {
  import_id: number;
  by_status: Record<string, number>;
  by_result_reason: Record<string, number>;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapImport(row: SteamCollectionImportApiData): ISteamCollectionImport {
  return {
    importId: Number(row.import_id),
    userId: row.user_id,
    status: row.status.toUpperCase() as SteamCollectionImportStatus,
    currentIndex: Number(row.current_index ?? 0),
    totalCount: Number(row.total_count ?? 0),
    steamId64: row.steam_id64,
    steamProfileRef: row.steam_profile_ref ?? null,
    sourceProfileName: row.source_profile_name ?? null,
    testMode: Boolean(row.test_mode),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapItem(row: SteamCollectionImportItemApiData): ISteamCollectionImportItem {
  return {
    itemId: Number(row.item_id),
    importId: Number(row.import_id),
    rowIndex: Number(row.row_index),
    steamAppId: Number(row.steam_app_id),
    steamAppName: row.steam_app_name,
    playtimeForeverMin: row.playtime_forever_min == null
      ? null
      : Number(row.playtime_forever_min),
    playtimeWindowsMin: row.playtime_windows_min == null
      ? null
      : Number(row.playtime_windows_min),
    playtimeMacMin: row.playtime_mac_min == null ? null : Number(row.playtime_mac_min),
    playtimeLinuxMin: row.playtime_linux_min == null ? null : Number(row.playtime_linux_min),
    playtimeDeckMin: row.playtime_deck_min == null ? null : Number(row.playtime_deck_min),
    lastPlayedAt: row.last_played_at ? toDate(row.last_played_at) : null,
    status: row.status.toUpperCase() as SteamCollectionImportItemStatus,
    matchConfidence: row.match_confidence
      ? (row.match_confidence.toUpperCase() as SteamCollectionMatchConfidence)
      : null,
    matchCandidateJson: row.match_candidate_json ?? null,
    gameDbGameId: row.gamedb_game_id == null ? null : Number(row.gamedb_game_id),
    collectionEntryId: row.collection_entry_id == null ? null : Number(row.collection_entry_id),
    resultReason: row.result_reason
      ? (row.result_reason.toUpperCase() as SteamCollectionImportResultReason)
      : null,
    errorText: row.error_text ?? null,
  };
}

function mapAppMap(row: SteamAppGameDbMapApiData): ISteamAppGameDbMap {
  return {
    mapId: Number(row.map_id),
    steamAppId: Number(row.steam_app_id),
    gameDbGameId: row.gamedb_game_id == null ? null : Number(row.gamedb_game_id),
    status: row.status.toUpperCase() as SteamAppGameDbMapStatus,
    createdBy: row.created_by ?? null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export async function createSteamCollectionImportSession(params: {
  userId: string;
  totalCount: number;
  steamId64: string;
  steamProfileRef: string | null;
  sourceProfileName: string | null;
  testMode?: boolean;
}): Promise<ISteamCollectionImport> {
  const result = await apiPost<{ data: SteamCollectionImportApiData }>(
    "/api/v1/steam_collection_imports",
    {
      data: {
        user_id: params.userId,
        steam_id64: params.steamId64,
        steam_profile_ref: params.steamProfileRef,
        source_profile_name: params.sourceProfileName,
        test_mode: params.testMode ?? false,
      },
    },
  );
  if (!result?.data) throw new Error("Failed to create Steam collection import session.");
  return mapImport(result.data);
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

  await apiPost(`/api/v1/steam_collection_imports/${importId}/items`, {
    data: {
      items: items.map((item) => ({
        row_index: item.rowIndex,
        steam_app_id: item.steamAppId,
        steam_app_name: item.steamAppName,
        playtime_forever_min: item.playtimeForeverMin,
        playtime_windows_min: item.playtimeWindowsMin,
        playtime_mac_min: item.playtimeMacMin,
        playtime_linux_min: item.playtimeLinuxMin,
        playtime_deck_min: item.playtimeDeckMin,
        last_played_at: item.lastPlayedAt,
      })),
    },
  });
}

export async function getSteamCollectionImportById(
  importId: number,
): Promise<ISteamCollectionImport | null> {
  const result = await apiGet<{ data: SteamCollectionImportApiData }>(
    `/api/v1/steam_collection_imports/${importId}`,
  );
  if (!result?.data) return null;
  return mapImport(result.data);
}

export async function getActiveSteamCollectionImportForUser(
  userId: string,
): Promise<ISteamCollectionImport | null> {
  const result = await apiGet<{ data: SteamCollectionImportApiData }>(
    `/api/v1/users/${userId}/steam_collection_imports/active`,
  );
  if (!result?.data) return null;
  return mapImport(result.data);
}

export async function setSteamCollectionImportStatus(
  importId: number,
  status: SteamCollectionImportStatus,
): Promise<void> {
  await apiPatch(`/api/v1/steam_collection_imports/${importId}`, {
    data: { status: status.toLowerCase() },
  });
}

export async function updateSteamCollectionImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  await apiPatch(`/api/v1/steam_collection_imports/${importId}`, {
    data: { current_index: currentIndex },
  });
}

export async function getSteamCollectionImportItemById(
  itemId: number,
): Promise<ISteamCollectionImportItem | null> {
  const result = await apiGet<{ data: SteamCollectionImportItemApiData }>(
    `/api/v1/steam_collection_import_items/${itemId}`,
  );
  if (!result?.data) return null;
  return mapItem(result.data);
}

export async function getNextPendingSteamCollectionImportItem(
  importId: number,
): Promise<ISteamCollectionImportItem | null> {
  const result = await apiGet<{ data: SteamCollectionImportItemApiData | null }>(
    `/api/v1/steam_collection_imports/${importId}/items/next_pending`,
  );
  if (!result?.data) return null;
  return mapItem(result.data);
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
  const data: Record<string, unknown> = {};

  if (updates.status !== undefined) data.status = updates.status.toLowerCase();
  if (updates.matchConfidence !== undefined) {
    data.match_confidence = updates.matchConfidence?.toLowerCase() ?? null;
  }
  if (updates.matchCandidateJson !== undefined) {
    data.match_candidate_json = updates.matchCandidateJson;
  }
  if (updates.gameDbGameId !== undefined) data.gamedb_game_id = updates.gameDbGameId;
  if (updates.collectionEntryId !== undefined) data.collection_entry_id = updates.collectionEntryId;
  if (updates.resultReason !== undefined) {
    data.result_reason = updates.resultReason?.toLowerCase() ?? null;
  }
  if (updates.errorText !== undefined) data.error_text = updates.errorText;

  if (!Object.keys(data).length) return;

  await apiPatch(`/api/v1/steam_collection_import_items/${itemId}`, { data });
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
  const result = await apiGet<{ data: SteamCollectionImportItemCountsApiData }>(
    `/api/v1/steam_collection_imports/${importId}/items/counts`,
  );
  const byStatus = result?.data?.by_status ?? {};
  return {
    pending: Number(byStatus.pending ?? 0),
    added: Number(byStatus.added ?? 0),
    updated: Number(byStatus.updated ?? 0),
    skipped: Number(byStatus.skipped ?? 0),
    failed: Number(byStatus.failed ?? 0),
  };
}

export async function countSteamCollectionImportResultReasons(
  importId: number,
): Promise<Record<string, number>> {
  const result = await apiGet<{ data: SteamCollectionImportItemCountsApiData }>(
    `/api/v1/steam_collection_imports/${importId}/items/counts`,
  );
  const byReason = result?.data?.by_result_reason ?? {};
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(byReason)) {
    const trimmed = key.trim();
    if (!trimmed.length) continue;
    counts[trimmed.toUpperCase()] = Number(value ?? 0);
  }
  return counts;
}

export async function getSteamAppGameDbMapByAppId(
  steamAppId: number,
): Promise<ISteamAppGameDbMap | null> {
  const result = await apiGet<{ data: SteamAppGameDbMapApiData }>(
    `/api/v1/steam_app_gamedb_maps/${steamAppId}`,
  );
  if (!result?.data) return null;
  return mapAppMap(result.data);
}

export async function upsertSteamAppGameDbMap(params: {
  steamAppId: number;
  gameDbGameId: number | null;
  status: SteamAppGameDbMapStatus;
  createdBy: string | null;
}): Promise<ISteamAppGameDbMap> {
  const result = await apiPost<{ data: SteamAppGameDbMapApiData }>(
    "/api/v1/steam_app_gamedb_maps",
    {
      data: {
        steam_app_id: params.steamAppId,
        gamedb_game_id: params.gameDbGameId,
        status: params.status.toLowerCase(),
        created_by: params.createdBy,
      },
    },
  );
  if (!result?.data) throw new Error("Failed to load Steam app mapping.");
  return mapAppMap(result.data);
}

export async function getSteamAppHistoricalMappedGameIds(params: {
  userId: string;
  limit?: number;
}): Promise<number[]> {
  const limit = isPositiveInt(params.limit) ? Number(params.limit) : 5;

  const result = await apiGet<{ data: number[] }>(
    `/api/v1/users/${params.userId}/steam_app_gamedb_maps/historical`,
  );
  return (result?.data ?? []).filter(isPositiveInt).slice(0, limit);
}
