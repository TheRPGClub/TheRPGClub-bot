import type { INewsImportListItem } from "../functions/NewsImportFile.js";
import { apiGetOrThrow, apiPostOrThrow } from "./RpgClubApiClient.js";

// The News Import endpoints (spec api#355, api#359, api#367). They are for Admins and
// Superadmins, named by `acting_user_id` (the API checks the member's stored roles and
// answers 403 for anyone else). The service token is not feature-gated: the bot's own gate
// keeps /news-import to Preview and Live. The scan's batch write is gone with the scan.

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

export interface INewsImportAssignResult {
  assigned: number;
  /** `skip` rows, including items an earlier `skip` already removed. */
  removed: number;
  rejected: number;
  /** Imported News Items still unsorted after the request. */
  unsorted: number;
  rejections: INewsImportAssignRejection[];
}

export interface INewsImportStatus {
  /** Imported News Items with a News Category (shown to members). */
  sorted: number;
  /** Imported News Items with no News Category yet (hidden). */
  unsorted: number;
  /** Archive messages staff removed with `skip`. */
  removed: number;
  /** News Items, live and imported, that have a News Copy. */
  copied: number;
  /** News Items, live and imported, with a News Category and no News Copy yet. */
  uncopied: number;
}

/**
 * The bot's view of the News Import endpoints. Every method throws the AxiosError on a
 * non-2xx answer, so replies can show the full request and response.
 */
export interface INewsImportApi {
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

type AssignResultPayload = Omit<INewsImportAssignResult, "rejections"> & {
  rejections: { index: number; message_id: string; value: string; reason: string }[];
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
  async status(actingUserId) {
    const payload = await apiGetOrThrow<{ data: INewsImportStatus }>(
      actingPath("/status", actingUserId),
    );
    const status = payload.data;
    return {
      sorted: status.sorted,
      unsorted: status.unsorted,
      removed: status.removed,
      copied: status.copied,
      uncopied: status.uncopied,
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
    };
  },
};
