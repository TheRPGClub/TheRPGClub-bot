import { SnowflakeUtil } from "discord.js";
import type { NewsCategoryKey } from "../config/newsHub.js";
import type { INewsItemPayload } from "../functions/NewsItem.js";
import { apiDelete, apiGetOrThrow, apiPutOrThrow } from "./RpgClubApiClient.js";

// The service-only News Item writes (spec api#355, api#367): record, remove, and report
// where a News Item's News Copy lives; and finding a recorded News Item, so an edit or
// delete of its original can reach its News Copy.

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

/** What the bot reads back about a recorded News Item: the API's `NewsItem`, in part. */
export interface IRecordedNewsItem {
  message_id: string;
  origin: "live" | "import";
  posted_at: string;
  /** Where its News Copy lives; null while it has none. */
  news_copy: INewsCopyLocation | null;
}

/** The writes, plus finding a recorded News Item: what keeping News Copies in sync needs. */
export interface INewsSyncApi extends INewsFilingApi {
  /** The recorded News Item of this message, or null when none is found. */
  find: (messageId: string) => Promise<IRecordedNewsItem | null>;
}

/** The News Item in a record (PUT) response, or null when the response holds none. */
export function recordedNewsItemOf(response: unknown): IRecordedNewsItem | null {
  const data = (response as { data?: unknown } | null | undefined)?.data;
  if (!data || typeof data !== "object") return null;
  const item = data as Partial<IRecordedNewsItem>;
  if (typeof item.message_id !== "string") return null;
  return {
    message_id: item.message_id,
    origin: item.origin === "import" ? "import" : "live",
    posted_at: String(item.posted_at ?? ""),
    news_copy: item.news_copy ?? null,
  };
}

/** One page of the News Hub feed (`GET /api/v1/news_items`), newest first. */
export interface INewsFeedPage {
  data: IRecordedNewsItem[];
  meta: { page: number; pages: number };
}

/** Feed items per page the lookup reads: a delete is nearly always of a recent post. */
const FEED_LOOKUP_PER = 100;
/** How far a recorded `posted_at` may sit before its message's own time and still match. */
const POSTED_AT_SLACK_MS = 60_000;

/**
 * Finds the News Item of `messageId` in the feed, which lists every News Item with a
 * category newest first (the service token sees them all). The API has no read for one
 * News Item, so pages are read back from the newest until the message is found or the feed
 * is older than the message (its ID holds when it was posted). An unsorted import is never
 * in the feed; it has no News Copy either.
 */
export async function findInNewsFeed(
  messageId: string,
  readPage: (page: number, per: number) => Promise<INewsFeedPage>,
  per = FEED_LOOKUP_PER,
): Promise<IRecordedNewsItem | null> {
  const postedAt = SnowflakeUtil.timestampFrom(messageId) - POSTED_AT_SLACK_MS;
  for (let page = 1; ; page += 1) {
    const { data, meta } = await readPage(page, per);
    const found = data.find((item) => item.message_id === messageId);
    if (found) return found;
    const oldest = data.at(-1);
    if (!oldest || Date.parse(oldest.posted_at) < postedAt || page >= meta.pages) return null;
  }
}

const newsItemPath = (messageId: string): string =>
  `${NEWS_ITEM_PATH}/${encodeURIComponent(messageId)}`;

export const NEWS_ITEM_API: INewsSyncApi = {
  record: (messageId, body) => apiPutOrThrow(newsItemPath(messageId), body),
  remove: (messageId) => apiDelete(newsItemPath(messageId)),
  reportCopy: (messageId, copy) =>
    apiPutOrThrow(newsItemPath(messageId), { data: { news_copy: copy } }),
  find: (messageId) => findInNewsFeed(messageId, (page, per) =>
    apiGetOrThrow<INewsFeedPage>(NEWS_ITEM_PATH, { params: { page, per } })),
};

/**
 * The PUT body for a News Item, for any caller that records one. A null category is left
 * out, so the stored one is kept (an imported item's, or a live item's picked one).
 */
export function newsItemRecordBody(item: INewsItemPayload): NewsItemRecordBody {
  const { message_id: _id, category_key: categoryKey, ...rest } = item;
  return { data: categoryKey === null ? rest : { ...rest, category_key: categoryKey } };
}
