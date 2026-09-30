import {
  StringSelectMenuBuilder,
  type ActionRowBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { ContainerBuilder } from "@discordjs/builders";
import Member from "../../classes/Member.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";
import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";
import { GAMEDB_NOWPLAYING_PLATFORM_SELECT_PREFIX } from "../../config/customIdPrefixes.js";
import {
  buildComponentsV2Flags,
  buildErrorReply,
  buildTextContainer,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { buildSelectOptions, buildSelectRow } from "../../functions/uiComponents.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";

export interface IStartPlayingEntry {
  gameId: number;
  title: string;
  platformId: number | null;
  platformName: string | null;
  note: string | null;
}

export interface INowPlayingPlatformPrompt {
  components: Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>>;
  flags: number;
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
): Promise<INowPlayingPlatformPrompt | null> {
  const platforms = await GamePlatformRegionService
    .getPlatformsForGameWithStandard(gameId, STANDARD_PLATFORM_IDS);
  if (!platforms.length) return null;
  const options = buildSelectOptions(platforms.map((platform) => ({
    label: platform.name,
    value: String(platform.id),
  })));
  const select = new StringSelectMenuBuilder()
    // eslint-disable-next-line local/custom-id-has-matching-handler
    .setCustomId(buildGameDbNowPlayingPlatformSelectCustomId(gameId))
    .setPlaceholder("Select the platform")
    .addOptions(options);
  return {
    components: [
      buildTextContainer(`Select the platform for **${title}**.`),
      buildSelectRow(select),
    ],
    flags: buildComponentsV2Flags(true),
  };
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
      buildErrorReply(buildApiErrorMessage("Failed to add to Now Playing.", err), true),
    );
    return;
  }

  const platformLabel = entry.platformName ?? "Unknown platform";
  await safeReply(interaction, buildTextReply(
    `Added **${entry.title}** (${platformLabel}) to your Now Playing list.`,
    true,
  ));
}
