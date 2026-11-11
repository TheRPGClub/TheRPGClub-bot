import type { NewsCategoryKey } from "../config/newsHub.js";
import type { INewsItemPayload } from "../functions/NewsItem.js";
import { apiDelete, apiGetOrThrow, apiPutOrThrow } from "./RpgClubApiClient.js";

// The service-only News Item calls (spec api#355, api#367): record, remove, report where a
// News Item's News Copy lives, and list the News Items that have no News Copy yet.

const NEWS_ITEM_PATH = "/api/v1/news_items";

/**
 * The PUT body's `data`: the path carries the message ID. A missing `category_key` keeps the
 * stored category (an edit does not know a correction); a new live item needs one.
 * `picked_category_key`, the category the bot picked, is sent only when the bot picks.
 */
export type NewsItemRecordData = Omit<INewsItemPayload, "message_id" | "category_key"> & {
  category_key?: NewsCategoryKey;
  picked_category_key?: NewsCategoryKey | null;
};

export type NewsItemRecordBody = { data: NewsItemRecordData };

/** Where a News Copy lives: its message and the category thread it is in. */
export interface INewsCopyLocation {
  message_id: string;
  thread_id: string;
}

/** The News Item writes. All are idempotent by message ID. */
export interface INewsItemApi {
  /** Creates or replaces the News Item (fields sent are replaced, so send it whole). */
  record: (messageId: string, body: NewsItemRecordBody) => Promise<unknown>;
  /** Removes it; 204 whether or not it was recorded. */
  remove: (messageId: string) => Promise<unknown>;
}

/** The writes that file a News Item: recording it, and reporting its News Copy. */
export interface INewsFilingApi extends INewsItemApi {
  /**
   * Stores where the recorded News Item's News Copy lives (null: it has none), changing
   * nothing else. 404 when the message was never recorded.
   */
  reportCopy: (messageId: string, copy: INewsCopyLocation | null) => Promise<unknown>;
}

const newsItemPath = (messageId: string): string =>
  `${NEWS_ITEM_PATH}/${encodeURIComponent(messageId)}`;

export const NEWS_ITEM_API: INewsFilingApi = {
  record: (messageId, body) => apiPutOrThrow(newsItemPath(messageId), body),
  remove: (messageId) => apiDelete(newsItemPath(messageId)),
  reportCopy: (messageId, copy) =>
    apiPutOrThrow(newsItemPath(messageId), { data: { news_copy: copy } }),
};

/**
 * The PUT body for a News Item, for any caller that records one. A null category is left
 * out, so the stored one is kept (an imported item's, or a live item's picked one).
 */
export function newsItemRecordBody(item: INewsItemPayload): NewsItemRecordBody {
  const { message_id: _id, category_key: categoryKey, ...rest } = item;
  return { data: categoryKey === null ? rest : { ...rest, category_key: categoryKey } };
}

/**
 * A News Item with no News Copy, as the uncopied listing gives it: the parts of the API's
 * `NewsItem` a copy is built from. It always has a category (unsorted imports are left out).
 */
export interface IUncopiedNewsItem {
  message_id: string;
  category_key: NewsCategoryKey;
  /** `import`: brought in by the News Import, so its copy shows the original date. */
  origin: "live" | "import";
  comment: string | null;
  posted_at: string;
  link: { url: string } | null;
  author: { user_id: string };
}

/** One page of the uncopied listing. */
export interface IUncopiedNewsPage {
  items: IUncopiedNewsItem[];
  /** Every News Item without a News Copy, on this page or not. */
  count: number;
  /** The next page number; null on the last page. */
  next: number | null;
}

/** The API's largest page of the uncopied listing. */
export const UNCOPIED_PER_MAX = 500;

export interface INewsUncopiedApi {
  /**
   * GET /api/v1/news_items/uncopied: News Items with a category and no News Copy, oldest
   * first. A reported copy takes its item out, so a runner that copies as it goes reads
   * page 1 again rather than the next page.
   */
  uncopied: (page: number, per: number) => Promise<IUncopiedNewsPage>;
}

export const NEWS_UNCOPIED_API: INewsUncopiedApi = {
  async uncopied(page, per) {
    // The query stays in the path: an error reply shows the request's url, not its params.
    const query = new URLSearchParams({ page: String(page), per: String(per) });
    const payload = await apiGetOrThrow<{
      data: IUncopiedNewsItem[];
      meta: { count: number; next?: number | null };
    }>(`${NEWS_ITEM_PATH}/uncopied?${query.toString()}`);
    return { items: payload.data, count: payload.meta.count, next: payload.meta.next ?? null };
  },
};
