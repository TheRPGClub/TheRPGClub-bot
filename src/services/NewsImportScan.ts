import type { Client } from "discord.js";
import type { NewsPlaces } from "../config/newsHub.js";
import { newsItemFrom, type INewsMessage } from "../functions/NewsItem.js";
import {
  NEWS_IMPORT_BATCH_MAX,
  type INewsImportApi,
  type NewsImportBatchItem,
} from "./NewsImportApi.js";

// The News Import scan (spec api#355, bot#1526): reads the Game News Archive from the
// newest message back to the oldest and sends every News Item in it to the API as an
// imported News Item with no News Category. It runs inside the bot, not as a bot job
// (orchestrator decision): the job poller runs one job at a time under a 5-minute lease.

/** Discord's largest page of channel history. */
export const ARCHIVE_PAGE_MAX = 100;

/** One page of a channel's history, newest first, strictly older than `before` if given. */
export interface IArchiveReader {
  page(before: string | null, limit: number): Promise<readonly INewsMessage[]>;
}

/**
 * Reads a channel's history from Discord, a page at a time. Messages are not cached: a
 * whole-archive scan would only churn the bot's message cache.
 */
export function discordArchiveReader(client: Client, channelId: string): IArchiveReader {
  return {
    async page(before, limit) {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        throw new Error(`Channel ${channelId} is not a text channel the bot can read.`);
      }
      const page = await channel.messages.fetch({
        limit,
        cache: false,
        ...(before ? { before } : {}),
      });
      return [...page.values()];
    },
  };
}

export interface INewsImportScanDeps {
  archive: IArchiveReader;
  api: Pick<INewsImportApi, "recordBatch">;
  /** The Game News Archive's channel ID; its messages take no News Category. */
  archiveId: string;
  pageSize?: number;
  batchSize?: number;
  /**
   * Called after each page and once more when every batch is sent. The object is the live
   * progress, so read it at once.
   */
  onProgress?: (progress: Readonly<INewsImportScanProgress>) => void;
}

/**
 * Why an archive message is not a News Item: posted by a bot or a webhook, a system
 * message (a pin, a join), or text with no link and no image.
 */
export type NewsImportSkipReason = "bot" | "system" | "textOnly";

export interface INewsImportScanProgress {
  /** Archive messages read so far. */
  scanned: number;
  /** New imported News Items. */
  created: number;
  /** News Items an earlier scan already imported, updated in place. */
  updated: number;
  /** When the oldest message read so far was posted: how far back the scan has come. */
  oldestPostedAt: string | null;
  /** Messages staff removed with `skip` in an earlier sort, left out for good. */
  previouslyRemoved: number;
  /** News Items the API turned down, counted by its reason. */
  rejected: Record<string, number>;
  /** Messages that are not News Items, by reason (a reason seen once or more). */
  skipped: Partial<Record<NewsImportSkipReason, number>>;
  /** True once the oldest message was read and every batch sent. */
  finished: boolean;
  /** What stopped the scan early, or null. A re-run starts again from the newest message. */
  failure: { label: string; error: unknown } | null;
}

function emptyProgress(): INewsImportScanProgress {
  return {
    scanned: 0,
    created: 0,
    updated: 0,
    oldestPostedAt: null,
    previouslyRemoved: 0,
    rejected: {},
    skipped: {},
    finished: false,
    failure: null,
  };
}

function oldestOf(page: readonly INewsMessage[]): INewsMessage {
  return page.reduce((oldest, m) => (BigInt(m.id) < BigInt(oldest.id) ? m : oldest));
}

/**
 * Why newsItemFrom turned an archive message down. Its other rules (the place, a forum
 * post's opening message) cannot fail for a message read from the archive itself.
 */
function skipReason(message: INewsMessage): NewsImportSkipReason {
  if (message.system) return "system";
  if (message.author.bot || message.webhookId) return "bot";
  return "textOnly";
}

/**
 * The batch item for an archive message (the recognised News Item without a category), or
 * null after counting why it is not one.
 */
