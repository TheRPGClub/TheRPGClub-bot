import { RESTJSONErrorCodes, SnowflakeUtil, type Client } from "discord.js";
import { GAME_NEWS_CHANNEL_ID } from "../config/channels.js";
import { NEWS_HUB_FEATURE_KEY } from "../config/featureGate.js";
import {
  NEWS_CATEGORY_THREADS,
  type NewsCategoryKey,
  type NewsPlaces,
} from "../config/newsHub.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { newsItemFrom, type INewsMessage } from "../functions/NewsItem.js";
import { buildAnyErrorMessage, buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import { FEATURE_ACCESS_API } from "./FeatureAccessService.js";
import { getFeatureState } from "./FeaturePostRouting.js";
import {
  NEWS_ITEM_API,
  newsItemRecordBody,
  type INewsItemApi,
} from "./NewsHubRecording.js";
import { apiGetOrThrow } from "./RpgClubApiClient.js";

// The News Hub's bot jobs (spec api#355, bot#1525): image renewal, and the catch-up scan
// that records what the category threads gained, lost or changed while the bot was not
// listening. Both post nothing.

const LOG_CONTEXT = "NewsHubJobs";

/** Messages re-checked at the end of each category thread on every catch-up. */
export const NEWS_CATCH_UP_RECENT_WINDOW = 50;

/** The narrow slice of Discord the jobs read. */
export interface INewsChannelReader {
  /** The message, or null when it or its channel no longer exists. */
  fetchMessage(channelId: string, messageId: string): Promise<INewsMessage | null>;
  /**
   * Up to `limit` messages (at most 100): the newest ones, or with `after` the ones right
   * after that message ID. In any order.
   */
  fetchMessages(
    channelId: string,
    options: { limit: number; after?: string },
  ): Promise<INewsMessage[]>;
}

/** What the catch-up reads of a recorded News Item. */
export interface IStoredNewsItem {
  message_id: string;
  origin: "live" | "import";
  posted_at: string;
}

export interface INewsFeedPage {
  items: IStoredNewsItem[];
  nextPage: number | null;
}

export interface INewsHubApi extends INewsItemApi {
  /** One page of a News Category's feed as the service token sees it, newest first. */
  listCategory(categoryKey: NewsCategoryKey, page: number, per: number): Promise<INewsFeedPage>;
}

export interface INewsHubJobDeps {
  /** The category threads, each with its News Category. */
  categoryThreads: NewsPlaces;
  /** The Game News Archive, whose imported items renewal also covers. */
  archiveChannelId: string;
  api: INewsHubApi;
  discord: INewsChannelReader;
  /** The News Hub's state read from the API now, past the flag cache (it may lag). */
  freshFeatureState: () => Promise<FeatureState | null>;
  /** How many of each thread's newest messages the catch-up re-checks. */
  recentWindow: number;
}

type NewsFeedResponse = {
  data: IStoredNewsItem[];
  meta: { next?: number | null };
};

export const NEWS_HUB_API: INewsHubApi = {
  ...NEWS_ITEM_API,
  listCategory: async (categoryKey, page, per) => {
    const query = new URLSearchParams({
      category: categoryKey,
      page: String(page),
      per: String(per),
    });
    const body = await apiGetOrThrow<NewsFeedResponse>(`/api/v1/news_items?${query}`);
    return { items: body.data, nextPage: body.meta.next ?? null };
  },
};

function isGone(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  return err.code === RESTJSONErrorCodes.UnknownMessage
    || err.code === RESTJSONErrorCodes.UnknownChannel;
}

async function textChannel(client: Client, channelId: string) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) {
    throw new Error(`Channel ${channelId} is missing or holds no messages.`);
  }
  return channel;
}

function discordReader(client: Client): INewsChannelReader {
  return {
    fetchMessage: async (channelId, messageId) => {
      try {
        const channel = await textChannel(client, channelId);
        return await channel.messages.fetch({ message: messageId, force: true });
      } catch (err: unknown) {
        if (isGone(err)) return null;
        throw err;
      }
    },
    fetchMessages: async (channelId, { limit, after }) => {
      const channel = await textChannel(client, channelId);
      const page = await channel.messages.fetch(
        after === undefined ? { limit, cache: false } : { limit, after, cache: false },
      );
      return [...page.values()];
    },
  };
}

/**
 * The News Hub's state from the API, not the flag cache: right after the Feature leaves
 * Off the cache can still say Off. Falls back to the cache when the read fails.
 */
