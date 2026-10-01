import {
  ButtonStyle,
  type ButtonInteraction,
  type CommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { buildErrorReply, safeV2TextContent } from "./ComponentsV2Utils.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { type CompletionType } from "../commands/profile.command.js";
import {
  formatDiscordTimestamp,
  formatPlaytimeHours,
  formatTableDate,
} from "./DateFormatUtils.js";
import type { IGame } from "../types/GameTypes.js";
import Game from "../classes/Game.js";
import GameProfileService from "../classes/GameProfileService.js";
import Member, { type ICompletionRecord } from "../classes/Member.js";
import { ANNOUNCEMENT_CHANNEL_ID, BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import {
  buildComponentsV2EditFlags,
  buildComponentsV2Flags,
  buildTextContainer,
} from "./ComponentsV2Utils.js";
import {
  replyIfNotOwner,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  safeReply,
  safeUpdate,
  safeUserFetch,
} from "./InteractionUtils.js";
import { renderUsernameWithEmoji } from "../services/UserEmojiService.js";
import { logError } from "../utilities/LogUtils.js";
import { buildActionButton, buildButtonRow } from "./uiComponents.js";
import { assertCustomIdSegments } from "../utilities/CustomIdUtils.js";
import { NOW_PLAYING_REMOVE_CONFIRM_PREFIX } from "../config/customIdPrefixes.js";

const MAX_PLAYTIME_HOURS = 999999.99;

export function validateCompletionPlaytimeInput(
  input: string,
): { value: number | null; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { value: null, error: null };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) {
    return { value: null, error: "Playtime must be a non-negative number." };
  }
  if (num > MAX_PLAYTIME_HOURS) {
    return { value: null, error: `Playtime must be ${MAX_PLAYTIME_HOURS} hours or less.` };
  }
  const decimalPart = trimmed.split(".")[1];
  if (decimalPart && decimalPart.length > 2) {
    return { value: null, error: "Playtime must have at most 2 decimal places." };
  }
  return { value: num, error: null };
}

export async function saveCompletion(
  interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  userId: string,
  gameId: number,
  platformId: number | null,
  completionType: CompletionType,
  completedAt: Date | null,
  finalPlaytimeHours: number | null,
  note: string | null,
  gameTitle?: string,
  announce?: boolean,
  isAdminOverride: boolean = false,
  removeFromNowPlaying: NowPlayingRemoval = true,
): Promise<void> {
  if (interaction.user.id !== userId && !isAdminOverride) {
    await safeReply(interaction, {
      components: [buildTextContainer("You can only log completions for yourself.")],
      flags: buildComponentsV2Flags(true),
    });
    return;
  }

  const game = await Game.getGameById(gameId);
  if (!game) {
    await safeReply(interaction, {
      components: [buildTextContainer(`GameDB #${gameId} was not found.`)],
      flags: buildComponentsV2Flags(true),
    });
    return;
  }

  try {
    await Member.addCompletion({
      userId,
      gameId,
      completionType,
      platformId,
      completedAt,
      finalPlaytimeHours,
      note,
    });
  } catch (err: unknown) {
    logError("CompletionHelpers.saveCompletion", err);
    await safeReply(
      interaction,
      buildErrorReply(buildApiErrorMessage("Could not save completion.", err), true),
    );
    return;
  }

  if (removeFromNowPlaying === true) {
    try {
      await Member.removeNowPlaying(userId, gameId);
    } catch {
      // Ignore cleanup errors
    }
  }

  const playtimeText = formatPlaytimeHours(finalPlaytimeHours);
  const details = [completionType, playtimeText].filter(Boolean).join(" - ");

  await safeReply(interaction, {
    components: [buildTextContainer(
      `Logged completion for **${gameTitle ?? game.title}** (${details}).`,
    )],
    flags: buildComponentsV2Flags(true),
  });

  if (removeFromNowPlaying === "prompt") {
    await promptRemoveFromNowPlaying(interaction, userId, gameId, gameTitle ?? game.title);
  }

  if (announce) {
    await announceCompletion(
      interaction,
      userId,
      game,
      completionType,
      completedAt,
      finalPlaytimeHours,
      isAdminOverride,
    );
  }
}

export async function notifyUnknownCompletionPlatform(
  interaction:
    | CommandInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  gameTitle: string,
  gameId: number,
): Promise<void> {
  try {
    const channel = await interaction.client.channels.fetch(BOT_DEV_CHANNEL_ID).catch(() => null);
    if (!channel || !("send" in channel)) {
      return;
    }
    const username = interaction.user.username ?? interaction.user.id;
    await (channel as any).send({
      content:
        `Unknown completion platform selected.\n` +
        `User: ${renderUsernameWithEmoji(interaction.user.id, username)}\n` +
        `Game: ${gameTitle} (GameDB #${gameId})`,
      allowedMentions: { parse: [] },
    });
  } catch {
    // ignore reporting errors
  }
}

export async function announceCompletion(
  interaction:
    | CommandInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  userId: string,
  game: IGame,
  completionType: CompletionType,
  completedAt: Date | null,
  finalPlaytimeHours: number | null,
  isAdminOverride: boolean = false,
): Promise<void> {
  try {
    const channel = await interaction.client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
    if (!channel || !("send" in channel)) {
      return;
    }

    const user = await safeUserFetch(interaction.client, userId);
    if (!user) {
      return;
    }

    const completions = await GameProfileService.getGameCompletions(game.id);
    const isFirst = completions.length === 1;

    const playtimeText = formatPlaytimeHours(finalPlaytimeHours);
    const effectiveDate = completedAt ?? new Date();
    const dateStr = formatTableDate(effectiveDate);
    const hoursStr = playtimeText ? ` - ${playtimeText}` : "";
    const completionYear = effectiveDate.getFullYear();
    const yearlyCount = await Member.countCompletions(userId, completionYear);
    const yearlySummary = `\nGame completion #${yearlyCount} for ${completionYear}`;
    const userName = user.displayName ?? user.username ?? user.id;
    let desc =
      `${renderUsernameWithEmoji(user.id, userName)} has added a game completion: **${game.title}** - ` +
      `${completionType} - ${dateStr}${hoursStr}` +
      yearlySummary;
    if (isAdminOverride && interaction.user.id !== userId) {
      const admin = interaction.user;
      const adminName = admin.displayName ?? admin.username ?? admin.id;
      const adminMention = renderUsernameWithEmoji(admin.id, adminName);
      const userMentionStr = renderUsernameWithEmoji(user.id, userName);
      desc =
        `${adminMention} added a game completion for ${userMentionStr}: ` +
        `**${game.title}** - ${completionType} - ${dateStr}${hoursStr}` +
        yearlySummary;
    }
    const summaryLines = [
      `### ${user.displayName ?? user.username}`,
      desc,
    ];
    if (isFirst) {
      summaryLines.push("This is the first recorded completion for this game in the club!");
    }

    const summaryText = summaryLines.join("\n\n");
    const container = new ContainerBuilder();
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(summaryText, 3500)),
    );
    const thumbnailUrl = game.coverUrl ?? null;
    if (thumbnailUrl) {
      section.setThumbnailAccessory(
        new ThumbnailBuilder().setURL(thumbnailUrl).setDescription(game.title),
      );
    }
    container.addSectionComponents(section);

    await (channel as any).send({
      components: [container],
      flags: buildComponentsV2EditFlags(),
    });
  } catch (err) {
    logError("CompletionHelpers.announceCompletion", err);
  }
}

