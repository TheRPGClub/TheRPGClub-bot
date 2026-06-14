import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputStyle,
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
import Game, { type GameSource } from "../../classes/Game.js";
import { searchHltb } from "../../scripts/SearchHltb.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
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
  buildTextInputRow,
} from "../../functions/uiComponents.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import UserGameBacklog from "../../classes/UserGameBacklog.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";

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

    const source: GameSource = "API";
    const searchTerm = sanitizeUserInput(query, { preserveNewlines: false });

    if (source === "API") {
      const gameId = /^\d+$/.test(searchTerm) ? Number(searchTerm) : NaN;
      if (!isPositiveInt(gameId)) {
        await safeReply(interaction, buildTextReply("API source requires a numeric game ID.", false));
        return;
      }
      await showGameProfile(interaction, gameId, undefined);
      return;
    }

    if (/^\d+$/.test(searchTerm)) {
      const gameId = Number(searchTerm);
      if (isPositiveInt(gameId)) {
        const game = await Game.getGameById(gameId, source);
        if (game) {
          await showGameProfile(interaction, gameId, undefined);
          return;
        }
      }
    }
    await runSearchFlow(interaction, searchTerm);
  }

  @ButtonComponent({
    id: /^gamedb-action:(nowplaying|video|hltb-import|backlog):\d+$/,
  })
  async handleGameDbAction(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [action, gameIdRaw] = segs;
    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid GameDB id.", true));
      return;
    }

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
      const modal = new ModalBuilder()
        // eslint-disable-next-line local/custom-id-has-matching-handler
        .setCustomId(`gamedb-nowplaying-modal:${gameId}`)
        .setTitle("Add to Now Playing")
        .addComponents(
          buildTextInputRow({
            customId: "gamedb-nowplaying-note",
            label: "Note (optional)",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: 500,
          }),
        );
      safeIgnore(interaction.showModal(modal));
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
      const platforms = await Game.getPlatformsForGame(gameId);
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
        buildTextReply(buildApiErrorMessage("Failed to add backlog entry.", err), true),
      );
    }
  }
}
