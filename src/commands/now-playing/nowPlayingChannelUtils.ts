import {
  type ButtonInteraction,
  type CommandInteraction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import Member from "../../classes/Member.js";
import { logError } from "../../utilities/LogUtils.js";
import {
  nowPlayingListContexts,
  nowPlayingJournalContexts,
  trackNowPlayingJournalContext,
  NOW_PLAYING_CONTEXT_TTL_MS,
  NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS,
} from "./nowPlayingContexts.js";
import {
  type NowPlayingListContext,
  type NowPlayingJournalContext,
} from "./nowPlayingTypes.js";

export async function deleteLatestJournalMessageInChannel(
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
  ownerUserId: string,
  gameId: number,
): Promise<void> {
  const channelId = interaction.channelId;
  if (!channelId) {
    return;
  }

  const now = Date.now();

  // Expire stale entries and find the single most recent context for this channel.
  let latestKey: string | null = null;
  let latestContext: NowPlayingJournalContext | null = null;
  for (const [key, context] of nowPlayingJournalContexts.entries()) {
    if (now - context.createdAt > NOW_PLAYING_JOURNAL_CONTEXT_TTL_MS) {
      nowPlayingJournalContexts.delete(key);
      await Member.deleteJournalMessageContext(context.channelId, context.messageId)
        .catch((err) => logError("Journal.delete_expired_context_from_db_failed", err));
      continue;
    }
    if (context.channelId !== channelId) continue;
    if (context.ownerUserId !== ownerUserId || context.gameId !== gameId) continue;
    if (!latestContext || context.createdAt > latestContext.createdAt) {
      latestKey = key;
      latestContext = context;
    }
  }

  if (!latestKey || !latestContext) return;

  const channel = await interaction.client.channels
    .fetch(latestContext.channelId)
    .catch(() => null);
  if (!channel?.isTextBased()) {
    nowPlayingJournalContexts.delete(latestKey);
    await Member.deleteJournalMessageContext(latestContext.channelId, latestContext.messageId)
      .catch((err) => logError("Journal.delete_unreachable_context_from_db_failed", err));
    return;
  }

  const message = await channel.messages.fetch(latestContext.messageId).catch(() => null);
  if (!message) {
    nowPlayingJournalContexts.delete(latestKey);
    await Member.deleteJournalMessageContext(latestContext.channelId, latestContext.messageId)
      .catch((err) => logError("Journal.delete_missing_context_from_db_failed", err));
    return;
  }

  await message.delete().catch(() => null);
  nowPlayingJournalContexts.delete(latestKey);
  await Member.deleteJournalMessageContext(latestContext.channelId, latestContext.messageId)
    .catch((err) => logError("Journal.delete_context_from_db_after_message_delete_failed", err));
}

export async function trackJournalReply(
  reply: Message | null,
  ownerUserId: string,
  gameId: number,
): Promise<void> {
  if (!reply) {
    return;
  }
  await trackNowPlayingJournalContext(reply as Message<boolean>, ownerUserId, gameId);
}

export async function deleteEligibleNowPlayingMessageInCurrentChannel(
  interaction: CommandInteraction,
  predicate: (context: NowPlayingListContext) => boolean,
): Promise<boolean> {
  const channelId = interaction.channelId;
  if (!channelId) {
    return false;
  }

  const now = Date.now();
  for (const [key, context] of nowPlayingListContexts.entries()) {
    if (now - context.createdAt > NOW_PLAYING_CONTEXT_TTL_MS) {
      nowPlayingListContexts.delete(key);
      continue;
    }
    if (context.channelId !== channelId || !predicate(context)) {
      continue;
    }

    const channel = await interaction.client.channels.fetch(context.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      nowPlayingListContexts.delete(key);
      continue;
    }
    const message = await channel.messages.fetch(context.messageId).catch(() => null);
    if (!message) {
      nowPlayingListContexts.delete(key);
      continue;
    }

    await message.delete().catch(() => null);
    nowPlayingListContexts.delete(key);
    return true;
  }

  return false;
}
