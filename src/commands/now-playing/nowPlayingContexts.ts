import { MessageFlags, type Message, type Client } from "discord.js";
import Member from "../../classes/Member.js";
import { EphemeralOwnerMenu } from "../../functions/EphemeralOwnerMenu.js";
import { buildJournalView } from "../../functions/journalView.js";
import { logError, logInfo } from "../../utilities/LogUtils.js";
import { COMPLETION_TYPES, type CompletionType } from "../profile.command.js";
import {
  NOW_PLAYING_JOURNAL_PAGE_PREFIX,
  NOW_PLAYING_JOURNAL_HEADER_PREFIX,
} from "./nowPlayingIds.js";

export const NOW_PLAYING_CONTEXT_TTL_MS = 3 * 60 * 60 * 1000;
export const NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS = 2 * 60 * 60 * 1000;
import {
  type NowPlayingAddSession,
  type NowPlayingAddPlatformSession,
  type NowPlayingCompletionWizardSession,
  type NowPlayingCompletionPlatformSession,
  type NowPlayingTrackedView,
  type NowPlayingListContext,
  type NowPlayingJournalContext,
} from "./nowPlayingTypes.js";

export const nowPlayingAddSessions = new Map<string, NowPlayingAddSession>();
export const nowPlayingAddPlatformSessions = new Map<string, NowPlayingAddPlatformSession>();
export const nowPlayingCompletionWizardSessions =
  new Map<string, NowPlayingCompletionWizardSession>();
export const nowPlayingCompletionPlatformSessions =
  new Map<string, NowPlayingCompletionPlatformSession>();
export const nowPlayingListContexts = new Map<string, NowPlayingListContext>();
export const nowPlayingJournalContexts = new Map<string, NowPlayingJournalContext>();

export const journalOwnerMenu = new EphemeralOwnerMenu();
export const nowPlayingOwnerMenu = new EphemeralOwnerMenu();

export async function restoreJournalMessageContextsFromDb(): Promise<void> {
  try {
    await Member.pruneExpiredJournalMessageContexts(NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS);
    const rows = await Member.loadActiveJournalMessageContexts(NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS);
    for (const row of rows) {
      const key = `${row.channelId}:${row.messageId}`;
      nowPlayingJournalContexts.set(key, row);
    }
    logInfo("Journal", `Restored ${rows.length} message context(s) from DB.`);
  } catch (err) {
    logError("Journal.restore_contexts_failed", err);
  }
}

export function createNowPlayingCompletionWizardSession(
  userId: string,
  returnToList: boolean = false,
): string {
  const sessionId = `np-comp-ui-${userId}`;
  const defaultType = (COMPLETION_TYPES[0] ?? "Main Story") as CompletionType;
  nowPlayingCompletionWizardSessions.set(sessionId, {
    userId,
    gameId: null,
    completionType: defaultType,
    removeFromNowPlaying: true,
    announce: true,
    addCompletionNote: true,
    returnToList,
  });
  return sessionId;
}

export function clearNowPlayingAddSession(sessionId: string): void {
  const session = nowPlayingAddSessions.get(sessionId);
  if (session?.timeoutId) {
    clearTimeout(session.timeoutId);
  }
  nowPlayingAddSessions.delete(sessionId);
}

export function buildNowPlayingContextKey(channelId: string, messageId: string): string {
  return `${channelId}:${messageId}`;
}

export function buildNowPlayingJournalContextKey(channelId: string, messageId: string): string {
  return `${channelId}:${messageId}`;
}

export function trackNowPlayingListContext(
  message: Message<boolean>,
  context: {
    view: NowPlayingTrackedView;
    ownerUserId?: string | null;
    selectedUserId?: string | null;
  },
): void {
  if (message.flags.has(MessageFlags.Ephemeral)) {
    return;
  }
  const key = buildNowPlayingContextKey(message.channelId, message.id);
  const existing = nowPlayingListContexts.get(key);
  nowPlayingListContexts.set(key, {
    channelId: message.channelId,
    messageId: message.id,
    createdAt: existing?.createdAt ?? Date.now(),
    view: context.view,
    ownerUserId: context.ownerUserId ?? null,
    selectedUserId: context.selectedUserId ?? null,
  });
}

