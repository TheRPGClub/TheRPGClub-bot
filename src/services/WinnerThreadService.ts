import {
  AttachmentBuilder,
  ChannelFlags,
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
import { ADMIN_CHANNEL_ID, NOW_PLAYING_FORUM_ID } from "../config/channels.js";
import { COLOR_WARNING } from "../config/colors.js";
import { DISCORD_ACTIVITY_NAME_MAX, DISCORD_THREAD_NAME_MAX } from "../config/textLimits.js";
import { setAutomaticPresence } from "../functions/SetPresence.js";
import { fetchSendableChannel } from "../functions/ChannelUtils.js";
import {
  buildAccentContainer,
  buildComponentsV2Flags,
} from "../functions/ComponentsV2Utils.js";
import { logError } from "../utilities/LogUtils.js";
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
    `${gameTitle} [${kindLabel} Round ${roundNumber}]`,
    DISCORD_THREAD_NAME_MAX,
  );
}

/** The bot's status while a game is the GOTM, e.g. "Title [GOTM Round 12]". */
export function buildGotmPresence(gameTitle: string, roundNumber: number): string {
  const suffix = ` [GOTM Round ${roundNumber}]`;
  return `${truncateWithEllipsis(gameTitle, DISCORD_ACTIVITY_NAME_MAX - suffix.length)}${suffix}`;
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
  let result: IWinnerThreadResult;
  try {
    result = await findOrCreateWinnerThread(params);
  } catch (error) {
    await reportWinnerStepFailure(params, "set up the winner thread", error);
    throw error;
  }
  if (params.kindLabel === "GOTM") {
    await spotlightGotmWinner(params, result.threadId);
  }
  return result;
}

async function findOrCreateWinnerThread(
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
 * Pins the GOTM winner's thread and sets the bot's status to it. Each step is
 * best-effort and safe to repeat, so one failing does not skip the other.
 */
async function spotlightGotmWinner(
  params: IWinnerThreadParams,
  threadId: string | null,
): Promise<void> {
  if (threadId) {
    try {
      await pinWinnerThread(params.client, threadId);
    } catch (error) {
      await reportWinnerStepFailure(params, "pin the winner thread", error);
    }
  }
  try {
    await setAutomaticPresence(
      params.client,
      buildGotmPresence(params.gameTitle, params.roundNumber),
    );
  } catch (error) {
    await reportWinnerStepFailure(params, "set the bot status", error);
  }
}

/**
 * Logs a failed winner step and tells the admin channel, since these steps run
 * unattended and a console log alone goes unseen. Never throws.
 */
export async function reportWinnerStepFailure(
  params: IWinnerThreadParams,
  step: string,
  error: unknown,
): Promise<void> {
  logError(`WinnerThreadService.${step}`, error);
  const reason = error instanceof Error ? error.message : String(error);
  const winner = `${params.gameTitle} [${params.kindLabel} Round ${params.roundNumber}]`;
  const text = [
    `**The bot could not ${step} for ${winner}.**`,
    "```",
    reason,
    "```",
    "-# Check that the bot has Manage Threads in the Now Playing forum, then fix it by hand.",
  ].join("\n");
  try {
    const channel = await fetchSendableChannel(params.client, ADMIN_CHANNEL_ID);
    await channel?.send({
      components: [buildAccentContainer(text, COLOR_WARNING)],
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
  } catch (sendError) {
    logError("WinnerThreadService.reportWinnerStepFailure", sendError);
  }
}

/**
 * Pins a forum thread. A forum holds one pinned post, so the forum's other
 * pinned thread (the last winner) is unpinned first. Does nothing outside a
 * forum or when the thread is already pinned.
 */
export async function pinWinnerThread(client: Client, threadId: string): Promise<void> {
  const channel = await client.channels.fetch(threadId).catch(() => null);
  if (!channel?.isThread() || channel.parent?.type !== ChannelType.GuildForum) {
    return;
  }
  if (channel.flags.has(ChannelFlags.Pinned)) {
    return;
  }
  const { threads } = await channel.parent.threads.fetchActive();
  for (const other of threads.values()) {
    if (other.id !== threadId && other.flags.has(ChannelFlags.Pinned)) {
      await other.unpin();
    }
  }
  if (channel.archived) {
    await channel.setArchived(false);
  }
  await channel.pin();
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
