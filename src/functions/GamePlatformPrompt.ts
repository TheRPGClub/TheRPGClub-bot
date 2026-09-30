import { StringSelectMenuBuilder, type ActionRowBuilder } from "discord.js";
import type { ContainerBuilder } from "@discordjs/builders";
import GamePlatformRegionService from "../classes/GamePlatformRegionService.js";
import { STANDARD_PLATFORM_IDS } from "../config/standardPlatforms.js";
import { buildComponentsV2Flags, buildTextContainer } from "./ComponentsV2Utils.js";
import { buildSelectOptions, buildSelectRow } from "./uiComponents.js";

export interface IGamePlatformPrompt {
  components: Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>>;
  flags: number;
}

/**
 * Ephemeral "Select the platform for <game>" picker, standard platforms first. Returns null
 * when the game has no platform data. The caller's custom id must carry the game id so the
 * picker survives a restart.
 */
export async function buildGamePlatformPromptPayload(params: {
  gameId: number;
  title: string;
  customId: string;
  placeholder: string;
}): Promise<IGamePlatformPrompt | null> {
  const platforms = await GamePlatformRegionService
    .getPlatformsForGameWithStandard(params.gameId, STANDARD_PLATFORM_IDS);
  if (!platforms.length) return null;
  const options = buildSelectOptions(platforms.map((platform) => ({
    label: platform.name,
    value: String(platform.id),
  })));
  const select = new StringSelectMenuBuilder()
    // eslint-disable-next-line local/custom-id-has-matching-handler
    .setCustomId(params.customId)
    .setPlaceholder(params.placeholder)
    .addOptions(options);
  return {
    components: [
      buildTextContainer(`Select the platform for **${params.title}**.`),
      buildSelectRow(select),
    ],
    flags: buildComponentsV2Flags(true),
  };
}
