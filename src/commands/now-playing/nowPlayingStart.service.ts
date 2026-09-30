import type { ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import Member from "../../classes/Member.js";
import { GAMEDB_NOWPLAYING_PLATFORM_SELECT_PREFIX } from "../../config/customIdPrefixes.js";
import { buildErrorReply, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import {
  buildGamePlatformPromptPayload,
  type IGamePlatformPrompt,
} from "../../functions/GamePlatformPrompt.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";

export interface IStartPlayingEntry {
  gameId: number;
  title: string;
  platformId: number | null;
  platformName: string | null;
  note: string | null;
}

export function buildGameDbNowPlayingPlatformSelectCustomId(gameId: number): string {
  return `${GAMEDB_NOWPLAYING_PLATFORM_SELECT_PREFIX}:${gameId}`;
}

/**
 * Platform picker handled by `gamedb-nowplaying-platform-select` in gamedb-completion.
 * The game id rides in the custom id, so the picker survives a restart.
 */
export async function buildNowPlayingPlatformPromptPayload(
  gameId: number,
  title: string,
): Promise<IGamePlatformPrompt | null> {
  return buildGamePlatformPromptPayload({
    gameId,
    title,
    customId: buildGameDbNowPlayingPlatformSelectCustomId(gameId),
    placeholder: "Select the platform",
  });
}

/**
 * Adds a backlog or collection entry to the member's Now Playing list. An entry without a
 * platform falls back to the GameDB platform picker instead of failing.
 */
export async function startPlayingEntry(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entry: IStartPlayingEntry,
): Promise<void> {
  if (!entry.platformId) {
    const prompt = await buildNowPlayingPlatformPromptPayload(entry.gameId, entry.title);
    await safeReply(interaction, prompt ?? buildTextReply(
      `**${entry.title}** has no platform data yet, so it cannot be added to Now Playing.`,
      true,
    ));
    return;
  }

  try {
    await Member.addNowPlaying(interaction.user.id, entry.gameId, entry.platformId, entry.note);
  } catch (err: unknown) {
    await safeReply(
      interaction,
      buildErrorReply(buildApiErrorMessage("Failed to add to Now Playing", err), true),
    );
    return;
  }

  const platformLabel = entry.platformName ?? "Unknown platform";
  await safeReply(interaction, buildTextReply(
    `Added **${entry.title}** (${platformLabel}) to your Now Playing list.`,
    true,
  ));
}
