import type { Client } from "discord.js";
import type { INewsCopySource } from "../functions/NewsCopy.js";
import { newsImageAttachments } from "../functions/NewsItem.js";
import { buildDiscordErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { postNewsCopy, type INewsCopyDeps, type INewsPost } from "./NewsCopying.js";
import type { INewsUncopiedApi, IUncopiedNewsItem } from "./NewsItemApi.js";

// The history copy (spec api#367, bot#1539): staff copy every News Item that has no News
// Copy into its category's thread, oldest first, about one every 1.5 seconds. It runs in
// the bot, one at a time, like the News Import scan it replaces. Its resume point is the
// API's: the items still without a copy. While it runs, new copies wait (see
// `newsCopiesPaused`); they are the newest items without a copy, so it posts them last.

const LOG_CONTEXT = "NewsHistoryCopy";

/** The gap between two copies: about 40 a minute, well inside Discord's limits. */
export const HISTORY_COPY_INTERVAL_MS = 1_500;

/** The page the runner reads the uncopied listing with. */
export const HISTORY_COPY_PER = 100;

/**
 * Copies that fail in a row before the run stops: something is wrong for every item (a
 * thread the bot cannot post in, Discord down), so the run stops rather than log each one.
 */
export const HISTORY_COPY_FAILURE_LIMIT = 10;

/** Reads a News Item's original message, fresh, so its image addresses have not expired. */
export interface INewsOriginals {
  fetch: (messageId: string) => Promise<INewsPost>;
}

export interface INewsHistoryCopyDeps extends INewsCopyDeps {
  listing: INewsUncopiedApi;
  originals: INewsOriginals;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  per?: number;
  failureLimit?: number;
  /** Called after each copy. The object is the live progress, so read it at once. */
  onProgress?: (progress: Readonly<INewsHistoryCopyProgress>) => void;
}

export interface INewsHistoryCopyProgress {
  /** News Copies posted and reported by this run. */
  copied: number;
  /** Items whose copy failed (logged); this run skips them and a later run tries again. */
  failed: number;
  /** Items still without a copy, less those this run skipped; null before the first read. */
  left: number | null;
  /** When the last item this run reached was posted: how far the copy has come. */
  reachedPostedAt: string | null;
  /** True once no item without a copy is left (except those skipped). */
  finished: boolean;
  /** What stopped the run early, or null. A re-run continues from the API's state. */
  failure: { label: string; error: unknown } | null;
}

function emptyProgress(): INewsHistoryCopyProgress {
  return {
    copied: 0,
    failed: 0,
    left: null,
    reachedPostedAt: null,
    finished: false,
    failure: null,
  };
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** What the item's News Copy shows; an imported item's copy shows its original date. */
function copySource(item: IUncopiedNewsItem, post: INewsPost): INewsCopySource {
  return {
    originalUrl: post.url,
    authorId: item.author.user_id,
    comment: item.comment,
    linkUrl: item.link?.url ?? null,
    images: newsImageAttachments(post).map(({ url, name }) => ({ url, name })),
    postedAt: item.origin === "import" ? new Date(item.posted_at) : null,
  };
}

/** Posts and reports one item's copy; false (logged) when it failed. */
async function copyOne(item: IUncopiedNewsItem, deps: INewsHistoryCopyDeps): Promise<boolean> {
  let post: INewsPost;
  try {
    post = await deps.originals.fetch(item.message_id);
  } catch (error: unknown) {
    const label = `Could not read the original message of News Item ${item.message_id}; ` +
      "the history copy skips it";
    logError(LOG_CONTEXT, buildDiscordErrorMessage(label, error));
    return false;
  }
  const copy = await postNewsCopy(item.message_id, item.category_key, copySource(item, post),
    deps);
  return copy !== null;
}

/**
 * Copies every News Item without a News Copy, oldest first, pausing between copies. Each
 * reported copy leaves the API's listing, so the run reads page 1 again after a page; an
 * item whose copy failed stays listed, so the run remembers it and reads past it. Safe to
 * run again: it starts from whatever is still uncopied.
 */
export async function copyNewsHistory(
  deps: INewsHistoryCopyDeps,
): Promise<INewsHistoryCopyProgress> {
  const progress = emptyProgress();
  const sleep = deps.sleep ?? realSleep;
  const per = deps.per ?? HISTORY_COPY_PER;
  const failureLimit = deps.failureLimit ?? HISTORY_COPY_FAILURE_LIMIT;
  const skipped = new Set<string>();
  let failedInARow = 0;
  let copiedBefore = false;
  let page = 1;
  for (;;) {
    let listed: Awaited<ReturnType<INewsUncopiedApi["uncopied"]>>;
    try {
      listed = await deps.listing.uncopied(page, per);
    } catch (error: unknown) {
      progress.failure = { label: "Could not list the News Items without a News Copy", error };
      return progress;
    }
    progress.left = Math.max(0, listed.count - skipped.size);
    const fresh = listed.items.filter((item) => !skipped.has(item.message_id));
    if (fresh.length === 0) {
      if (listed.next === null) break;
      page = listed.next;
      continue;
    }
    for (const item of fresh) {
      if (copiedBefore) await sleep(deps.intervalMs ?? HISTORY_COPY_INTERVAL_MS);
      copiedBefore = true;
      if (await copyOne(item, deps)) {
        progress.copied += 1;
        failedInARow = 0;
      } else {
        progress.failed += 1;
        skipped.add(item.message_id);
        failedInARow += 1;
      }
      progress.left = Math.max(0, (progress.left ?? 0) - 1);
      progress.reachedPostedAt = item.posted_at;
      deps.onProgress?.(progress);
      if (failedInARow >= failureLimit) {
        const label = `Stopped after ${failedInARow} News Copies in a row failed; the console ` +
          "log has each error";
        progress.failure = { label, error: null };
        return progress;
      }
    }
    page = 1;
  }
  progress.finished = true;
  deps.onProgress?.(progress);
  return progress;
}

/** A history copy in progress: who started it, when, and its latest progress (null before any). */
export interface INewsHistoryCopyRun {
  startedBy: string;
  startedAt: Date;
  progress: Readonly<INewsHistoryCopyProgress> | null;
}

/**
 * Runs one history copy at a time inside the bot. A run does not survive a restart; staff
 * run it again, and it continues with the items still without a copy.
 */
export class NewsHistoryCopyRunner {
  private run: INewsHistoryCopyRun | null = null;

  /** The run in progress, or null. */
  current(): Readonly<INewsHistoryCopyRun> | null {
    return this.run;
  }

  /** True while a run is in progress: new News Copies wait for it. */
  copiesPaused(): boolean {
    return this.run !== null;
  }

  /**
   * Starts a run unless one is in progress (then null). The promise settles when the run
   * ends; it rejects only on a bug, since a failed step ends the run with `failure`.
   */
  start(
    startedBy: string,
    startedAt: Date,
    deps: INewsHistoryCopyDeps,
  ): Promise<INewsHistoryCopyProgress> | null {
    if (this.run) return null;
    const run: INewsHistoryCopyRun = { startedBy, startedAt, progress: null };
    this.run = run;
    return copyNewsHistory({
      ...deps,
      onProgress: (progress) => {
        run.progress = progress;
        deps.onProgress?.(progress);
      },
    }).finally(() => {
      this.run = null;
    });
  }
}

/** The bot's one history copy runner. */
export const NEWS_HISTORY_COPY = new NewsHistoryCopyRunner();

/**
 * Whether new News Copies wait now, because a history copy is running. The live filing
 * flow asks it (through `INewsCopyDeps.copiesPaused`), and so does catch-up.
 */
export function newsCopiesPaused(): boolean {
  return NEWS_HISTORY_COPY.copiesPaused();
}

/**
 * Reads originals from the News Channel, skipping the message cache (a whole-history run
 * would only churn it) and always asking Discord, so image addresses are fresh.
 */
export function discordNewsOriginals(client: Client, channelId: string): INewsOriginals {
  return {
    async fetch(messageId) {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        throw new Error(`Channel ${channelId} is not a text channel the bot can read.`);
      }
      return channel.messages.fetch({ message: messageId, cache: false, force: true });
    },
  };
}
