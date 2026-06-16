import {
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import Game from "../../classes/Game.js";
import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";
import { DISCORD_SELECT_OPTIONS_MAX, truncateLabel } from "../../config/textLimits.js";
import { safeReply, safeUpdate } from "../../functions/InteractionUtils.js";
import { buildSelectRow } from "../../functions/uiComponents.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
} from "../../functions/ComponentsV2Utils.js";
import { nowPlayingAddPlatformSessions } from "./nowPlayingContexts.js";
import { NOW_PLAYING_ADD_PLATFORM_SELECT_PREFIX } from "./nowPlayingIds.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";

export async function promptNowPlayingAddPlatformSelection(
  interaction: StringSelectMenuInteraction,
  sourceSessionId: string,
  userId: string,
  gameId: number,
  note: string | null,
  mode: "reply" | "update",
): Promise<void> {
  const game = await Game.getGameById(gameId);
  if (!game) {
    throw new Error("Selected game not found. Please try again.");
  }
  const platforms = await GamePlatformRegionService
    .getPlatformsForGameWithStandard(game.id, STANDARD_PLATFORM_IDS);
  if (!platforms.length) {
    throw new Error("No platform data is available for this game.");
  }
  const platformSessionId = `np-add-platform-${userId}`;
  nowPlayingAddPlatformSessions.set(platformSessionId, {
    userId,
    gameId,
    note,
    sourceSessionId,
  });
  const options = platforms.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((platform) => ({
    label: truncateLabel(platform.name),
    value: String(platform.id),
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${NOW_PLAYING_ADD_PLATFORM_SELECT_PREFIX}:${platformSessionId}`)
    .setPlaceholder("Select the platform")
    .addOptions(options);
  const titleWithCap = platforms.length > options.length
    ? `Select the platform for **${game.title}** (showing first ${options.length}).`
    : `Select the platform for **${game.title}**.`;
  const container = buildTextContainer(titleWithCap);
  const payload = {
    components: [
      container,
      buildSelectRow(select),
    ],
    flags: buildComponentsV2Flags(true),
  };
  if (mode === "update") {
    await safeUpdate(interaction, payload);
  } else {
    await safeReply(interaction, payload);
  }
}
