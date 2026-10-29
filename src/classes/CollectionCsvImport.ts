import { apiGet, apiPatch, apiPostOrThrow } from "../services/RpgClubApiClient.js";

export type CollectionCsvImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type CollectionCsvImportItemStatus =
  | "PENDING"
  | "ADDED"
  | "UPDATED"
  | "SKIPPED"
  | "FAILED";
export type CollectionCsvMatchConfidence = "EXACT" | "FUZZY" | "MANUAL";

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
  platformId: number | null;
  ownershipType: string | null;
  note: string | null;
  status: CollectionCsvImportItemStatus;
  gameDbGameId: number | null;
  collectionEntryId: number | null;
  resultReason: string | null;
  errorText: string | null;
}

export interface ICsvImportCandidate {
  gameId: number;
  title: string;
}

export interface ICsvImportIgdbCandidate {
  igdbId: number;
  name: string;
  summary: string | null;
  firstReleaseDate: Date | null;
  alreadyImported: boolean;
}

export interface ICsvImportCounts {
  byStatus: Record<string, number>;
  byResultReason: Record<string, number>;
}

export interface ICsvImportReview {
  import: ICollectionCsvImport;
  /** Null when the import is completed, or when advance hit its cap and must run again. */
  item: ICollectionCsvImportItem | null;
  candidates: ICsvImportCandidate[];
  matchConfidence: CollectionCsvMatchConfidence | null;
  counts: ICsvImportCounts;
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
  platform_id: number | null;
  ownership_type: string | null;
  note: string | null;
  status: string;
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

type CsvImportReviewApiData = {
  import: CollectionCsvImportApiData;
  item: CollectionCsvImportItemApiData | null;
  candidates: Array<{ game_id: number; title: string }>;
  match_confidence: string | null;
  counts: CollectionCsvImportSummaryApiData;
};

type CsvImportIgdbCandidateApiData = {
  igdb_id: number;
  name: string;
  summary: string | null;
  first_release_date: string | null;
  already_imported: boolean;
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
    platformId: row.platform_id == null ? null : Number(row.platform_id),
    ownershipType: row.ownership_type ?? null,
    note: row.note ?? null,
    status: row.status.toUpperCase() as CollectionCsvImportItemStatus,
    gameDbGameId: row.gamedb_game_id == null ? null : Number(row.gamedb_game_id),
    collectionEntryId: row.collection_entry_id == null ? null : Number(row.collection_entry_id),
    resultReason: row.result_reason ? row.result_reason.toUpperCase() : null,
    errorText: row.error_text ?? null,
  };
}

function mapCounts(row: CollectionCsvImportSummaryApiData | undefined): ICsvImportCounts {
  const byResultReason: Record<string, number> = {};
  for (const [key, value] of Object.entries(row?.by_result_reason ?? {})) {
    const trimmed = key.trim();
    if (!trimmed.length) continue;
    byResultReason[trimmed.toUpperCase()] = Number(value ?? 0);
  }
  return { byStatus: row?.by_status ?? {}, byResultReason };
}

export function mapCsvImportReview(row: CsvImportReviewApiData): ICsvImportReview {
  return {
    import: mapImport(row.import),
    item: row.item ? mapItem(row.item) : null,
    candidates: (row.candidates ?? []).map((candidate) => ({
      gameId: Number(candidate.game_id),
      title: candidate.title,
    })),
    matchConfidence: row.match_confidence
      ? (row.match_confidence.toUpperCase() as CollectionCsvMatchConfidence)
      : null,
    counts: mapCounts(row.counts),
  };
}

/**
 * The create call parses and inserts the whole file and `advance` auto-applies up to 25
 * rows, so both outlast the shared client's default timeout. A timed-out write is never
 * retried, and the server can still finish it and leave an open import behind.
 */
const CSV_IMPORT_SLOW_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Creates the import server-side from the raw file: the API parses and validates it and
 * creates one pending item per row. A bad file is a 422 `invalid_csv` with the problems
 * per line and column. Throws the AxiosError on any failure so the caller can show the
 * request and response.
 */
export async function startCollectionCsvImport(params: {
  userId: string;
  csvText: string;
  sourceFileName: string | null;
  testMode?: boolean;
}): Promise<ICollectionCsvImport> {
  const result = await apiPostOrThrow<{ data: CollectionCsvImportApiData }>(
    `/api/v1/users/${params.userId}/collection_csv_imports`,
    {
      data: {
        csv_text: params.csvText,
        source_file_name: params.sourceFileName,
        test_mode: params.testMode ?? false,
      },
    },
    { timeout: CSV_IMPORT_SLOW_REQUEST_TIMEOUT_MS },
  );
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

/**
 * Moves the import to the next row that needs a person, auto-applying rows with a GameDB
 * or IGDB id and single exact title matches on the way (up to 25 per call). The item is
 * null when the import is completed, and also when the cap was hit while it is still
 * active, in which case call it again.
 */
export async function advanceCollectionCsvImport(importId: number): Promise<ICsvImportReview> {
  const result = await apiPostOrThrow<{ data: CsvImportReviewApiData }>(
    `/api/v1/collection_csv_imports/${importId}/advance`,
    undefined,
    { timeout: CSV_IMPORT_SLOW_REQUEST_TIMEOUT_MS },
  );
  return mapCsvImportReview(result.data);
}

export async function applyCollectionCsvImportItem(
  itemId: number,
  target: { gameId: number } | { igdbId: number },
): Promise<ICollectionCsvImportItem> {
  const data = "gameId" in target ? { game_id: target.gameId } : { igdb_id: target.igdbId };
  const result = await apiPostOrThrow<{ data: CollectionCsvImportItemApiData }>(
    `/api/v1/collection_csv_import_items/${itemId}/apply`,
    { data },
  );
  return mapItem(result.data);
}

export async function skipCollectionCsvImportItem(
  itemId: number,
): Promise<ICollectionCsvImportItem> {
  const result = await apiPostOrThrow<{ data: CollectionCsvImportItemApiData }>(
    `/api/v1/collection_csv_import_items/${itemId}/skip`,
  );
  return mapItem(result.data);
}

/** Searches GameDB again under another title; nothing is applied. */
export async function remapCollectionCsvImportItem(
  itemId: number,
  title: string,
): Promise<ICsvImportReview> {
  const result = await apiPostOrThrow<{ data: CsvImportReviewApiData }>(
    `/api/v1/collection_csv_import_items/${itemId}/remap`,
    { data: { title } },
  );
  return mapCsvImportReview(result.data);
}

export async function getCsvImportIgdbCandidates(
  itemId: number,
  query?: string,
): Promise<ICsvImportIgdbCandidate[]> {
  const result = await apiGet<{ data: CsvImportIgdbCandidateApiData[] }>(
    `/api/v1/collection_csv_import_items/${itemId}/igdb_candidates`,
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

export async function getCollectionCsvImportItemById(
  itemId: number,
): Promise<ICollectionCsvImportItem | null> {
  const result = await apiGet<{ data: CollectionCsvImportItemApiData }>(
    `/api/v1/collection_csv_import_items/${itemId}`,
  );
  if (!result?.data) return null;
  return mapItem(result.data);
}

export async function getCollectionCsvImportCounts(importId: number): Promise<ICsvImportCounts> {
  const result = await apiGet<{ data: CollectionCsvImportSummaryApiData }>(
    `/api/v1/collection_csv_imports/${importId}/summary`,
  );
  return mapCounts(result?.data);
}

export function summarizeCsvImportCounts(counts: ICsvImportCounts): {
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
