import { SnowflakeUtil, type Client } from "discord.js";
import { GAME_NEWS_CHANNEL_ID } from "../config/channels.js";
import { NEWS_HUB_FEATURE_KEY } from "../config/featureGate.js";
import type { NewsPlaces } from "../config/newsHub.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { postedNewsItemFrom } from "../functions/NewsItem.js";
import { buildAnyErrorMessage, buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import { plural } from "../utilities/TextUtils.js";
import { FEATURE_ACCESS_API } from "./FeatureAccessService.js";
import { getFeatureState } from "./FeaturePostRouting.js";
import {
  fetchNewsChannel,
  newsCopySourceOf,
  postNewsCopy,
  type INewsPost,
} from "./NewsCopying.js";
import { deleteNewsCopy, isGone } from "./NewsCopySync.js";
import {
  NEWS_COPY_LANE,
  type INewsCopyLaneHold,
  type NewsCopyLane,
} from "./NewsCopyLane.js";
import { HISTORY_COPY_INTERVAL_MS } from "./NewsHistoryCopy.js";
import {
  createNewsRecordingDeps,
  fileNewsMessage,
  type INewsRecordingDeps,
} from "./NewsHubRecording.js";
import {
  NEWS_ITEM_API,
  NEWS_LIST_PER,
  NEWS_UNCOPIED_API,
  newsItemRecordBody,
  type INewsSyncApi,
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
export interface INewsHubApi extends INewsSyncApi, INewsUncopiedApi {
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
  /**
   * The copy lane: one catch-up at a time, and its copy phase holds the lane, so it posts no
   * copies while a history copy runs and stops for one that starts.
   */
  lane: NewsCopyLane;
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

function discordReader(client: Client): INewsChannelReader {
  return {
    fetchMessage: async (channelId, messageId) => {
      try {
        const channel = await fetchNewsChannel(client, channelId);
        return await channel.messages.fetch({ message: messageId, force: true });
      } catch (err: unknown) {
        if (isGone(err)) return null;
        throw err;
      }
    },
    fetchMessages: async (channelId, { limit, after }) => {
      const channel = await fetchNewsChannel(client, channelId);
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
 * job after the News Hub left Off); startup passes when the bot came back. Copies go at the
 * history copy's pace, in the bot's one copy lane.
 */
export function createNewsHubJobDeps(
  client: Client,
  options: { liveSince?: () => number } = {},
): INewsHubJobDeps {
  return {
    // None: the category threads hold only News Copies since bot#1537.
    categoryThreads: new Map(),
    archiveChannelId: GAME_NEWS_CHANNEL_ID,
    api: NEWS_HUB_API,
    discord: discordReader(client),
    freshFeatureState: () => readNewsHubState(client),
    recording: createNewsRecordingDeps(client),
    lane: NEWS_COPY_LANE,
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

/** Removes a News Item renewal found gone, and deletes its News Copy (failures logged). */
async function removeForRenewal(
  messageId: string,
  why: string,
  deps: INewsHubJobDeps,
): Promise<string> {
  const { newsCopy } = await deps.api.remove(messageId);
  if (!newsCopy) return `Removed News Item ${messageId}: ${why}.`;
  await deleteNewsCopy(messageId, newsCopy, deps.recording.discord);
  return `Removed News Item ${messageId} and its News Copy: ${why}.`;
}

/**
 * Fetches a News Item's message again and records it whole, which stores fresh image
 * addresses and expiry times; removes the News Item when the message is gone or no longer
 * qualifies, and deletes its News Copy then. The bot's own `/news share` post is the
 * member's News Item too. An imported item keeps its category (the API ignores
 * `category_key` for it). API and Discord errors are thrown as they are, for the job's
 * error message.
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
  if (!message) return removeForRenewal(messageId, "its message no longer exists", deps);
  const item = postedNewsItemFrom(message, places);
  if (!item) {
    return removeForRenewal(messageId, "its message no longer has a link or an image", deps);
  }
  const { data } = newsItemRecordBody(item);
  if (message.author.bot) {
    // A /news share post: its mention may not show the member's name, so keep the stored one.
    delete data.author_name;
  }
  await deps.api.record(messageId, { data });
  return `Recorded News Item ${messageId} again with fresh addresses for ` +
    `${plural(item.images.length, "image")}.`;
}

/** Discord's page size for message history. */
const DISCORD_PAGE = 100;

/** What one catch-up did. */
export type NewsCatchUpOutcome =
  | { status: "off" }
  /** Another catch-up was running, so this one did nothing. */
  | { status: "busy" }
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
    /** True when a history copy was running or took over, so copies were left to it. */
    paused: boolean;
    /** True when the News Hub was switched Off during the run, which stopped it. */
    switchedOff: boolean;
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
    const feed: INewsPage<IStoredNewsItem> = await api.listRecent(page, NEWS_LIST_PER);
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
      if (await switchedOff(deps, counts)) return;
      const filed = await fileNewsMessage(message, recording, { postCopy: false });
      if (filed?.recorded) counts.recorded += 1;
      else if (filed) counts.unrecorded += 1;
    }
    const last = ascending.at(-1);
    if (page.length < DISCORD_PAGE || !last) return;
    cursor = last.id;
  }
}

/** Whether the News Hub went Off (the flag cache, read before each item); it stops the run. */
async function switchedOff(deps: INewsHubJobDeps, counts: CatchUpCounts): Promise<boolean> {
  if ((await deps.recording.featureState()) !== "off") return false;
  counts.switchedOff = true;
  return true;
}

type CopyResult = "copied" | "uncopied" | "skipped";

/** Posts the News Copy of one item from its message, fetched now so image addresses work. */
async function copyItem(item: IUncopiedNewsItem, deps: INewsHubJobDeps): Promise<CopyResult> {
  const message = await deps.discord.fetchMessage(deps.archiveChannelId, item.message_id);
  if (!message) return "skipped";
  const current = postedNewsItemFrom(message, deps.recording.places);
  if (!current) return "skipped";
  const postedAt = item.origin === "import" ? new Date(item.posted_at) : null;
  const source = newsCopySourceOf(message, current, postedAt);
  const copy = await postNewsCopy(item.message_id, item.category_key, source, deps.recording);
  return copy ? "copied" : "uncopied";
}

/**
 * Posts the live News Items' missing News Copies, oldest first, from the API's listing of
 * items without one: it retries copies that failed earlier and copies the posts
 * {@link recordMissed} filed. Imported items are left to the history copy (`/news-import copy`).
 * Each item is tried once per catch-up. It holds the copy lane and stops after the current
 * item when a history copy takes over. It leaves items
 * from when live filing took over, and any being filed now, to the live listener.
 *
 * Copied items leave the listing, so the same page is read again; a page left with only
 * items already tried moves the reading on to the next.
 */
async function copyMissing(
  deps: INewsHubJobDeps,
  ceiling: number,
  counts: CatchUpCounts,
  hold: INewsCopyLaneHold,
): Promise<void> {
  const tried = new Set<string>();
  let page: number | null = 1;
  while (page !== null) {
    const listing = await deps.api.uncopied(page, NEWS_LIST_PER, "live");
    const fresh = listing.items.filter((item) => !tried.has(item.message_id));
    if (fresh.length === 0) {
      page = listing.next;
      continue;
    }
    for (const item of fresh) {
      if (Date.parse(item.posted_at) >= ceiling) return;
      if (hold.stopRequested()) {
        counts.paused = true;
        return;
      }
      if (await switchedOff(deps, counts)) return;
      tried.add(item.message_id);
      if (deps.recording.filing.has(item.message_id)) continue;
      const result = await copyItem(item, deps);
      counts[result] += 1;
      if (result !== "skipped") await deps.pace();
    }
  }
}

/** Runs one catch-up step; a failure is noted in `counts` (labelled) and does not throw. */
async function runStepOrNoteFailure(
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
 * missed while the bot was not listening, then posts the live News Items' missing News
 * Copies, oldest first, unless a history copy is running. Does nothing while the News Hub is
 * Off, read from the API (the flag cache can lag behind the change that queued the job), or
 * while another catch-up runs. A step that fails is reported and the next still runs;
 * running it again is safe. `fileMissed: false` runs the copy phase alone (the copy retry).
 */
export async function runNewsCatchUp(
  deps: INewsHubJobDeps,
  options: { fileMissed?: boolean } = {},
): Promise<NewsCatchUpOutcome> {
  if ((await deps.freshFeatureState()) === "off") return { status: "off" };
  if (!deps.lane.beginCatchUp()) return { status: "busy" };
  try {
    return { status: "done", ...(await catchUp(deps, options.fileMissed ?? true)) };
  } finally {
    deps.lane.endCatchUp();
  }
}

async function catchUp(deps: INewsHubJobDeps, fileMissed: boolean): Promise<CatchUpCounts> {
  const counts: CatchUpCounts = {
    recorded: 0,
    unrecorded: 0,
    copied: 0,
    uncopied: 0,
    skipped: 0,
    paused: false,
    switchedOff: false,
    failures: [],
  };
  if (deps.archiveChannelId === "") return counts;
  const ceiling = deps.liveSince();
  if (fileMissed) {
    await runStepOrNoteFailure(
      `Could not record the posts missed in the News Channel ${deps.archiveChannelId}`,
      counts,
      () => recordMissed(deps, ceiling, counts),
    );
  }
  if (counts.switchedOff) return counts;
  const hold = deps.lane.holdForCatchUp();
  if (!hold) {
    counts.paused = true;
    return counts;
  }
  try {
    await runStepOrNoteFailure("Could not post the missing News Copies", counts, () =>
      copyMissing(deps, ceiling, counts, hold));
  } finally {
    hold.release();
  }
  return counts;
}

/** The catch-up's outcome in plain words, for the job's result and the log. */
export function newsCatchUpSummary(outcome: NewsCatchUpOutcome): string {
  if (outcome.status === "off") return "Nothing caught up: the News Hub is Off.";
  if (outcome.status === "busy") return "Nothing caught up: a catch-up is already running.";
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
  const off = outcome.switchedOff ? " Stopped early: the News Hub was switched Off." : "";
  const failed = outcome.failures.length > 0
    ? ` ${plural(outcome.failures.length, "step")} could not run.`
    : "";
  return `Caught up the News Channel: ${outcome.recorded} missed News Items recorded` +
    `${unrecorded}, ${plural(outcome.copied, "News Copy", "News Copies")} posted` +
    `${uncopied}.${skipped}${paused}${off}${failed}`;
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

/** How often catch-up's copy phase runs on its own, so a failed copy is retried in time. */
export const NEWS_COPY_RETRY_INTERVAL_MS = 30 * 60_000;

export interface INewsCopyRetrySchedule {
  lane: NewsCopyLane;
  /** Runs catch-up's copy phase once: live items, paced, in the copy lane. */
  retry: () => Promise<void>;
  /** Runs `run` every `ms`. */
  every: (ms: number, run: () => void) => void;
  /** Runs `run` once the current work has unwound (the catch-up that released the lane). */
  soon: (run: () => void) => void;
}

/**
 * Retries missing News Copies without a restart (story 43): catch-up's copy phase runs every
 * {@link NEWS_COPY_RETRY_INTERVAL_MS}, right after a history copy finishes, and after
 * catch-up's own copy phase when live copies waited for it. The lane keeps it to one copier.
 */
export function scheduleNewsCopyRetries(schedule: INewsCopyRetrySchedule): void {
  const run = (): void => {
    void schedule.retry();
  };
  schedule.every(NEWS_COPY_RETRY_INTERVAL_MS, run);
  schedule.lane.onRelease((kind, copiesWaited) => {
    if (kind === "history" || copiesWaited) schedule.soon(run);
  });
}

/** Whether a copy retry did anything worth a log line. */
function retryDidWork(outcome: NewsCatchUpOutcome): boolean {
  if (outcome.status !== "done") return false;
  return outcome.copied + outcome.uncopied + outcome.skipped + outcome.failures.length > 0;
}

/** Startup: schedules the copy retries for this bot's client (see scheduleNewsCopyRetries). */
export function startNewsCopyRetries(client: Client): void {
  scheduleNewsCopyRetries({
    lane: NEWS_COPY_LANE,
    retry: async () => {
      try {
        const outcome = await runNewsCatchUp(createNewsHubJobDeps(client), { fileMissed: false });
        if (retryDidWork(outcome)) logInfo(LOG_CONTEXT, newsCatchUpSummary(outcome));
        if (outcome.status !== "done") return;
        for (const failure of outcome.failures) logError(LOG_CONTEXT, failure);
      } catch (err: unknown) {
        logError(LOG_CONTEXT, buildAnyErrorMessage("The News Copy retry failed", err));
      }
    },
    every: (ms, run) => {
      setInterval(run, ms).unref();
    },
    soon: (run) => {
      setTimeout(run, 0).unref();
    },
  });
}