async function readNewsHubState(client: Client): Promise<FeatureState | null> {
  const userId = client.user?.id;
  if (!userId) return getFeatureState(NEWS_HUB_FEATURE_KEY);
  try {
    const access = await FEATURE_ACCESS_API.fetchFeatureAccess(userId);
    const entry = access.features.find((feature) => feature.key === NEWS_HUB_FEATURE_KEY);
    return entry?.state ?? null;
  } catch (err: unknown) {
    const label = "Could not read the News Hub's state from the API; using the cached flags";
    logError(LOG_CONTEXT, buildApiErrorMessage(label, err));
    return getFeatureState(NEWS_HUB_FEATURE_KEY);
  }
}

export function createNewsHubJobDeps(client: Client): INewsHubJobDeps {
  return {
    categoryThreads: NEWS_CATEGORY_THREADS,
    archiveChannelId: GAME_NEWS_CHANNEL_ID,
    api: NEWS_HUB_API,
    discord: discordReader(client),
    freshFeatureState: () => readNewsHubState(client),
    recentWindow: NEWS_CATCH_UP_RECENT_WINDOW,
  };
}

/** Every place a News Item can be: the category threads and the Game News Archive. */
function newsPlaces(deps: INewsHubJobDeps): NewsPlaces {
  const places = new Map(deps.categoryThreads);
  if (deps.archiveChannelId !== "") places.set(deps.archiveChannelId, null);
  return places;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Fetches a News Item's message again and records it whole, which stores fresh image
 * addresses and expiry times; removes the News Item when the message is gone or no longer
 * qualifies. An imported item keeps its category (the API ignores `category_key` for it).
 * API and Discord errors are thrown as they are, for the job's error message.
 */
export async function renewNewsItem(
  messageId: string,
  channelId: string,
  deps: INewsHubJobDeps,
): Promise<string> {
  const places = newsPlaces(deps);
  if (!places.has(channelId)) {
    throw new Error(`Channel ${channelId} is neither a News Category thread nor the Game ` +
      `News Archive, so News Item ${messageId} was left as it is.`);
  }
  const message = await deps.discord.fetchMessage(channelId, messageId);
  if (!message) {
    await deps.api.remove(messageId);
    return `Removed News Item ${messageId}: its message no longer exists.`;
  }
  const item = newsItemFrom(message, places);
  if (!item) {
    await deps.api.remove(messageId);
    return `Removed News Item ${messageId}: its message no longer has a link or an image.`;
  }
  await deps.api.record(messageId, newsItemRecordBody(item));
  return `Recorded News Item ${messageId} again with fresh addresses for ` +
    `${plural(item.images.length, "image")}.`;
}

/** Discord's page size for message history. */
const DISCORD_PAGE = 100;
/** Feed page size when the catch-up reads what a News Category has recorded. */
const FEED_PAGE = 100;

/** What one catch-up did, summed over the category threads. */
export type NewsCatchUpOutcome =
  | { status: "off" }
  | {
    status: "done";
    threads: number;
    /** Messages recorded that had no News Item (posted while the bot was not listening). */
    added: number;
    /** Recent News Items recorded again as their messages are now (edits applied). */
    rechecked: number;
    /** Recent News Items whose message was deleted or no longer qualifies. */
    removed: number;
    /** One message per thread that could not be caught up, with the full request. */
    failures: string[];
  };

type ThreadCounts = { added: number; rechecked: number; removed: number };

const isBefore = (id: string, other: string): boolean => BigInt(id) < BigInt(other);

function oldestId(messages: readonly INewsMessage[]): string {
  return messages.reduce((oldest, m) => (isBefore(m.id, oldest) ? m.id : oldest), messages[0].id);
}

/**
 * The thread's recorded live News Items from `floorId` on, and the newest one it recorded
 * (null when none). Imported items sorted into the category share its feed and are left
 * out: they live in the Game News Archive. The feed is newest first, so reading stops
 * once it is past the floor, unless the newest live item is still wanted.
 */
async function readRecorded(
  categoryKey: NewsCategoryKey,
  floorId: string,
  wantNewest: boolean,
  api: INewsHubApi,
): Promise<{ newestId: string | null; recent: Set<string> }> {
  const floorTime = SnowflakeUtil.timestampFrom(floorId);
  const recent = new Set<string>();
  let newestId: string | null = null;
  let page: number | null = 1;
  while (page !== null) {
    const feed: INewsFeedPage = await api.listCategory(categoryKey, page, FEED_PAGE);
    let pastFloor = false;
    for (const item of feed.items) {
      if (Date.parse(item.posted_at) < floorTime) pastFloor = true;
      if (item.origin !== "live") continue;
      newestId ??= item.message_id;
      if (isBefore(item.message_id, floorId)) pastFloor = true;
      else recent.add(item.message_id);
    }
    if (pastFloor && (newestId !== null || !wantNewest)) break;
    page = feed.nextPage;
  }
  return { newestId, recent };
}

/** The messages after `fromId` and before `floorId`, paged forward. */
async function fetchMissed(
  threadId: string,
  fromId: string,
  floorId: string,
  discord: INewsChannelReader,
): Promise<INewsMessage[]> {
  const missed: INewsMessage[] = [];
  let cursor = fromId;
  for (;;) {
    const page = await discord.fetchMessages(threadId, { limit: DISCORD_PAGE, after: cursor });
    let next = cursor;
    for (const m of page) {
      if (isBefore(m.id, floorId)) missed.push(m);
      if (isBefore(next, m.id)) next = m.id;
    }
    if (page.length < DISCORD_PAGE || next === cursor || !isBefore(next, floorId)) break;
    cursor = next;
  }
  return missed;
}

/**
 * One category thread: its newest `recentWindow` messages are re-checked (recorded as they
 * are now; a recorded one that is gone or no longer qualifies is removed), and the messages
 * between the newest recorded News Item and that window are recorded. A thread shorter
 * than the window is checked whole. Every write is idempotent by message ID.
 */
async function catchUpThread(
  threadId: string,
  categoryKey: NewsCategoryKey,
  deps: INewsHubJobDeps,
): Promise<ThreadCounts> {
  const window = await deps.discord.fetchMessages(threadId, { limit: deps.recentWindow });
  const windowFull = window.length >= deps.recentWindow;
  // Every message in a thread comes after the thread's own ID.
  const floorId = windowFull ? oldestId(window) : threadId;
  const recorded = await readRecorded(categoryKey, floorId, windowFull, deps.api);
  const fromId = recorded.newestId ?? threadId;
  const missed = windowFull && isBefore(fromId, floorId)
    ? await fetchMissed(threadId, fromId, floorId, deps.discord)
    : [];

  const counts: ThreadCounts = { added: 0, rechecked: 0, removed: 0 };
  const qualifying = new Set<string>();
  const messages = [...missed, ...window].sort((a, b) => (isBefore(a.id, b.id) ? -1 : 1));
  for (const message of messages) {
    const item = newsItemFrom(message, deps.categoryThreads);
    if (!item) continue;
    await deps.api.record(item.message_id, newsItemRecordBody(item));
    qualifying.add(item.message_id);
    if (recorded.recent.has(item.message_id)) counts.rechecked += 1;
    else counts.added += 1;
  }
  for (const messageId of recorded.recent) {
    if (qualifying.has(messageId)) continue;
    await deps.api.remove(messageId);
    counts.removed += 1;
  }
  return counts;
}

/**
 * The catch-up scan (on startup, and when the News Hub leaves Off): each category thread
 * in turn. Does nothing while the News Hub is Off, read from the API (the flag cache can
 * lag behind the change that queued the job). A thread that fails is reported and the
 * others go on; running it again is safe.
 */
export async function runNewsCatchUp(deps: INewsHubJobDeps): Promise<NewsCatchUpOutcome> {
  if ((await deps.freshFeatureState()) === "off") return { status: "off" };
  const outcome = {
    status: "done" as const,
    threads: 0,
    added: 0,
    rechecked: 0,
    removed: 0,
    failures: [] as string[],
  };
  for (const [threadId, categoryKey] of deps.categoryThreads) {
    if (!categoryKey) continue;
    try {
      const counts = await catchUpThread(threadId, categoryKey, deps);
      outcome.threads += 1;
      outcome.added += counts.added;
      outcome.rechecked += counts.rechecked;
      outcome.removed += counts.removed;
    } catch (err: unknown) {
      const label = `Could not catch up the ${categoryKey} thread ${threadId}`;
      outcome.failures.push(buildAnyErrorMessage(label, err, { devPing: false }));
    }
  }
  return outcome;
}

/** The catch-up's outcome in plain words, for the job's result and the log. */
export function newsCatchUpSummary(outcome: NewsCatchUpOutcome): string {
  if (outcome.status === "off") return "Nothing caught up: the News Hub is Off.";
  const failed = outcome.failures.length > 0
    ? ` ${plural(outcome.failures.length, "thread")} could not be read.`
    : "";
  return `Caught up ${plural(outcome.threads, "News Category thread")}: ` +
    `${outcome.added} missed News Items recorded, ${outcome.rechecked} recent ones ` +
    `re-checked, ${outcome.removed} removed.${failed}`;
}

/** Startup: runs the catch-up in the background and logs what it did. */
export function startNewsCatchUp(client: Client): void {
  void runNewsCatchUp(createNewsHubJobDeps(client)).then((outcome) => {
    logInfo(LOG_CONTEXT, newsCatchUpSummary(outcome));
    if (outcome.status === "done") {
      for (const failure of outcome.failures) logError(LOG_CONTEXT, failure);
    }
  }, (err: unknown) => {
    logError(LOG_CONTEXT, buildAnyErrorMessage("The News Hub catch-up failed", err));
  });
}
