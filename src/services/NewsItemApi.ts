import type { NewsCategoryKey } from "../config/newsHub.js";
import type { INewsItemPayload } from "../functions/NewsItem.js";
import { apiDelete, apiPutOrThrow } from "./RpgClubApiClient.js";

// The service-only News Item writes (spec api#355, api#367): record, remove, and report
// where a News Item's News Copy lives.

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
