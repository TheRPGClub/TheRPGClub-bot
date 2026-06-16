import type {
  AnyThreadChannel,
  Client,
  Message,
  ThreadChannel,
} from "discord.js";
import { upsertThreadRecord } from "../classes/Thread.js";
import { NOW_PLAYING_FORUM_ID } from "../config/channels.js";
import { logError, logInfo, logWarn } from "../utilities/LogUtils.js";

// Coarse safety-net sweep. Each cycle reads forum threads and upserts them via
// therpgclub-api (which is backed by Neon), not the DB directly; at 10 min it
// drove avoidable load on the API and its Neon-backed compute. Thread state is
// not time-critical, so hourly is fine. On-demand syncing will move to an API
// endpoint in therpgclub-api so admins can trigger it manually instead of
// relying on a tight poll.
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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

async function syncForumThreads(client: Client): Promise<void> {
  try {
    const forum = await client.channels.fetch(NOW_PLAYING_FORUM_ID);
    if (!forum || !("threads" in forum)) {
      logWarn("ThreadSyncService.syncForumThreads", "Forum channel not found or invalid.");
      return;
    }

    const active = await (forum as any).threads.fetchActive();
    const archived = await (forum as any).threads.fetchArchived();

    for (const thread of active.threads.values()) {
      await captureThread(thread);
    }
    for (const thread of archived.threads.values()) {
      await captureThread(thread);
    }
  } catch (err) {
    logError("ThreadSyncService.sync", err);
  }
}

export function startThreadSyncService(client: Client): void {
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

      await upsertThreadRecord({
        threadId: thread.id,
        forumChannelId: NOW_PLAYING_FORUM_ID,
        threadName: thread.name ?? thread.id,
        isArchived: thread.archived ?? false,
        createdAt: thread.createdAt ?? new Date(),
        lastSeenAt: message.createdAt ?? new Date(),
      });
    } catch (err) {
      logError("ThreadSyncService.messageCreate", err);
    }
  });

  // Periodic poller
  void syncForumThreads(client);
  setInterval(() => {
    void syncForumThreads(client);
  }, DEFAULT_SYNC_INTERVAL_MS);

  logInfo("ThreadSyncService", "Service started");
}
