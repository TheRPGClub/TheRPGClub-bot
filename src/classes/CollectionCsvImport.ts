import { apiGet, apiPatch, apiPost } from "../services/RpgClubApiClient.js";

export type CollectionCsvImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type CollectionCsvImportItemStatus =
  | "PENDING"
  | "ADDED"
  | "UPDATED"
  | "SKIPPED"
  | "FAILED";
export type CollectionCsvMatchConfidence = "EXACT" | "FUZZY" | "MANUAL";
export type CollectionCsvImportResultReason =
  | "AUTO_MATCH"
  | "CSV_GAMEDB_ID"
  | "CSV_IGDB_ID"
  | "MANUAL_REMAP"
  | "DUPLICATE"
  | "MANUAL_SKIP"
  | "NO_CANDIDATE"
  | "INVALID_REMAP"
  | "PLATFORM_UNRESOLVED"
  | "ADD_FAILED"
  | "INVALID_ROW";

export interface ICollectionCsvImport {
  importId: number;
  userId: string;
  status: CollectionCsvImportStatus;
  currentIndex: number;
  totalCount: number;
  sourceFileName: string | null;
  sourceFileSize: number | null;
  templateVersion: string | null;
  testMode: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICollectionCsvImportItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  rawTitle: string;
  rawPlatform: string | null;
  rawOwnershipType: string | null;
  rawNote: string | null;
  rawGameDbId: number | null;
  rawIgdbId: number | null;
  status: CollectionCsvImportItemStatus;
  matchConfidence: CollectionCsvMatchConfidence | null;
  matchCandidateJson: string | null;
  gameDbGameId: number | null;
  collectionEntryId: number | null;
  resultReason: CollectionCsvImportResultReason | null;
  errorText: string | null;
}

type CollectionCsvImportApiData = {
  import_id: number;
  user_id: string;
  status: string;
  current_index: number;
  total_count: number;
  source_file_name: string | null;
  source_file_size: number | null;
  template_version: string | null;
  test_mode: boolean;
  created_at: string;
  updated_at: string;
};

type CollectionCsvImportItemApiData = {
  item_id: number;
  import_id: number;
  row_index: number;
  raw_title: string | null;
  raw_platform: string | null;
  raw_ownership_type: string | null;
  raw_note: string | null;
  raw_gamedb_id: number | null;
  raw_igdb_id: number | null;
  status: string;
  match_confidence: string | null;
  match_candidate_json: string | null;
  gamedb_game_id: number | null;
  collection_entry_id: number | null;
  result_reason: string | null;
  error_text: string | null;
};

