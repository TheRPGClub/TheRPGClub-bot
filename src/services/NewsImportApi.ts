import type { NewsCategoryKey } from "../config/newsHub.js";
import type { INewsImportListItem } from "../functions/NewsImportFile.js";
import type { INewsItemPayload } from "../functions/NewsItem.js";
import type { INewsCopyLocation } from "./NewsItemApi.js";
import { apiGetOrThrow, apiPostOrThrow } from "./RpgClubApiClient.js";

// The News Import endpoints (spec api#355, api#359). The batch write is service-only; the
// rest are for Admins and Superadmins, named by `acting_user_id` (the API checks the
// member's stored roles and answers 403 for anyone else). The service token is not
// feature-gated: the bot's own gate keeps /news-import to Preview and Live.

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

/** The page size the bot lists unsorted items with (the API's maximum). */
export const NEWS_IMPORT_LIST_PER = 500;

/** The most rows one assignment request takes (the API answers 422 above it). */
export const NEWS_IMPORT_ASSIGN_MAX = 5000;

export interface INewsImportListPage {
  items: INewsImportListItem[];
  /** The next page number; null on the last page. */
  next: number | null;
}

export interface INewsImportAssignRow {
  messageId: string;
  /** A News Category key, or `skip`. Never blank: the API rejects a blank value. */
  value: string;
}

export interface INewsImportAssignRejection {
  /** The row's 0-based position in the request's rows. */
  index: number;
  messageId: string;
  value: string;
  reason: string;
}

/** An item whose category an assignment changed and that has a News Copy to move. */
export interface INewsImportMove {
  messageId: string;
  categoryKey: NewsCategoryKey;
  previousCategoryKey: NewsCategoryKey;
  /** Where the copy lives now, in the previous category's thread. */
  copy: INewsCopyLocation | null;
}

export interface INewsImportAssignResult {
  assigned: number;
  /** `skip` rows, including items an earlier `skip` already removed. */
  removed: number;
  rejected: number;
  /** Imported News Items still unsorted after the request. */
  unsorted: number;
  rejections: INewsImportAssignRejection[];
  /** Changed items with a News Copy, in row order (spec api#367). */
  moved: INewsImportMove[];
}

export interface INewsImportStatus {
  /** Imported News Items with a News Category (shown to members). */
  sorted: number;
  /** Imported News Items with no News Category yet (hidden). */
  unsorted: number;
  /** Archive messages staff removed with `skip`. */
  removed: number;
  /**
   * The oldest archive message imported so far, kept or removed with `skip`; null before
   * any. A re-run scan continues from just before it.
   */
  oldestMessageId: string | null;
}

type StatusPayload = {
  sorted: number;
  unsorted: number;
  removed: number;
  oldest_message_id: string | null;
};

/**
 * The bot's view of the News Import endpoints. Every method throws the AxiosError on a
 * non-2xx answer, so replies can show the full request and response.
 */
export interface INewsImportApi {
  /** POST /api/v1/news_import/items: at most NEWS_IMPORT_BATCH_MAX items. */
  recordBatch(items: readonly NewsImportBatchItem[]): Promise<INewsImportBatchResult>;
  /** GET /api/v1/news_import/status: 403 when the acting member is not staff. */
  status(actingUserId: string): Promise<INewsImportStatus>;
  /** GET /api/v1/news_import/items: one page of unsorted imported items, oldest first. */
  list(actingUserId: string, page: number, per: number): Promise<INewsImportListPage>;
  /** POST /api/v1/news_import/assignments: at most NEWS_IMPORT_ASSIGN_MAX rows. */
  assign(
    actingUserId: string,
    rows: readonly INewsImportAssignRow[],
  ): Promise<INewsImportAssignResult>;
}

const NEWS_IMPORT_PATH = "/api/v1/news_import";

type BatchResultPayload = {
  created: number;
  updated: number;
  previously_removed: number;
  rejected: { index: number; message_id: string | null; reason: string }[];
};

type AssignResultPayload = Omit<INewsImportAssignResult, "rejections" | "moved"> & {
  rejections: { index: number; message_id: string; value: string; reason: string }[];
  moved?: {
    message_id: string;
    category_key: NewsCategoryKey;
    previous_category_key: NewsCategoryKey;
    news_copy?: INewsCopyLocation | null;
  }[];
};

/**
 * A GET path naming the acting member. The query stays in the path because an error reply
 * shows the request's url, not its params.
 */
export function actingPath(
  path: string,
  actingUserId: string,
  params: Readonly<Record<string, string>> = {},
): string {
  const query = new URLSearchParams({ acting_user_id: actingUserId, ...params });
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
    const payload = await apiGetOrThrow<{ data: StatusPayload }>(
      actingPath("/status", actingUserId),
    );
    const status = payload.data;
    return {
      sorted: status.sorted,
      unsorted: status.unsorted,
      removed: status.removed,
      oldestMessageId: status.oldest_message_id ?? null,
    };
  },
  async list(actingUserId, page, per) {
    const payload = await apiGetOrThrow<{
      data: INewsImportListItem[];
      meta: { next?: number | null };
    }>(actingPath("/items", actingUserId, { page: String(page), per: String(per) }));
    return { items: payload.data, next: payload.meta.next ?? null };
  },
  async assign(actingUserId, rows) {
    const payload = await apiPostOrThrow<{ data: AssignResultPayload }>(
      `${NEWS_IMPORT_PATH}/assignments`,
      {
        data: {
          acting_user_id: actingUserId,
          rows: rows.map((row) => ({ message_id: row.messageId, value: row.value })),
        },
      },
    );
    const result = payload.data;
    return {
      assigned: result.assigned,
      removed: result.removed,
      rejected: result.rejected,
      unsorted: result.unsorted,
      rejections: result.rejections.map((row) => ({
        index: row.index,
        messageId: row.message_id,
        value: row.value,
        reason: row.reason,
      })),
      moved: (result.moved ?? []).map((move) => ({
        messageId: move.message_id,
        categoryKey: move.category_key,
        previousCategoryKey: move.previous_category_key,
        copy: move.news_copy ?? null,
      })),
    };
  },
};
