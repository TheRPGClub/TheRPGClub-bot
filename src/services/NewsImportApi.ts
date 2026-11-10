import type { INewsItemPayload } from "../functions/NewsItem.js";
import { apiGetOrThrow, apiPostOrThrow } from "./RpgClubApiClient.js";

// The News Import endpoints (spec api#355, api#359). The batch write is service-only; the
// rest are for Admins and Superadmins, named by `acting_user_id` (the API checks the
// member's stored roles and answers 403 for anyone else, in every Feature state).

/** The most archive messages one batch write takes (the API answers 422 above it). */
export const NEWS_IMPORT_BATCH_MAX = 100;

/** One archive message as the batch takes it: a News Item's fields with no category. */
export type NewsImportBatchItem = Omit<INewsItemPayload, "category_key">;

export interface INewsImportBatchRejection {
  index: number;
  messageId: string | null;
  reason: string;
}

export interface INewsImportBatchResult {
  /** New imported News Items. */
  created: number;
  /** Already imported, updated in place (an assigned News Category is kept). */
  updated: number;
  /** Messages staff removed with `skip`, left out for good. */
  previouslyRemoved: number;
  rejected: INewsImportBatchRejection[];
}

export interface INewsImportStatus {
  /** Imported News Items with a News Category (shown to members). */
  sorted: number;
  /** Imported News Items with no News Category yet (hidden). */
  unsorted: number;
  /** Archive messages staff removed with `skip`. */
  removed: number;
}

/**
 * The bot's view of the News Import endpoints. bot#1527 adds the list and assignment calls
 * here. Every method throws the AxiosError on a non-2xx answer, so replies can show the
 * full request and response.
 */
export interface INewsImportApi {
  /** POST /api/v1/news_import/items: at most NEWS_IMPORT_BATCH_MAX items. */
  recordBatch(items: readonly NewsImportBatchItem[]): Promise<INewsImportBatchResult>;
  /** GET /api/v1/news_import/status: 403 when the acting member is not staff. */
  status(actingUserId: string): Promise<INewsImportStatus>;
}

const NEWS_IMPORT_PATH = "/api/v1/news_import";

type BatchResultPayload = {
  created: number;
  updated: number;
  previously_removed: number;
  rejected: { index: number; message_id: string | null; reason: string }[];
};

/**
 * A GET path naming the acting member. The query stays in the path because an error reply
 * shows the request's url, not its params.
 */
export function actingPath(path: string, actingUserId: string): string {
  const query = new URLSearchParams({ acting_user_id: actingUserId });
  return `${NEWS_IMPORT_PATH}${path}?${query.toString()}`;
}

export const NEWS_IMPORT_API: INewsImportApi = {
  async recordBatch(items) {
    const payload = await apiPostOrThrow<{ data: BatchResultPayload }>(
      `${NEWS_IMPORT_PATH}/items`,
      { data: { items } },
    );
    const result = payload.data;
    return {
      created: result.created,
      updated: result.updated,
      previouslyRemoved: result.previously_removed,
      rejected: result.rejected.map((row) => ({
        index: row.index,
        messageId: row.message_id,
        reason: row.reason,
      })),
    };
  },
  async status(actingUserId) {
    const payload = await apiGetOrThrow<{ data: INewsImportStatus }>(
      actingPath("/status", actingUserId),
    );
    return payload.data;
  },
};
