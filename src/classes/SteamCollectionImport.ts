import { apiGet, apiPatch, apiPostOrThrow } from "../services/RpgClubApiClient.js";

export type SteamCollectionImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type SteamCollectionImportItemStatus =
  | "PENDING"
  | "ADDED"
  | "UPDATED"
  | "SKIPPED"
  | "FAILED";
export type SteamCollectionMatchConfidence = "EXACT" | "FUZZY" | "MANUAL";

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
  status: SteamCollectionImportItemStatus;
  gameDbGameId: number | null;
  collectionEntryId: number | null;
  resultReason: string | null;
  errorText: string | null;
}

export interface ISteamImportCandidate {
  gameId: number;
  title: string;
}

export interface ISteamImportIgdbCandidate {
  igdbId: number;
  name: string;
  summary: string | null;
  firstReleaseDate: Date | null;
  alreadyImported: boolean;
}

export interface ISteamImportCounts {
  byStatus: Record<string, number>;
  byResultReason: Record<string, number>;
}

export interface ISteamImportReview {
  import: ISteamCollectionImport;
  /** Null when the import is completed, or when advance hit its cap and must run again. */
  item: ISteamCollectionImportItem | null;
  candidates: ISteamImportCandidate[];
  matchConfidence: SteamCollectionMatchConfidence | null;
  counts: ISteamImportCounts;
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
  status: string;
  gamedb_game_id: number | null;
  collection_entry_id: number | null;
  result_reason: string | null;
  error_text: string | null;
};

type SteamCollectionImportCountsApiData = {
  import_id: number;
  by_status: Record<string, number>;
  by_result_reason: Record<string, number>;
};

type SteamImportReviewApiData = {
  import: SteamCollectionImportApiData;
  item: SteamCollectionImportItemApiData | null;
  candidates: Array<{ game_id: number; title: string }>;
  match_confidence: string | null;
  counts: SteamCollectionImportCountsApiData;
};

type SteamImportIgdbCandidateApiData = {
  igdb_id: number;
  name: string;
  summary: string | null;
  first_release_date: string | null;
  already_imported: boolean;
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
    status: row.status.toUpperCase() as SteamCollectionImportItemStatus,
    gameDbGameId: row.gamedb_game_id == null ? null : Number(row.gamedb_game_id),
    collectionEntryId: row.collection_entry_id == null ? null : Number(row.collection_entry_id),
    resultReason: row.result_reason ? row.result_reason.toUpperCase() : null,
    errorText: row.error_text ?? null,
  };
}

function mapCounts(row: SteamCollectionImportCountsApiData | undefined): ISteamImportCounts {
  const byResultReason: Record<string, number> = {};
  for (const [key, value] of Object.entries(row?.by_result_reason ?? {})) {
    const trimmed = key.trim();
    if (!trimmed.length) continue;
    byResultReason[trimmed.toUpperCase()] = Number(value ?? 0);
  }
  return { byStatus: row?.by_status ?? {}, byResultReason };
}

export function mapSteamImportReview(row: SteamImportReviewApiData): ISteamImportReview {
  return {
    import: mapImport(row.import),
    item: row.item ? mapItem(row.item) : null,
    candidates: (row.candidates ?? []).map((candidate) => ({
      gameId: Number(candidate.game_id),
      title: candidate.title,
    })),
    matchConfidence: row.match_confidence
      ? (row.match_confidence.toUpperCase() as SteamCollectionMatchConfidence)
      : null,
    counts: mapCounts(row.counts),
  };
}

/**
 * Creates the import server-side: the API resolves the Steam profile, fetches the owned
 * library and creates one pending item per app. Throws the AxiosError on any failure so
 * the caller can show the request and response.
 */
export async function startSteamCollectionImport(params: {
  userId: string;
  steamProfile: string;
  testMode?: boolean;
}): Promise<ISteamCollectionImport> {
  const result = await apiPostOrThrow<{ data: SteamCollectionImportApiData }>(
    `/api/v1/users/${params.userId}/steam_collection_imports`,
    {
      data: {
        steam_profile: params.steamProfile,
        test_mode: params.testMode ?? false,
      },
    },
  );
  return mapImport(result.data);
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

/**
 * Moves the import to the next item that needs a person, auto-applying exact matches
 * on the way (up to 25 per call). The item is null when the import is completed, and
 * also when the cap was hit while it is still active, in which case call it again.
 */
export async function advanceSteamCollectionImport(
  importId: number,
): Promise<ISteamImportReview> {
  const result = await apiPostOrThrow<{ data: SteamImportReviewApiData }>(
    `/api/v1/steam_collection_imports/${importId}/advance`,
  );
  return mapSteamImportReview(result.data);
}

export async function applySteamImportItem(
  itemId: number,
  target: { gameId: number } | { igdbId: number },
): Promise<ISteamCollectionImportItem> {
  const data = "gameId" in target ? { game_id: target.gameId } : { igdb_id: target.igdbId };
  const result = await apiPostOrThrow<{ data: SteamCollectionImportItemApiData }>(
    `/api/v1/steam_collection_import_items/${itemId}/apply`,
    { data },
  );
  return mapItem(result.data);
}

export async function skipSteamImportItem(itemId: number): Promise<ISteamCollectionImportItem> {
  const result = await apiPostOrThrow<{ data: SteamCollectionImportItemApiData }>(
    `/api/v1/steam_collection_import_items/${itemId}/skip`,
  );
  return mapItem(result.data);
}

/** Searches GameDB again under another title; nothing is applied. */
export async function remapSteamImportItem(
  itemId: number,
  title: string,
): Promise<ISteamImportReview> {
  const result = await apiPostOrThrow<{ data: SteamImportReviewApiData }>(
    `/api/v1/steam_collection_import_items/${itemId}/remap`,
    { data: { title } },
  );
  return mapSteamImportReview(result.data);
}

export async function getSteamImportIgdbCandidates(
  itemId: number,
  query?: string,
): Promise<ISteamImportIgdbCandidate[]> {
  const result = await apiGet<{ data: SteamImportIgdbCandidateApiData[] }>(
    `/api/v1/steam_collection_import_items/${itemId}/igdb_candidates`,
    query ? { params: { q: query } } : undefined,
  );
  return (result?.data ?? []).map((row) => ({
    igdbId: Number(row.igdb_id),
    name: row.name,
    summary: row.summary ?? null,
    firstReleaseDate: row.first_release_date ? toDate(row.first_release_date) : null,
    alreadyImported: Boolean(row.already_imported),
  }));
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

export async function getSteamCollectionImportCounts(
  importId: number,
): Promise<ISteamImportCounts> {
  const result = await apiGet<{ data: SteamCollectionImportCountsApiData }>(
    `/api/v1/steam_collection_imports/${importId}/items/counts`,
  );
  return mapCounts(result?.data);
}

export function summarizeSteamImportCounts(counts: ISteamImportCounts): {
  pending: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
} {
  const byStatus = counts.byStatus;
  return {
    pending: Number(byStatus.pending ?? 0),
    added: Number(byStatus.added ?? 0),
    updated: Number(byStatus.updated ?? 0),
    skipped: Number(byStatus.skipped ?? 0),
    failed: Number(byStatus.failed ?? 0),
  };
}