/**
 * How a saved completion treats the game's Now Playing entry: remove it, keep it, or
 * ask the member with restart-safe buttons once the completion is saved.
 */
export type NowPlayingRemoval = boolean | "prompt";

type NowPlayingRemoveChoice = "yes" | "no";

function buildNowPlayingRemoveId(
  userId: string,
  gameId: number,
  choice: NowPlayingRemoveChoice,
): string {
  return `${NOW_PLAYING_REMOVE_CONFIRM_PREFIX}:${userId}:${gameId}:${choice}`;
}

/**
 * Asks whether to drop the game from Now Playing. The buttons carry the owner and game,
 * so the answer is handled by {@link handleNowPlayingRemoveConfirm} even after a restart.
 */
export async function promptRemoveFromNowPlaying(
  interaction:
    | CommandInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  userId: string,
  gameId: number,
  gameTitle: string,
): Promise<void> {
  const row = buildButtonRow(
    buildActionButton({
      customId: buildNowPlayingRemoveId(userId, gameId, "yes"),
      label: "Yes",
      style: ButtonStyle.Danger,
    }),
    buildActionButton({
      customId: buildNowPlayingRemoveId(userId, gameId, "no"),
      label: "No",
      style: ButtonStyle.Secondary,
    }),
  );
  // The completion is already saved, so a failed prompt must not abort the caller.
  try {
    await safeFollowUpIfSettled(interaction, {
      components: [
        buildTextContainer(`Remove **${gameTitle}** from your Now Playing list?`),
        row,
      ],
      flags: buildComponentsV2Flags(true),
    });
  } catch (err: unknown) {
    logError("CompletionHelpers.promptRemoveFromNowPlaying", err);
  }
}

