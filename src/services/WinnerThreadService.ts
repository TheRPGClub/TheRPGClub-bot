import {
  AttachmentBuilder,
  ChannelType,
  type Client,
  type ForumChannel,
  type MessageCreateOptions,
} from "discord.js";
import Game from "../classes/Game.js";
import {
  getThreadsByGameId,
  setThreadGameLink,
  updateThreadName,
  upsertThreadRecord,
} from "../classes/Thread.js";
import { GOTM_FORUM_TAG_ID, NR_GOTM_FORUM_TAG_ID } from "../config/tags.js";
import { NOW_PLAYING_FORUM_ID } from "../config/channels.js";
import { DISCORD_THREAD_NAME_MAX } from "../config/textLimits.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";

export type WinnerKindLabel = "GOTM" | "NR-GOTM";

export interface IWinnerThreadParams {
  client: Client;
  gameId: number;
  gameTitle: string;
  roundNumber: number;
  kindLabel: WinnerKindLabel;
}

export interface IWinnerThreadResult {
  threadId: string | null;
  action: "created" | "updated" | "unchanged";
}

export function buildWinnerThreadTitle(
  gameTitle: string,
  kindLabel: WinnerKindLabel,
  roundNumber: number,
): string {
  return truncateWithEllipsis(
    `${gameTitle} (${kindLabel} Round ${roundNumber})`,
    DISCORD_THREAD_NAME_MAX,
  );
}

function winnerForumTagId(kindLabel: WinnerKindLabel): string {
  return kindLabel === "GOTM" ? GOTM_FORUM_TAG_ID : NR_GOTM_FORUM_TAG_ID;
}

/**
 * Ensures the winning game has a Now Playing forum thread carrying the round
 * title and category tag. An existing linked thread is renamed and retagged;
 * otherwise a new thread is created with the game's cover as the starter
 * message. Throws when neither is possible so callers can surface it.
 */
export async function ensureWinnerThread(
  params: IWinnerThreadParams,
): Promise<IWinnerThreadResult> {
  const existingIds = await getThreadsByGameId(params.gameId);
  for (const threadId of existingIds) {
    const updated = await updateExistingWinnerThread(params, threadId);
    if (updated) {
      return updated;
    }
  }
  return createWinnerThread(params);
}

/**
 * Renames/retags a linked thread that still exists on Discord. Returns null
 * when the thread record points at a deleted or unfetchable channel, so the
 * caller can fall back to creating a fresh thread.
 */
async function updateExistingWinnerThread(
  params: IWinnerThreadParams,
  threadId: string,
): Promise<IWinnerThreadResult | null> {
  const channel = await params.client.channels.fetch(threadId).catch(() => null);
  if (!channel?.isThread()) {
    return null;
  }

  const desiredTitle = buildWinnerThreadTitle(
    params.gameTitle,
    params.kindLabel,
    params.roundNumber,
  );
  const tagId = winnerForumTagId(params.kindLabel);
  const isForumThread = channel.parent?.type === ChannelType.GuildForum;
  const currentTags = channel.appliedTags ?? [];
  const needsTitle = channel.name !== desiredTitle;
  const needsTag = isForumThread && !currentTags.includes(tagId);
  if (!needsTitle && !needsTag) {
    return { threadId, action: "unchanged" };
  }

  if (channel.archived) {
    await channel.setArchived(false);
  }
  // Discord caps applied tags at 5; drop the last one if there is no room.
  const appliedTags = needsTag ? [...currentTags.slice(0, 4), tagId] : currentTags;
  await channel.edit({
    name: desiredTitle,
    ...(isForumThread ? { appliedTags } : {}),
  });
  await updateThreadName(threadId, desiredTitle);
  return { threadId, action: "updated" };
}

async function createWinnerThread(
  params: IWinnerThreadParams,
): Promise<IWinnerThreadResult> {
  const forumChannel = await params.client.channels
    .fetch(NOW_PLAYING_FORUM_ID)
    .catch(() => null);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    throw new Error("Now Playing forum channel was not found.");
  }
  const forum = forumChannel as ForumChannel;

  const game = await Game.getGameById(params.gameId);
  if (!game) {
    throw new Error(`GameDB game ${params.gameId} not found while creating thread.`);
  }

  const title = buildWinnerThreadTitle(
    params.gameTitle,
    params.kindLabel,
    params.roundNumber,
  );
  const imageBuffer =
    game.imageData ?? await Game.getGamePrimaryImageBuffer(params.gameId).catch(() => null);
  const files = imageBuffer
    ? [new AttachmentBuilder(imageBuffer, { name: `gamedb_${params.gameId}.png` })]
    : [];
  const messagePayload: MessageCreateOptions = {
    allowedMentions: { parse: [] },
  };
  if (files.length) {
    messagePayload.files = files;
  } else {
    messagePayload.content = "Cover image unavailable for this game.";
  }

  const thread = await forum.threads.create({
    name: title,
    message: messagePayload,
    appliedTags: [winnerForumTagId(params.kindLabel)],
  });
  await upsertThreadRecord({
    threadId: thread.id,
    forumChannelId: thread.parentId ?? NOW_PLAYING_FORUM_ID,
    threadName: thread.name ?? title,
    isArchived: Boolean(thread.archived),
    createdAt: thread.createdAt ?? new Date(),
    lastSeenAt: null,
    skipLinking: "Y",
  });
  await setThreadGameLink(thread.id, params.gameId);
  return { threadId: thread.id, action: "created" };
}
