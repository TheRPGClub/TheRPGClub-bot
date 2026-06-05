import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  type ButtonInteraction,
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
  ContainerBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import { shouldRenderPrevNextButtons } from "../../functions/PaginationUtils.js";
import Game from "../../classes/Game.js";
import {
  buildComponentsV2Flags,
  buildSearchCustomId,
  buildSearchRecoveryComponents,
  decodeSearchQuery,
  GAME_SEARCH_PAGE_SIZE,
} from "./gamedb-utils.js";
import {
  buildGameProfile,
  buildGameProfileActionRow,
  showGameProfile,
  trimTextDisplayContent,
} from "./gamedb-profile.service.js";
import { handleNoResults } from "./gamedb-add.command.js";

export async function runSearchFlow(
  interaction: CommandInteraction,
  searchTerm: string,
  rawQuery?: string,
): Promise<void> {
  const results = await Game.searchGames(searchTerm);

  if (results.length === 0) {
    await handleNoResults(interaction, searchTerm || rawQuery || "Unknown");
    return;
  }

  if (results.length === 1) {
    await showGameProfile(interaction, results[0].id);
    return;
  }

  const response = buildSearchResponse(searchTerm, results, interaction.user.id, 0, true);

  await safeReply(interaction, response);
}

function buildSearchResponse(
  searchTerm: string,
  results: any[],
  ownerId: string,
  page: number,
  includeList: boolean,
): { components: Array<ContainerBuilder | ActionRowBuilder<any>>; flags: number } {
  const totalPages = Math.max(
    1,
    Math.ceil(results.length / GAME_SEARCH_PAGE_SIZE),
  );
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * GAME_SEARCH_PAGE_SIZE;
  const displayedResults = results.slice(start, start + GAME_SEARCH_PAGE_SIZE);
  const titleCounts = new Map<string, number>();
  results.forEach((game) => {
    const title = String(game.title ?? "");
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  });
  const resultList = displayedResults.map((game) => {
    const title = String(game.title ?? "");
    const isDuplicate = (titleCounts.get(title) ?? 0) > 1;
    if (!isDuplicate) {
      return `• **${title}**`;
    }
    const releaseDate = game.initialReleaseDate as Date | null | undefined;
    const year = releaseDate instanceof Date
      ? releaseDate.getFullYear()
      : releaseDate
        ? new Date(releaseDate).getFullYear()
        : null;
    const yearText = year ? ` (${year})` : " (Unknown Year)";
    return `• **${title}**${yearText}`;
  }).join("\n");

  const title = searchTerm
    ? `Search Results for "${searchTerm}" (Page ${safePage + 1}/${totalPages})`
    : `All Games (Page ${safePage + 1}/${totalPages})`;

  const selectCustomId = buildSearchCustomId("select", ownerId, safePage, searchTerm);
  const options = displayedResults.map((game) => {
    const gameTitle = String(game.title ?? "");
    const isDuplicate = (titleCounts.get(gameTitle) ?? 0) > 1;
    let label = gameTitle;
    if (isDuplicate) {
      const releaseDate = game.initialReleaseDate as Date | null | undefined;
      const year = releaseDate instanceof Date
        ? releaseDate.getFullYear()
        : releaseDate
          ? new Date(releaseDate).getFullYear()
          : null;
      const yearText = year ? ` (${year})` : " (Unknown Year)";
      label = `${gameTitle}${yearText}`;
    }
    return {
      label: label.substring(0, 100),
      value: String(game.id),
      description: "View this game",
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(selectCustomId)
    .setPlaceholder("Select a game to view details")
    .addOptions(options);

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const prevDisabled = safePage === 0;
  const nextDisabled = safePage >= totalPages - 1;

  const prevButton = new ButtonBuilder()
    .setCustomId(buildSearchCustomId("page", ownerId, safePage, searchTerm, "prev"))
    .setLabel("Previous Page")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(prevDisabled);

  const nextButton = new ButtonBuilder()
    .setCustomId(buildSearchCustomId("page", ownerId, safePage, searchTerm, "next"))
    .setLabel("Next Page")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(nextDisabled);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);
  const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [];
  if (includeList) {
    const listText = resultList || "No results.";
    const content = trimTextDisplayContent(
      `## ${title}\n\n${listText}\n\n*${results.length} results total*`,
    );
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );
    components.push(container);
  }
  components.push(selectRow);

  if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
    components.push(buttonRow);
  }

  return {
    components,
    flags: buildComponentsV2Flags(false),
  };
}

