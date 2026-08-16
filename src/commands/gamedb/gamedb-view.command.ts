import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import { getHltbCacheByGameId, upsertHltbCache } from "../../classes/HltbCache.js";
import Game from "../../classes/Game.js";
import { apiPost } from "../../services/RpgClubApiClient.js";
import { searchHltb } from "../../scripts/SearchHltb.js";
import {
  buildErrorReply,
  buildTextContainer,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import {
  autocompleteGameDbViewTitle,
  buildComponentsV2Flags,
  getSearchRowsFromComponents,
  isHltbImportEligible,
} from "./gamedb-utils.js";
import {
  buildGameProfile,
  buildGameProfileActionRow,
  refreshGameProfileMessage,
  showGameProfile,
} from "./gamedb-profile.service.js";
import { runSearchFlow } from "./gamedb-search.command.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import {
  buildSelectOptions,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import UserGameBacklog from "../../classes/UserGameBacklog.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";
import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";

@Discord()
@SlashGroup("gamedb")
export class GameDbViewCommand {
  @Slash({ description: "View details of a game", name: "view" })
  async view(
    @SlashOption({
      description: "Search query (falls back to search flow if no ID provided)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
      autocomplete: autocompleteGameDbViewTitle,
    })
    query: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

    const searchTerm = sanitizeUserInput(query, { preserveNewlines: false });
    const gameId = /^\d+$/.test(searchTerm) ? Number(searchTerm) : NaN;

    if (isPositiveInt(gameId)) {
      await showGameProfile(interaction, gameId, undefined);
      return;
    }

    await runSearchFlow(interaction, searchTerm);
  }

  @ButtonComponent({
    id: /^gamedb-action:(nowplaying|video|hltb-import|backlog|igdb-import):\d+$/,
  })
  async handleGameDbAction(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [action, idRaw] = segs;
    const numericId = Number(idRaw);
    if (!isPositiveInt(numericId)) {
      await safeReply(interaction, buildTextReply("Invalid id.", true));
      return;
    }

    if (action === "igdb-import") {
      await safeDeferUpdate(interaction);
      let result: { data: { game_id: number } } | null;
      try {
        result = await apiPost<{ data: { game_id: number } }>(
          "/api/v1/games",
          { igdb_id: numericId },
        );
      } catch (err) {
        await safeReply(interaction, {
          ...buildErrorReply(buildApiErrorMessage("Failed to import game.", err), true),
          __forceFollowUp: true,
        });
        return;
      }
      if (!result) {
        await safeReply(interaction, {
          ...buildTextReply(`No IGDB game found with id ${numericId}.`, true),
          __forceFollowUp: true,
        });
        return;
      }
      await refreshGameProfileMessage(interaction, result.data.game_id);
      return;
    }

    const gameId = numericId;
    const game = await Game.getGameById(gameId);
    if (!game) {
      await safeReply(interaction, {
        ...buildTextReply(`No game found with ID ${gameId}.`, true),
        __forceFollowUp: true,
      });
      return;
    }

    if (action === "video") {
      const videoUrl = game.featuredVideoUrl;
      if (!videoUrl) {
        await safeReply(interaction, buildTextReply(
          "No featured video is available for this game.", true,
        ));
        return;
      }
      let updatedMessage = false;
      const profile = await buildGameProfile(gameId, interaction);
      if (profile) {
        const actionRows = buildGameProfileActionRow(
          gameId,
          profile.featuredVideoUrl,
          true,
        );
        const existingComponents = interaction.message?.components ?? [];
        const searchRows = getSearchRowsFromComponents(existingComponents);
        try {
          await safeUpdate(interaction, {
            files: profile.files,
            components: [...profile.components, ...actionRows, ...searchRows],
            flags: buildComponentsV2Flags(false),
          });
          updatedMessage = true;
        } catch {
          // fall through to deferUpdate
        }
      }
      if (!updatedMessage) {
        await safeDeferUpdate(interaction);
      }
      // Exception: v1 plain-text reply used intentionally so Discord auto-embeds
      // the YouTube URL, enabling inline video preview. Components V2 suppresses embeds.
      // eslint-disable-next-line local/no-plain-text-v1-reply
      await safeReply(interaction, {
        content: `Warning: videos may contain spoilers. ${videoUrl}`,
        __forceFollowUp: true,
      });
      return;
    }

    if (action === "nowplaying") {
      const platforms = await GamePlatformRegionService
        .getPlatformsForGameWithStandard(gameId, STANDARD_PLATFORM_IDS);
      if (!platforms.length) {
        await safeReply(interaction, buildTextReply(
          "This game has no platform data yet. Add to Now Playing from " +
            "`/now-playing list` after platform data is available.", true,
        ));
        return;
      }
      const options = buildSelectOptions(platforms.map((platform) => ({
        label: platform.name,
        value: String(platform.id),
      })));
      const select = new StringSelectMenuBuilder()
        // eslint-disable-next-line local/custom-id-has-matching-handler
        .setCustomId(`gamedb-nowplaying-platform-select:${gameId}`)
        .setPlaceholder("Select the platform")
        .addOptions(options);
      await safeReply(interaction, {
        components: [
          buildTextContainer(`Select the platform for **${game.title}**.`),
          buildSelectRow(select),
        ],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (action === "hltb-import") {
      await safeDeferUpdate(interaction);
      const hltbCache = await getHltbCacheByGameId(gameId);
      if (isHltbImportEligible(game, Boolean(hltbCache))) {
        const scraped = await searchHltb(game.title);
        if (scraped) {
          await upsertHltbCache(gameId, {
            name: scraped.name,
            url: scraped.url,
            imageUrl: scraped.imageUrl ?? null,
            main: scraped.main,
            mainSides: scraped.mainSides,
            completionist: scraped.completionist,
            singlePlayer: scraped.singlePlayer,
            coOp: scraped.coOp,
            vs: scraped.vs,
            sourceQuery: game.title,
          });
        }
      }
      await refreshGameProfileMessage(interaction, gameId);
      return;
    }

    if (action === "backlog") {
      await this.handleAddToBacklog(interaction, gameId);
      return;
    }
  }

  private async handleAddToBacklog(
    interaction: ButtonInteraction,
    gameId: number,
  ): Promise<void> {
    try {
      const platforms = await GamePlatformRegionService.getPlatformsForGame(gameId);
      const validPlatforms = platforms.filter(
        (p) => p.name?.trim() && String(p.id)?.trim(),
      );
      if (!validPlatforms.length) {
        await this.addBacklogEntry(interaction, gameId, null);
        return;
      }

      const options = buildSelectOptions(
        validPlatforms.map((p) => ({ label: p.name, value: String(p.id) })),
      );
      const select = new StringSelectMenuBuilder()
        .setCustomId(`gamedb-backlog-platform:${gameId}`)
        .setPlaceholder("Select a platform for your backlog")
        .addOptions(options);

      await safeReply(interaction, {
        components: [buildSelectRow(select)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: unknown) {
      logError("gamedb view.load_platform_options_failed", err);
      await safeReply(
        interaction,
        buildTextReply("Failed to load platform options. Please try again.", true),
      );
    }
  }

  @SelectMenuComponent({ id: /^gamedb-backlog-platform:\d+$/ })
  async handleBacklogPlatformSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const gameId = Number(segs[0]);
    const platformId = Number(interaction.values[0]);
    if (!isPositiveInt(gameId) || !isPositiveInt(platformId)) {
      await safeReply(interaction, buildTextReply("Invalid backlog selection.", true));
      return;
    }
    await this.addBacklogEntry(interaction, gameId, platformId);
  }

  private async addBacklogEntry(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    gameId: number,
    platformId: number | null,
  ): Promise<void> {
    try {
      const created = await UserGameBacklog.addEntry({
        userId: interaction.user.id,
        gameId,
        platformId,
      });
      const platformLabel = created.platformName
        ?? (platformId ? `Platform #${platformId}` : "");
      const platformSuffix = platformLabel ? ` (${platformLabel})` : "";
      await safeReply(
        interaction,
        buildTextReply(`Added **${created.title}**${platformSuffix} to your backlog.`, true),
      );
    } catch (err: unknown) {
      logError("gamedb view.add_backlog_failed", err);
      await safeReply(
        interaction,
        buildErrorReply(buildApiErrorMessage("Failed to add backlog entry.", err), true),
      );
    }
  }
}