function batchItem(
  message: INewsMessage,
  places: NewsPlaces,
  progress: INewsImportScanProgress,
): NewsImportBatchItem | null {
  const item = newsItemFrom(message, places);
  if (!item) {
    const reason = skipReason(message);
    progress.skipped[reason] = (progress.skipped[reason] ?? 0) + 1;
    return null;
  }
  const { category_key: _category, ...rest } = item;
  return rest;
}

/** Thrown inside the scan to stop it with a label saying which step failed. */
class ScanStep extends Error {
  constructor(readonly label: string, readonly error: unknown) {
    super(label);
  }
}

async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    throw new ScanStep(label, error);
  }
}

/**
 * Reads the whole archive back from its newest message and imports every News Item in it.
 * Safe to run again after an interruption: the API's batch write is idempotent by message
 * ID, keeps assigned categories and leaves out messages staff removed with `skip`.
 */
export async function scanNewsArchive(
  deps: INewsImportScanDeps,
): Promise<INewsImportScanProgress> {
  const progress = emptyProgress();
  try {
    await scanInto(progress, deps);
    progress.finished = true;
  } catch (error: unknown) {
    if (!(error instanceof ScanStep)) throw error;
    progress.failure = { label: error.label, error: error.error };
  }
  return progress;
}

async function scanInto(
  progress: INewsImportScanProgress,
  deps: INewsImportScanDeps,
): Promise<void> {
  const pageSize = deps.pageSize ?? ARCHIVE_PAGE_MAX;
  const batchSize = deps.batchSize ?? NEWS_IMPORT_BATCH_MAX;
  const places: NewsPlaces = new Map([[deps.archiveId, null]]);

  const pending: NewsImportBatchItem[] = [];
  const send = async (batch: NewsImportBatchItem[]): Promise<void> => {
    const result = await step(
      `Could not record ${batch.length} archive messages as imported News Items`,
      () => deps.api.recordBatch(batch),
    );
    progress.created += result.created;
    progress.updated += result.updated;
    progress.previouslyRemoved += result.previouslyRemoved;
    for (const { reason } of result.rejected) {
      progress.rejected[reason] = (progress.rejected[reason] ?? 0) + 1;
    }
  };

  let before: string | null = null;
  for (;;) {
    const where: string = before ? `before message ${before}` : "from its newest message";
    const page: readonly INewsMessage[] = await step(
      `Could not read the Game News Archive ${where}`,
      () => deps.archive.page(before, pageSize),
    );
    progress.scanned += page.length;
    for (const message of page) {
      const item = batchItem(message, places, progress);
      if (item) pending.push(item);
    }
    if (page.length > 0) progress.oldestPostedAt = oldestOf(page).createdAt.toISOString();
    while (pending.length >= batchSize) await send(pending.splice(0, batchSize));
    if (page.length < pageSize) break;
    before = oldestOf(page).id;
    deps.onProgress?.(progress);
  }
  if (pending.length > 0) await send(pending.splice(0));
  deps.onProgress?.(progress);
}

/** A scan in progress: who started it, when, and its latest progress (null before any). */
export interface INewsImportScanRun {
  startedBy: string;
  startedAt: Date;
  progress: Readonly<INewsImportScanProgress> | null;
}

/**
 * Runs one scan at a time inside the bot. A scan does not survive a restart; staff run it
 * again, which is safe.
 */
export class NewsImportScanRunner {
  private run: INewsImportScanRun | null = null;

  /** The scan in progress, or null. */
  current(): Readonly<INewsImportScanRun> | null {
    return this.run;
  }

  /**
   * Starts a scan unless one is running (then null). The promise settles when the scan
   * ends; it rejects only on a bug, since a failed step ends the scan with `failure`.
   */
  start(
    startedBy: string,
    startedAt: Date,
    deps: INewsImportScanDeps,
  ): Promise<INewsImportScanProgress> | null {
    if (this.run) return null;
    const run: INewsImportScanRun = { startedBy, startedAt, progress: null };
    this.run = run;
    return scanNewsArchive({
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

/** The bot's one scan runner. */
export const NEWS_IMPORT_SCAN = new NewsImportScanRunner();