type CollectionCsvImportSummaryApiData = {
  import_id: number;
  by_status: Record<string, number>;
  by_result_reason: Record<string, number>;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapImport(row: CollectionCsvImportApiData): ICollectionCsvImport {
  return {
    importId: Number(row.import_id),
    userId: row.user_id,
    status: row.status.toUpperCase() as CollectionCsvImportStatus,
    currentIndex: Number(row.current_index ?? 0),
    totalCount: Number(row.total_count ?? 0),
    sourceFileName: row.source_file_name ?? null,
    sourceFileSize: row.source_file_size == null ? null : Number(row.source_file_size),
    templateVersion: row.template_version ?? null,
    testMode: Boolean(row.test_mode),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapItem(row: CollectionCsvImportItemApiData): ICollectionCsvImportItem {
  return {
    itemId: Number(row.item_id),
    importId: Number(row.import_id),
    rowIndex: Number(row.row_index),
    rawTitle: row.raw_title ?? "",
    rawPlatform: row.raw_platform ?? null,
    rawOwnershipType: row.raw_ownership_type ?? null,
    rawNote: row.raw_note ?? null,
    rawGameDbId: row.raw_gamedb_id == null ? null : Number(row.raw_gamedb_id),
    rawIgdbId: row.raw_igdb_id == null ? null : Number(row.raw_igdb_id),
    status: row.status.toUpperCase() as CollectionCsvImportItemStatus,
    matchConfidence: (row.match_confidence as CollectionCsvMatchConfidence | null) ?? null,
    matchCandidateJson: row.match_candidate_json ?? null,
    gameDbGameId: row.gamedb_game_id == null ? null : Number(row.gamedb_game_id),
    collectionEntryId: row.collection_entry_id == null ? null : Number(row.collection_entry_id),
    resultReason: (row.result_reason as CollectionCsvImportResultReason | null) ?? null,
    errorText: row.error_text ?? null,
  };
}

export async function createCollectionCsvImportSession(params: {
  userId: string;
  sourceFileName: string | null;
  sourceFileSize: number | null;
  templateVersion: string | null;
  testMode?: boolean;
  items: Array<{
    rowIndex: number;
    rawTitle: string;
    rawPlatform: string | null;
    rawOwnershipType: string | null;
    rawNote: string | null;
    rawGameDbId: number | null;
    rawIgdbId: number | null;
  }>;
}): Promise<ICollectionCsvImport> {
  const result = await apiPost<{ data: CollectionCsvImportApiData }>(
    `/api/v1/users/${params.userId}/collection_csv_imports`,
    {
      data: {
        source_file_name: params.sourceFileName,
        source_file_size: params.sourceFileSize,
        template_version: params.templateVersion,
        test_mode: params.testMode ?? false,
        items: params.items.map((item) => ({
          row_index: item.rowIndex,
          raw_title: item.rawTitle,
          raw_platform: item.rawPlatform,
          raw_ownership_type: item.rawOwnershipType,
          raw_note: item.rawNote,
          raw_gamedb_id: item.rawGameDbId,
          raw_igdb_id: item.rawIgdbId,
        })),
      },
    },
  );
  if (!result?.data) throw new Error("Failed to create CSV collection import session.");
  return mapImport(result.data);
}

export async function getCollectionCsvImportById(
  importId: number,
): Promise<ICollectionCsvImport | null> {
  const result = await apiGet<{ data: CollectionCsvImportApiData }>(
    `/api/v1/collection_csv_imports/${importId}`,
  );
  if (!result?.data) return null;
  return mapImport(result.data);
}

export async function getActiveCollectionCsvImportForUser(
  userId: string,
): Promise<ICollectionCsvImport | null> {
  const result = await apiGet<{ data: CollectionCsvImportApiData }>(
    `/api/v1/users/${userId}/collection_csv_imports/active`,
  );
  if (!result?.data) return null;
  return mapImport(result.data);
}

export async function setCollectionCsvImportStatus(
  importId: number,
  status: CollectionCsvImportStatus,
): Promise<void> {
  await apiPatch(`/api/v1/collection_csv_imports/${importId}`, {
    data: { status: status.toLowerCase() },
  });
}

export async function updateCollectionCsvImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  await apiPatch(`/api/v1/collection_csv_imports/${importId}`, {
    data: { current_index: currentIndex },
  });
}

export async function getCollectionCsvImportItemById(
  itemId: number,
): Promise<ICollectionCsvImportItem | null> {
  const result = await apiGet<{ data: CollectionCsvImportItemApiData }>(
    `/api/v1/collection_csv_import_items/${itemId}`,
  );
  if (!result?.data) return null;
  return mapItem(result.data);
}

export async function getNextPendingCollectionCsvImportItem(
  importId: number,
): Promise<ICollectionCsvImportItem | null> {
  const result = await apiGet<{ data: CollectionCsvImportItemApiData | null }>(
    `/api/v1/collection_csv_imports/${importId}/items/next_pending`,
  );
  if (!result?.data) return null;
  return mapItem(result.data);
}

export async function updateCollectionCsvImportItem(
  itemId: number,
  updates: {
    status?: CollectionCsvImportItemStatus;
    matchConfidence?: CollectionCsvMatchConfidence | null;
    matchCandidateJson?: string | null;
    gameDbGameId?: number | null;
    collectionEntryId?: number | null;
    resultReason?: CollectionCsvImportResultReason | null;
    errorText?: string | null;
  },
): Promise<void> {
  const data: Record<string, unknown> = {};

  if (updates.status !== undefined) data.status = updates.status.toLowerCase();
  if (updates.matchConfidence !== undefined) data.match_confidence = updates.matchConfidence;
  if (updates.matchCandidateJson !== undefined) {
    data.match_candidate_json = updates.matchCandidateJson;
  }
  if (updates.gameDbGameId !== undefined) data.gamedb_game_id = updates.gameDbGameId;
  if (updates.collectionEntryId !== undefined) data.collection_entry_id = updates.collectionEntryId;
  if (updates.resultReason !== undefined) data.result_reason = updates.resultReason;
  if (updates.errorText !== undefined) data.error_text = updates.errorText;

  if (!Object.keys(data).length) return;

  await apiPatch(`/api/v1/collection_csv_import_items/${itemId}`, { data });
}

export async function countCollectionCsvImportItems(
  importId: number,
): Promise<{
  pending: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const result = await apiGet<{ data: CollectionCsvImportSummaryApiData }>(
    `/api/v1/collection_csv_imports/${importId}/summary`,
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

export async function countCollectionCsvImportResultReasons(
  importId: number,
): Promise<Record<string, number>> {
  const result = await apiGet<{ data: CollectionCsvImportSummaryApiData }>(
    `/api/v1/collection_csv_imports/${importId}/summary`,
  );
  return result?.data?.by_result_reason ?? {};
}
