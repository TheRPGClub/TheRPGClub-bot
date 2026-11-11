import { SnowflakeUtil } from "discord.js";
import type { NewsCategoryKey } from "../config/newsHub.js";
import type { INewsItemPayload } from "../functions/NewsItem.js";
import { apiDelete, apiGetOrThrow, apiPutOrThrow } from "./RpgClubApiClient.js";

// The service-only News Item calls (spec api#355, api#367): record, remove, report where a
// News Item's News Copy lives, list the News Items that have no News Copy yet, and find a
// recorded News Item, so an edit the API refuses can be told apart from one never recorded.

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

/** What removing a News Item answers: whether it was recorded, and where its copy lived. */
export interface INewsItemRemoval {
  removed: boolean;
  /** The removed item's News Copy, for the caller to delete; null when it had none. */
  newsCopy: INewsCopyLocation | null;
}

/** The removal in a DELETE response; an empty answer removed nothing the bot can delete. */
export function newsItemRemovalOf(response: unknown): INewsItemRemoval {
  const data = (response as { data?: unknown } | null | undefined)?.data;
  if (!data || typeof data !== "object") return { removed: false, newsCopy: null };
  const removal = data as { removed?: unknown; news_copy?: INewsCopyLocation | null };
  return { removed: removal.removed === true, newsCopy: removal.news_copy ?? null };
}

/** The News Item writes. All are idempotent by message ID. */
export interface INewsItemApi {
  /** Creates or replaces the News Item (fields sent are replaced, so send it whole). */
  record: (messageId: string, body: NewsItemRecordBody) => Promise<unknown>;
  /** Removes it for good, whether or not it was recorded, saying where its copy lived. */
  remove: (messageId: string) => Promise<INewsItemRemoval>;
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

/** Feed items per page the lookup reads: an edit is nearly always of a recent post. */
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
  remove: async (messageId) => newsItemRemovalOf(await apiDelete(newsItemPath(messageId))),
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