export async function handleNowPlayingRemoveConfirm(
  interaction: ButtonInteraction,
): Promise<void> {
  const segs = assertCustomIdSegments(interaction, 3);
  if (!segs) return;
  const [ownerId, gameIdRaw, choice] = segs;
  if (await replyIfNotOwner(interaction, ownerId, "This prompt isn't for you.")) return;

  const gameId = Number(gameIdRaw);
  if (choice !== "yes") {
    await safeUpdate(interaction, {
      components: [buildTextContainer("Okay, I'll leave it in your Now Playing list.")],
      flags: buildComponentsV2EditFlags(),
    });
    return;
  }

  await safeDeferUpdate(interaction);
  let message = "Okay, I removed it from Now Playing.";
  try {
    const removed = await Member.removeNowPlaying(ownerId, gameId);
    if (!removed) message = "It was already off your Now Playing list.";
  } catch (err: unknown) {
    logError("CompletionHelpers.handleNowPlayingRemoveConfirm", err);
    message = buildApiErrorMessage("Could not remove it from Now Playing.", err);
  }
  await safeEditReply(interaction, {
    components: [buildTextContainer(message)],
    flags: buildComponentsV2EditFlags(),
  });
}

/**
 * Builds the "found a recent completion" warning shown before logging a duplicate.
 * Callers supply the button ids so each flow resumes through its own handler.
 */
export function buildDuplicateCompletionPrompt(
  gameTitle: string,
  existing: ICompletionRecord,
  ids: { confirm: string; cancel: string },
): { components: Array<ContainerBuilder | ReturnType<typeof buildButtonRow>>; flags: number } {
  const dateText = existing.completedAt
    ? formatDiscordTimestamp(existing.completedAt)
    : "No date";
  const playtimeText = formatPlaytimeHours(existing.finalPlaytimeHours);
  const detailParts = [existing.completionType, dateText, playtimeText].filter(Boolean);
  const noteLine = existing.note ? `\n> ${existing.note}` : "";
  const promptText =
    `We found a completion for **${gameTitle}** within the last week:\n` +
    `- ${detailParts.join(" - ")} (Completion #${existing.completionId})${noteLine}\n\n` +
    "Add another completion anyway?";
  const row = buildButtonRow(
    buildActionButton({ customId: ids.confirm, label: "Add Another", style: ButtonStyle.Danger }),
    buildActionButton("cancel", ids.cancel),
  );
  return {
    components: [buildTextContainer(promptText), row],
    flags: buildComponentsV2Flags(true),
  };
}
