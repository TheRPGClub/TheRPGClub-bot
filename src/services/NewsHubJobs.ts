import { RESTJSONErrorCodes, SnowflakeUtil, type Client } from "discord.js";
import { GAME_NEWS_CHANNEL_ID } from "../config/channels.js";
import { NEWS_HUB_FEATURE_KEY } from "../config/featureGate.js";
import type { NewsPlaces } from "../config/newsHub.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { newsItemFrom } from "../functions/NewsItem.js";
import { buildAnyErrorMessage, buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import { FEATURE_ACCESS_API } from "./FeatureAccessService.js";
import { getFeatureState } from "./FeaturePostRouting.js";
import { newsCopySourceOf, postNewsCopy, type INewsPost } from "./NewsCopying.js";
import { HISTORY_COPY_INTERVAL_MS, newsCopiesPaused } from "./NewsHistoryCopy.js";
import {
  createNewsRecordingDeps,
  fileNewsMessage,
  type INewsRecordingDeps,
} from "./NewsHubRecording.js";
import {
  NEWS_ITEM_API,
  NEWS_UNCOPIED_API,
  newsItemRecordBody,
  type INewsFilingApi,
  type INewsUncopiedApi,
  type IUncopiedNewsItem,
} from "./NewsItemApi.js";
import { apiGetOrThrow } from "./RpgClubApiClient.js";

// The News Hub's bot jobs (spec api#355, api#367): image renewal, and the catch-up that
// files the News Channel posts the bot missed and posts the News Copies still missing.

const LOG_CONTEXT = "NewsHubJobs";

/** The narrow slice of Discord the jobs read. */
export interface INewsChannelReader {
  /** The message, or null when it or its channel no longer exists. */
  fetchMessage(channelId: string, messageId: string): Promise<INewsPost | null>;
  /**
   * Up to `limit` messages (at most 100): the newest ones, or with `after` the ones right
   * after that message ID. In any order.
   */
  fetchMessages(
    channelId: string,
    options: { limit: number; after?: string },
  ): Promise<INewsPost[]>;
}

/** What the jobs read of a recorded News Item. */
export interface IStoredNewsItem {
  message_id: string;
  origin: "live" | "import";
  posted_at: string;
}

export interface INewsPage<T> {
  items: T[];
  nextPage: number | null;
}

/** The News Item calls the jobs make, with the uncopied listing the history copy uses. */
export interface INewsHubApi extends INewsFilingApi, INewsUncopiedApi {
  /** One page of every sorted News Item, as the service token sees it, newest first. */
  listRecent(page: number, per: number): Promise<INewsPage<IStoredNewsItem>>;
}

export interface INewsHubJobDeps {
  /** Category threads whose old News Items renewal still covers (none since bot#1537). */
  categoryThreads: NewsPlaces;
  /** The News Channel: renewal covers its items, and the catch-up reads it. */
  archiveChannelId: string;
  api: INewsHubApi;
  discord: INewsChannelReader;
  /** The News Hub's state read from the API now, past the flag cache (it may lag). */
  freshFeatureState: () => Promise<FeatureState | null>;
  /** How the catch-up files a missed post: as live recording does, minus the preview wait. */
  recording: INewsRecordingDeps;
  /** True while a history copy runs: the catch-up posts no News Copies then. */
  copiesPaused: () => boolean;
  /**
   * When live filing took over (ms): the bot came back, or the News Hub left Off. Posts from
   * then on are the live listener's, so the catch-up leaves them alone.
   */
  liveSince: () => number;
  /** Waits after each News Copy the catch-up posts, so a long backlog goes at a steady pace. */
  pace: () => Promise<void>;
}

type NewsPageResponse<T> = {
  data: T[];
  meta: { next?: number | null };
};

async function readPage<T>(path: string, page: number, per: number): Promise<INewsPage<T>> {
  const query = new URLSearchParams({ page: String(page), per: String(per) });
  const body = await apiGetOrThrow<NewsPageResponse<T>>(`${path}?${query}`);
  return { items: body.data, nextPage: body.meta.next ?? null };
}

export const NEWS_HUB_API: INewsHubApi = {
  ...NEWS_ITEM_API,
  ...NEWS_UNCOPIED_API,
  listRecent: (page, per) => readPage("/api/v1/news_items", page, per),
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

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The jobs' real dependencies. `liveSince` defaults to the moment the catch-up runs (the
 * job after the News Hub left Off); startup passes when the bot came back. Copies pause
 * while the history copy (bot#1539) runs, and go at its pace otherwise.
 */
export function createNewsHubJobDeps(
  client: Client,
  options: { liveSince?: () => number; copiesPaused?: () => boolean } = {},
): INewsHubJobDeps {
  return {
    // None: the category threads hold only News Copies since bot#1537.
    categoryThreads: new Map(),
    archiveChannelId: GAME_NEWS_CHANNEL_ID,
    api: NEWS_HUB_API,
    discord: discordReader(client),
    freshFeatureState: () => readNewsHubState(client),
    recording: createNewsRecordingDeps(client),
    copiesPaused: options.copiesPaused ?? newsCopiesPaused,
    liveSince: options.liveSince ?? (() => Date.now()),
    pace: () => wait(HISTORY_COPY_INTERVAL_MS),
  };
}

/** Every place a News Item can be: the category threads and the News Channel. */
function newsPlaces(deps: INewsHubJobDeps): NewsPlaces {
  const places = new Map(deps.categoryThreads);
  if (deps.archiveChannelId !== "") places.set(deps.archiveChannelId, null);
  return places;
}

function plural(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
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
/** Page size when the catch-up reads recorded News Items. */
const API_PAGE = 100;

/** What one catch-up did. */
export type NewsCatchUpOutcome =
  | { status: "off" }
  | {
    status: "done";
    /** Missed News Channel posts recorded (and reacted to). */
    recorded: number;
    /** Missed posts the API would not record (each logged with its request). */
    unrecorded: number;
    /** News Copies posted and reported. */
    copied: number;
    /** Copies that could not be posted or reported (each logged); the next catch-up retries. */
    uncopied: number;
    /** Items whose message is gone from the News Channel or is no longer news. */
    skipped: number;
    /** True when a history copy was running, so copies were left to it. */
    paused: boolean;
    /** A step that could not run at all, with the full request. */
    failures: string[];
  };

type CatchUpCounts = Omit<Extract<NewsCatchUpOutcome, { status: "done" }>, "status">;

const isBefore = (id: string, other: string): boolean => BigInt(id) < BigInt(other);

/**
 * The newest News Item recorded before `ceiling` (ms), or null when none is. Items the live
 * listener recorded since it took over are passed over, so they do not hide what it missed.
 */
async function newestRecordedBefore(ceiling: number, api: INewsHubApi): Promise<string | null> {
  let page: number | null = 1;
  while (page !== null) {
    const feed: INewsPage<IStoredNewsItem> = await api.listRecent(page, API_PAGE);
    const older = feed.items.find((item) => Date.parse(item.posted_at) < ceiling);
    if (older) return older.message_id;
    page = feed.nextPage;
  }
  return null;
}

/**
 * Files every News Channel post after the newest recorded News Item and before live filing
 * took over: picked, recorded and reacted to as a live post, without waiting for a link
 * preview (an old message has its preview). Copies come after, oldest first. With nothing
 * recorded yet there is nothing to go from, and the channel's history is not filed live.
 */
async function recordMissed(
  deps: INewsHubJobDeps,
  ceiling: number,
  counts: CatchUpCounts,
): Promise<void> {
  const fromId = await newestRecordedBefore(ceiling, deps.api);
  if (fromId === null) return;
  const ceilingId = SnowflakeUtil.generate({ timestamp: ceiling }).toString();
  const recording: INewsRecordingDeps = {
    ...deps.recording,
    waitForPreview: async (message) => message,
  };
  let cursor = fromId;
  for (;;) {
    const page = await deps.discord.fetchMessages(deps.archiveChannelId, {
      limit: DISCORD_PAGE,
      after: cursor,
    });
    const ascending = [...page].sort((a, b) => (isBefore(a.id, b.id) ? -1 : 1));
    for (const message of ascending) {
      if (!isBefore(message.id, ceilingId)) return;
      if (recording.filing.has(message.id)) continue;
      const filed = await fileNewsMessage(message, recording, { postCopy: false });
      if (filed?.recorded) counts.recorded += 1;
      else if (filed) counts.unrecorded += 1;
    }
    const last = ascending.at(-1);
    if (page.length < DISCORD_PAGE || !last) return;
    cursor = last.id;
  }
}

type CopyResult = "copied" | "uncopied" | "skipped";

/** Posts the News Copy of one item from its message, fetched now so image addresses work. */
async function copyItem(item: IUncopiedNewsItem, deps: INewsHubJobDeps): Promise<CopyResult> {
  const message = await deps.discord.fetchMessage(deps.archiveChannelId, item.message_id);
  if (!message) return "skipped";
  const current = newsItemFrom(message, deps.recording.places);
  if (!current) return "skipped";
  const postedAt = item.origin === "import" ? new Date(item.posted_at) : null;
  const source = newsCopySourceOf(message, current, postedAt);
  const copy = await postNewsCopy(item.message_id, item.category_key, source, deps.recording);
  return copy ? "copied" : "uncopied";
}

/**
 * Posts the News Copies still missing, oldest first, from the API's listing of items without
 * one: it retries copies that failed earlier and copies the posts {@link recordMissed} filed.
 * Each item is tried once per catch-up. Stops when a history copy starts, and leaves items
 * from when live filing took over, and any being filed now, to the live listener.
 *
 * Copied items leave the listing, so the same page is read again; a page left with only
 * items already tried moves the reading on to the next.
 */
async function copyMissing(
  deps: INewsHubJobDeps,
  ceiling: number,
  counts: CatchUpCounts,
): Promise<void> {
  const tried = new Set<string>();
  let page: number | null = 1;
  while (page !== null) {
    const listing = await deps.api.uncopied(page, API_PAGE);
    const fresh = listing.items.filter((item) => !tried.has(item.message_id));
    if (fresh.length === 0) {
      page = listing.next;
      continue;
    }
    for (const item of fresh) {
      if (Date.parse(item.posted_at) >= ceiling) return;
      if (deps.copiesPaused()) {
        counts.paused = true;
        return;
      }
      tried.add(item.message_id);
      if (deps.recording.filing.has(item.message_id)) continue;
      const result = await copyItem(item, deps);
      counts[result] += 1;
      if (result !== "skipped") await deps.pace();
    }
  }
}

async function step(
  label: string,
  counts: CatchUpCounts,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (err: unknown) {
    counts.failures.push(buildAnyErrorMessage(label, err, { devPing: false }));
  }
}

/**
 * The catch-up (on startup, and when the News Hub leaves Off): files the News Channel posts
 * missed while the bot was not listening, then posts the News Copies still missing, oldest
 * first, unless a history copy is running. Does nothing while the News Hub is Off, read from
 * the API (the flag cache can lag behind the change that queued the job). A step that fails
 * is reported and the next still runs; running it again is safe.
 */
export async function runNewsCatchUp(deps: INewsHubJobDeps): Promise<NewsCatchUpOutcome> {
  if ((await deps.freshFeatureState()) === "off") return { status: "off" };
  const counts: CatchUpCounts = {
    recorded: 0,
    unrecorded: 0,
    copied: 0,
    uncopied: 0,
    skipped: 0,
    paused: false,
    failures: [],
  };
  if (deps.archiveChannelId === "") return { status: "done", ...counts };
  const ceiling = deps.liveSince();
  await step(
    `Could not record the posts missed in the News Channel ${deps.archiveChannelId}`,
    counts,
    () => recordMissed(deps, ceiling, counts),
  );
  if (deps.copiesPaused()) {
    counts.paused = true;
  } else {
    await step("Could not post the missing News Copies", counts, () =>
      copyMissing(deps, ceiling, counts));
  }
  return { status: "done", ...counts };
}

/** The catch-up's outcome in plain words, for the job's result and the log. */
export function newsCatchUpSummary(outcome: NewsCatchUpOutcome): string {
  if (outcome.status === "off") return "Nothing caught up: the News Hub is Off.";
  const unrecorded = outcome.unrecorded > 0 ? ` (${outcome.unrecorded} could not be)` : "";
  const uncopied = outcome.uncopied > 0
    ? `, ${outcome.uncopied} could not be and wait for the next catch-up`
    : "";
  const skipped = outcome.skipped > 0
    ? ` ${outcome.skipped} skipped: their message is gone from the News Channel or no ` +
      "longer news."
    : "";
  const paused = outcome.paused
    ? " Copies wait: a history copy is running and copies them after the history."
    : "";
  const failed = outcome.failures.length > 0
    ? ` ${plural(outcome.failures.length, "step")} could not run.`
    : "";
  return `Caught up the News Channel: ${outcome.recorded} missed News Items recorded` +
    `${unrecorded}, ${plural(outcome.copied, "News Copy", "News Copies")} posted` +
    `${uncopied}.${skipped}${paused}${failed}`;
}

/**
 * Startup: runs the catch-up in the background and logs what it did. Posts since the bot
 * came back are the live listener's.
 */
export function startNewsCatchUp(client: Client): void {
  const liveSince = (): number => client.readyTimestamp ?? Date.now();
  void runNewsCatchUp(createNewsHubJobDeps(client, { liveSince })).then((outcome) => {
    logInfo(LOG_CONTEXT, newsCatchUpSummary(outcome));
    if (outcome.status === "done") {
      for (const failure of outcome.failures) logError(LOG_CONTEXT, failure);
    }
  }, (err: unknown) => {
    logError(LOG_CONTEXT, buildAnyErrorMessage("The News Hub catch-up failed", err));
  });
}
