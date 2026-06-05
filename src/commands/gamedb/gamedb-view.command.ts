import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  Slash,
  SlashChoice,
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
  requireModeratorOrAdminOrOwner,
} from "./gamedb-utils.js";
import {
  buildGameProfile,
  buildGameProfileActionRow,
  refreshGameProfileMessage,
  showGameProfile,
} from "./gamedb-profile.service.js";
import { runSearchFlow } from "./gamedb-search.command.js";
import { startCompletionWizard } from "./gamedb-completion.command.js";
import { showNowPlayingThreadModal } from "./gamedb-thread.command.js";

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
    @SlashChoice({ name: "oracle", value: "oracle" }, { name: "api", value: "api" })
    @SlashOption({
      description: "Data source for the game lookup (default: oracle)",
      name: "source",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    sourceChoice: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

    const source: GameSource = sourceChoice === "api" ? "API" : "oracleSQL";
    const searchTerm = sanitizeUserInput(query, { preserveNewlines: false });

    if (source === "API") {
      const gameId = /^\d+$/.test(searchTerm) ? Number(searchTerm) : NaN;
      if (!Number.isInteger(gameId) || gameId <= 0) {
        await safeReply(interaction, buildTextReply("API source requires a numeric game ID.", false));
        return;
      }
      await showGameProfile(interaction, gameId, undefined, "API");
      return;
    }

    if (/^\d+$/.test(searchTerm)) {
      const gameId = Number(searchTerm);
      if (Number.isInteger(gameId) && gameId > 0) {
        const game = await Game.getGameById(gameId, source);
        if (game) {
          await showGameProfile(interaction, gameId, undefined, source);
          return;
        }
      }
    }
    await runSearchFlow(interaction, searchTerm);
  }

  @ButtonComponent({
    id: /^gamedb-action:(nowplaying|completion|thread|video|hltb-import|bad-thumb|good-thumb):\d+$/,
  })
  async handleGameDbAction(interaction: ButtonInteraction): Promise<void> {
    const [, action, gameIdRaw] = interaction.customId.split(":");
    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
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
          profile.hasThread,
          profile.featuredVideoUrl,
          profile.canMarkThumbnailBad,
          profile.isThumbnailBad,
          profile.isThumbnailApproved,
          profile.isReleased,
          true,
        );
        const existingComponents = interaction.message?.components ?? [];
        const searchRows = getSearchRowsFromComponents(existingComponents);
        try {
          await safeUpdate(interaction, {
            embeds: [],
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
      await safeReply(interaction, {
        ...buildTextReply(`Warning: videos may contain spoilers. ${videoUrl}`, false),
        __forceFollowUp: true,
      });
      return;
    }

    if (action === "bad-thumb" || action === "good-thumb") {
      const hasAccess = await requireModeratorOrAdminOrOwner(interaction);
      if (!hasAccess) {
        return;
      }
    }

    if (action === "bad-thumb") {
      if (!game.imageData) {
        await safeReply(interaction, buildTextReply(
          "No cover image is available for this game.", true,
        ));
        return;
      }
      if (game.thumbnailBad) {
        await safeReply(interaction, buildTextReply("This thumbnail is already marked as bad.", true));
        return;
      }
      await safeDeferUpdate(interaction);
      await Game.updateGameThumbnailBad(gameId, true);
      await Game.updateGameThumbnailApproved(gameId, false);
      await refreshGameProfileMessage(interaction, gameId);
      await safeReply(interaction, {
        ...buildTextReply("Thumbnail flagged. GameDB view will use cover art from now on.", true),
        __forceFollowUp: true,
      });
      return;
    }

    if (action === "good-thumb") {
      if (!game.imageData) {
        await safeReply(interaction, buildTextReply(
          "No cover image is available for this game.", true,
        ));
        return;
      }
      if (game.thumbnailApproved) {
        await safeReply(interaction, buildTextReply(
          "This thumbnail is already marked as approved.", true,
        ));
        return;
      }
      await safeDeferUpdate(interaction);
      await Game.updateGameThumbnailBad(gameId, false);
      await Game.updateGameThumbnailApproved(gameId, true);
      await refreshGameProfileMessage(interaction, gameId);
      await safeReply(interaction, {
        ...buildTextReply("Thumbnail marked as good. GameDB view will keep using artwork.", true),
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
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("gamedb-nowplaying-note")
              .setLabel("Note (optional)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(500),
          ),
        );
      await interaction.showModal(modal).catch(() => {});
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

    if (action === "completion") {
      await startCompletionWizard(interaction, gameId, game.title);
      return;
    }

    if (action === "thread") {
      await showNowPlayingThreadModal(interaction, gameId, game.title);
      return;
    }
  }
}
