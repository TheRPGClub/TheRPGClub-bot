import type {
  AnyThreadChannel,
  Client,
  Message,
  ThreadChannel,
} from "discord.js";
import { upsertThreadRecord } from "../classes/Thread.js";
import { NOW_PLAYING_FORUM_ID } from "../config/channels.js";
import { createIntervalTask } from "../utilities/IntervalUtils.js";
import { logError, logInfo, logWarn } from "../utilities/LogUtils.js";

// Coarse safety-net sweep. Each cycle reads forum threads and upserts them via
// therpgclub-api (which is backed by Neon), not the DB directly; at 10 min it
// drove avoidable load on the API and its Neon-backed compute. Thread state is
// not time-critical, so hourly is fine. On-demand syncing will move to an API
// endpoint in therpgclub-api so admins can trigger it manually instead of
// relying on a tight poll.
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
// Discord's maximum page size for archived threads.
const ARCHIVED_PAGE_LIMIT = 100;
// A busy thread would otherwise write through the API on every message. lastSeenAt only
// needs to be roughly current, and the hourly sweep catches up whatever the throttle skips.
const MESSAGE_UPSERT_THROTTLE_MS = 5 * 60 * 1000;

const lastMessageUpsertAt = new Map<string, number>();
let started = false;

function isTargetForum(thread: AnyThreadChannel | ThreadChannel | null): boolean {
  const parentId = (thread as any)?.parentId ?? null;
  return parentId === NOW_PLAYING_FORUM_ID;
}

async function captureThread(thread: AnyThreadChannel | ThreadChannel): Promise<void> {
  const createdAt: Date = thread.createdAt ?? new Date();
  const lastSeenAt: Date | null =
    thread.lastMessage?.createdAt ??
    ((thread as any)?.archiveTimestamp
      ? new Date((thread as any).archiveTimestamp)
      : null);

  await upsertThreadRecord({
    threadId: thread.id,
    forumChannelId: NOW_PLAYING_FORUM_ID,
    threadName: thread.name ?? thread.id,
    isArchived: thread.archived ?? false,
    createdAt,
    lastSeenAt,
  });
}

interface IArchivedThreadPage {
  threads: Map<string, AnyThreadChannel>;
  hasMore?: boolean;
}

interface IForumThreadManager {
  fetchActive(): Promise<{ threads: Map<string, AnyThreadChannel> }>;
  fetchArchived(options: { before?: Date; limit: number }): Promise<IArchivedThreadPage>;
}

/**
 * Reads every page of archived threads. Pages come newest archive first, so the oldest
 * archive time on a page is the `before` cursor for the next one. A cursor that does not
 * move back ends the walk, so a page Discord repeats cannot loop forever.
 */
export async function fetchAllArchivedThreads(
  threads: IForumThreadManager,
): Promise<AnyThreadChannel[]> {
  const all: AnyThreadChannel[] = [];
  let before: Date | undefined;

  for (;;) {
    const page = await threads.fetchArchived({ before, limit: ARCHIVED_PAGE_LIMIT });
    const pageThreads = [...page.threads.values()];
    all.push(...pageThreads);
    if (!page.hasMore || pageThreads.length === 0) break;

    const timestamps = pageThreads
      .map((thread) => thread.archiveTimestamp)
      .filter((value): value is number => typeof value === "number");
    if (timestamps.length === 0) break;
    const oldest = Math.min(...timestamps);
    if (before && oldest >= before.getTime()) break;
    before = new Date(oldest);
  }

  return all;
}

function pruneMessageThrottle(now: number): void {
  for (const [threadId, at] of lastMessageUpsertAt) {
    if (now - at >= MESSAGE_UPSERT_THROTTLE_MS) {
      lastMessageUpsertAt.delete(threadId);
    }
  }
}

/** Claims the per-thread upsert slot. False while the thread was upserted inside the window. */
export function claimMessageUpsert(threadId: string, now: number = Date.now()): boolean {
  const last = lastMessageUpsertAt.get(threadId);
  if (last !== undefined && now - last < MESSAGE_UPSERT_THROTTLE_MS) return false;
  lastMessageUpsertAt.set(threadId, now);
  return true;
}

export function resetMessageUpsertThrottle(): void {
  lastMessageUpsertAt.clear();
}

async function syncForumThreads(client: Client): Promise<void> {
  try {
    pruneMessageThrottle(Date.now());
    const forum = await client.channels.fetch(NOW_PLAYING_FORUM_ID);
    if (!forum || !("threads" in forum)) {
      logWarn("ThreadSyncService.syncForumThreads", "Forum channel not found or invalid.");
      return;
    }

    const threads = forum.threads as unknown as IForumThreadManager;
    const active = await threads.fetchActive();
    const archived = await fetchAllArchivedThreads(threads);

    for (const thread of active.threads.values()) {
      await captureThread(thread);
    }
    for (const thread of archived) {
      await captureThread(thread);
    }
  } catch (err) {
    logError("ThreadSyncService.sync", err);
  }
}

export function startThreadSyncService(client: Client): void {
  if (started) {
    logWarn("ThreadSyncService", "Already started, ignoring a second start.");
    return;
  }
  started = true;

  // Event hooks for freshness
  client.on("threadCreate", async (thread) => {
    try {
      if (!isTargetForum(thread)) return;
      await captureThread(thread);
    } catch (err) {
      logError("ThreadSyncService.threadCreate", err);
    }
  });

  client.on("messageCreate", async (message: Message) => {
    try {
      const thread = message.channel;
      if (!("isThread" in thread) || !thread.isThread()) return;
      if (!isTargetForum(thread)) return;
      if (!claimMessageUpsert(thread.id)) return;

      await upsertThreadRecord({
        threadId: thread.id,
        forumChannelId: NOW_PLAYING_FORUM_ID,
        threadName: thread.name ?? thread.id,
        isArchived: thread.archived ?? false,
        createdAt: thread.createdAt ?? new Date(),
        lastSeenAt: message.createdAt ?? new Date(),
      });
    } catch (err) {
      // Free the slot so the next message retries instead of waiting out the window.
      lastMessageUpsertAt.delete(message.channel.id);
      logError("ThreadSyncService.messageCreate", err);
    }
  });

  // Periodic poller
  createIntervalTask({
    name: "ThreadSyncService.sync",
    intervalMs: DEFAULT_SYNC_INTERVAL_MS,
    task: () => syncForumThreads(client),
  }).start();

  logInfo("ThreadSyncService", "Service started");
}