@Discord()
@SlashGroup("gamedb")
export class GameDbSearchCommand {
  @Slash({ description: "Search for a game", name: "search" })
  async search(
    @SlashOption({
      description: "Search query (game title).",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    query: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

    try {
      const searchTerm = sanitizeUserInput(query, { preserveNewlines: false });
      await runSearchFlow(interaction, searchTerm, query);
    } catch (error: any) {
      await safeReply(interaction, {
        content: `Failed to search games. Error: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @SelectMenuComponent({ id: /^gamedb-search-select:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async handleSearchSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const page = Number(parts[2]);
    const encodedQuery = parts[3] ?? "";

    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
          content: "This menu isn't for you.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const searchTerm = sanitizeUserInput(
      decodeSearchQuery(encodedQuery),
      { preserveNewlines: false },
    );
    if (!searchTerm) {
      const components = buildSearchRecoveryComponents(ownerId, encodedQuery);
      await safeReply(interaction, {
        content: "This search request expired. Refresh to run it again.",
        components,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const results = await Game.searchGames(searchTerm);

    const gameId = Number(interaction.values?.[0]);
    if (!Number.isFinite(gameId)) {
      await safeReply(interaction, {
          content: "Invalid selection.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    try {
      await safeDeferUpdate(interaction);
    } catch {
      // ignore
    }

    const profile = await buildGameProfile(gameId, interaction);
    if (!profile) {
      await safeReply(interaction, {
        __forceFollowUp: true,
        content: "Unable to load that game.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const response = buildSearchResponse(searchTerm, results, ownerId, page, false);
    const actionRows = buildGameProfileActionRow(
      gameId,
      profile.hasThread,
      profile.featuredVideoUrl,
      profile.canMarkThumbnailBad,
      profile.isThumbnailBad,
      profile.isThumbnailApproved,
      profile.isReleased,
    );

    try {
      await safeReply(interaction, {
        embeds: [],
        files: profile.files,
        components: [...profile.components, ...actionRows, ...response.components],
        flags: response.flags,
      });
    } catch {
      // ignore update failures
    }
  }

  @ButtonComponent({ id: /^gamedb-search-page:\d+:\d+:[A-Za-z0-9_-]*:(next|prev)$/ })
  async handleSearchPage(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const page = Number(parts[2]);
    const encodedQuery = parts[3] ?? "";
    const direction = parts[4];

    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
          content: "This menu isn't for you.",
          flags: MessageFlags.Ephemeral,
        });
      return;
    }

    const searchTerm = sanitizeUserInput(
      decodeSearchQuery(encodedQuery),
      { preserveNewlines: false },
    );
    if (!searchTerm) {
      const components = buildSearchRecoveryComponents(ownerId, encodedQuery);
      await safeReply(interaction, {
        content: "This search request expired. Refresh to run it again.",
        components,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const results = await Game.searchGames(searchTerm);
    const totalPages = Math.max(
      1,
      Math.ceil(results.length / GAME_SEARCH_PAGE_SIZE),
    );
    const delta = direction === "next" ? 1 : -1;
    const newPage = Math.min(Math.max(page + delta, 0), totalPages - 1);

    try {
      await safeDeferUpdate(interaction);
    } catch {
      // ignore
    }

    const response = buildSearchResponse(searchTerm, results, ownerId, newPage, true);

    try {
      await safeReply(interaction, response);
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^gamedb-search-refresh:\d+:[A-Za-z0-9_-]*$/ })
  async handleSearchRefresh(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const encodedQuery = parts[2] ?? "";

    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This refresh button isn't for you.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const searchTerm = sanitizeUserInput(
      decodeSearchQuery(encodedQuery),
      { preserveNewlines: false },
    );
    if (!searchTerm) {
      await safeReply(interaction, {
        content: "Unable to refresh: search details were not found.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const results = await Game.searchGames(searchTerm);
    if (results.length === 0) {
      await safeReply(interaction, {
        content: `No results found for "${searchTerm}".`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const response = buildSearchResponse(searchTerm, results, ownerId, 0, true);
    await safeUpdate(interaction, response);
  }
}
