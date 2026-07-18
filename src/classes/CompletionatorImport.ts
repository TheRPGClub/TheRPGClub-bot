import { apiGet, apiPatch, apiPost } from "../services/RpgClubApiClient.js";

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

type CompletionatorImportApiData = {
  import_id: number;
  user_id: string;
  status: string;
  current_index: number;
  total_count: number;
  source_filename: string | null;
  created_at: string;
  updated_at: string;
};

type CompletionatorItemApiData = {
  item_id: number;
  import_id: number;
  row_index: number;
  game_title: string | null;
  platform_name: string | null;
  region_name: string | null;
  source_type: string | null;
  time_text: string | null;
  completed_at: string | null;
  completion_type: string | null;
  playtime_hrs: number | null;
  status: string;
  gamedb_game_id: number | null;
  completion_id: number | null;
  error_text: string | null;
};

type CompletionatorImportSummaryApiData = {
  import_id: number;
  by_status: Record<string, number>;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapImport(row: CompletionatorImportApiData): ICompletionatorImport {
  return {
    importId: Number(row.import_id),
    userId: row.user_id,
    status: row.status.toUpperCase() as ImportStatus,
    currentIndex: Number(row.current_index ?? 0),
    totalCount: Number(row.total_count ?? 0),
    sourceFilename: row.source_filename ?? null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapItem(row: CompletionatorItemApiData): ICompletionatorItem {
  return {
    itemId: Number(row.item_id),
    importId: Number(row.import_id),
    rowIndex: Number(row.row_index),
    gameTitle: row.game_title ?? "",
    platformName: row.platform_name ?? null,
    regionName: row.region_name ?? null,
    sourceType: row.source_type ?? null,
    timeText: row.time_text ?? null,
    completedAt: row.completed_at ? toDate(row.completed_at) : null,
    completionType: row.completion_type ?? null,
    playtimeHours: row.playtime_hrs == null ? null : Number(row.playtime_hrs),
    status: row.status.toUpperCase() as ImportItemStatus,
    gameDbGameId: row.gamedb_game_id == null ? null : Number(row.gamedb_game_id),
    completionId: row.completion_id == null ? null : Number(row.completion_id),
    errorText: row.error_text ?? null,
  };
}

export async function createImportSession(params: {
  userId: string;
  sourceFilename: string | null;
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
  }>;
}): Promise<ICompletionatorImport> {
  const result = await apiPost<{ data: CompletionatorImportApiData }>(
    `/api/v1/users/${params.userId}/completionator_imports`,
    {
      data: {
        source_filename: params.sourceFilename,
        items: params.items.map((item) => ({
          row_index: item.rowIndex,
          game_title: item.gameTitle,
          platform_name: item.platformName,
          region_name: item.regionName,
          source_type: item.sourceType,
          time_text: item.timeText,
          completed_at: item.completedAt,
          completion_type: item.completionType,
          playtime_hrs: item.playtimeHours,
        })),
      },
    },
  );
  if (!result?.data) throw new Error("Failed to create Completionator import session.");
  return mapImport(result.data);
}

export async function getImportById(importId: number): Promise<ICompletionatorImport | null> {
  const result = await apiGet<{ data: CompletionatorImportApiData }>(
    `/api/v1/completionator_imports/${importId}`,
  );
  if (!result?.data) return null;
  return mapImport(result.data);
}

export async function getActiveImportForUser(
  userId: string,
): Promise<ICompletionatorImport | null> {
  const result = await apiGet<{ data: CompletionatorImportApiData }>(
    `/api/v1/users/${userId}/completionator_imports/active`,
  );
  if (!result?.data) return null;
  return mapImport(result.data);
}

export async function setImportStatus(importId: number, status: ImportStatus): Promise<void> {
  await apiPatch(`/api/v1/completionator_imports/${importId}`, {
    data: { status: status.toLowerCase() },
  });
}

export async function updateImportIndex(importId: number, currentIndex: number): Promise<void> {
  await apiPatch(`/api/v1/completionator_imports/${importId}`, {
    data: { current_index: currentIndex },
  });
}

export async function getNextPendingItem(importId: number): Promise<ICompletionatorItem | null> {
  const result = await apiGet<{ data: CompletionatorItemApiData | null }>(
    `/api/v1/completionator_imports/${importId}/items/next_pending`,
  );
  if (!result?.data) return null;
  return mapItem(result.data);
}

export async function getImportItemById(itemId: number): Promise<ICompletionatorItem | null> {
  const result = await apiGet<{ data: CompletionatorItemApiData }>(
    `/api/v1/completionator_import_items/${itemId}`,
  );
  if (!result?.data) return null;
  return mapItem(result.data);
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
  const data: Record<string, unknown> = {};

  if (updates.status !== undefined) data.status = updates.status.toLowerCase();
  if (updates.gameDbGameId !== undefined) data.gamedb_game_id = updates.gameDbGameId;
  if (updates.completionId !== undefined) data.completion_id = updates.completionId;
  if (updates.errorText !== undefined) data.error_text = updates.errorText;

  if (!Object.keys(data).length) return;

  await apiPatch(`/api/v1/completionator_import_items/${itemId}`, { data });
}

export async function countImportItems(importId: number): Promise<{
  pending: number;
  skipped: number;
  imported: number;
  updated: number;
  error: number;
}> {
  const result = await apiGet<{ data: CompletionatorImportSummaryApiData }>(
    `/api/v1/completionator_imports/${importId}/summary`,
  );
  const byStatus = result?.data?.by_status ?? {};
  return {
    pending: Number(byStatus.pending ?? 0),
    skipped: Number(byStatus.skipped ?? 0),
    imported: Number(byStatus.imported ?? 0),
    updated: Number(byStatus.updated ?? 0),
    error: Number(byStatus.error ?? 0),
  };
}