export function setNowPlayingListContext(userId: string, message: Message<boolean>): void {
  trackNowPlayingListContext(message, {
    view: "single",
    ownerUserId: userId,
  });
}

export async function trackNowPlayingJournalContext(
  message: Message<boolean>,
  ownerUserId: string,
  gameId: number,
): Promise<void> {
  if (message.flags.has(MessageFlags.Ephemeral)) {
    return;
  }
  const key = buildNowPlayingJournalContextKey(message.channelId, message.id);
  const existing = nowPlayingJournalContexts.get(key);
  const createdAt = existing?.createdAt ?? Date.now();
  nowPlayingJournalContexts.set(key, {
    channelId: message.channelId,
    messageId: message.id,
    createdAt,
    ownerUserId,
    gameId,
  });
  await Member.upsertJournalMessageContext(
    message.channelId,
    message.id,
    createdAt,
    ownerUserId,
    gameId,
  ).catch((err) => logError("Journal.persist_context_failed", err));
}

export async function refreshJournalMessages(
  client: Client,
  ownerId: string,
  gameId: number,
  excludeMessageId?: string,
): Promise<void> {
  const now = Date.now();

  // First pass: expire stale contexts and collect the most recent context per channel.
  const latestByChannel = new Map<string, NowPlayingJournalContext>();
  for (const [key, ctx] of nowPlayingJournalContexts.entries()) {
    if (ctx.ownerUserId !== ownerId || ctx.gameId !== gameId) continue;
    if (ctx.messageId === excludeMessageId) continue;
    if (now - ctx.createdAt > NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS) {
      nowPlayingJournalContexts.delete(key);
      await Member.deleteJournalMessageContext(ctx.channelId, ctx.messageId)
        .catch((err) => logError("Journal.delete_expired_context_failed", err));
      continue;
    }
    const existing = latestByChannel.get(ctx.channelId);
    if (!existing || ctx.createdAt > existing.createdAt) {
      latestByChannel.set(ctx.channelId, ctx);
    }
  }

  // Second pass: update only the single most recent message per channel.
  for (const ctx of latestByChannel.values()) {
    const channel = await client.channels.fetch(ctx.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      const key = `${ctx.channelId}:${ctx.messageId}`;
      nowPlayingJournalContexts.delete(key);
      await Member.deleteJournalMessageContext(ctx.channelId, ctx.messageId)
        .catch((err) => logError("Journal.delete_unreachable_context_failed", err));
      continue;
    }
    const message = await channel.messages.fetch(ctx.messageId).catch(() => null);
    if (!message) {
      const key = `${ctx.channelId}:${ctx.messageId}`;
      nowPlayingJournalContexts.delete(key);
      await Member.deleteJournalMessageContext(ctx.channelId, ctx.messageId)
        .catch((err) => logError("Journal.delete_missing_context_failed", err));
      continue;
    }
    const guildId = channel.isDMBased() ? null : (channel as any).guildId as string;
    const payload = await buildJournalView({
      ownerId,
      viewerId: null,
      gameId,
      page: 1,
      guildId,
      prevPageCustomId: (p) =>
        `${NOW_PLAYING_JOURNAL_PAGE_PREFIX}:${ownerId}:${gameId}:prev:${p}`,
      nextPageCustomId: (p) =>
        `${NOW_PLAYING_JOURNAL_PAGE_PREFIX}:${ownerId}:${gameId}:next:${p}`,
      headerButtonCustomId: `${NOW_PLAYING_JOURNAL_HEADER_PREFIX}:${ownerId}:${gameId}:1`,
      includeNowPlayingMeta: true,
      includeCompletions: true,
    });
    await message.edit({
      components: payload.components as any[],
      files: payload.files,
    }).catch((err) => logError("Journal.refresh_public_message_failed", err));
  }
}
