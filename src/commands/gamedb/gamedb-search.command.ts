import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  CommandInteraction,
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
import { buildTextReply, safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import { shouldRenderPrevNextButtons } from "../../functions/PaginationUtils.js";
import Game from "../../classes/Game.js";
import {
  autocompleteSearchPlatform,
  buildComponentsV2Flags,
  buildSearchCustomId,
  buildSearchRecoveryComponents,
  decodeISearchFilters,
  decodeSearchQuery,
  GAME_SEARCH_PAGE_SIZE,
  type ISearchFilters,
} from "./gamedb-utils.js";
import {
  buildGameProfile,
  buildGameProfileActionRow,
  showGameProfile,
  trimTextDisplayContent,
} from "./gamedb-profile.service.js";
import { handleNoResults } from "./gamedb-add.command.js";

function formatUpcomingDate(date: Date | null | undefined): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `\`${mm}/${dd}/${yyyy}\``;
}

async function buildFilterSummary(filters: ISearchFilters): Promise<string> {
  const parts: string[] = [];
  if (filters.upcomingRelease) parts.push("Upcoming release");
  if (filters.platformId) {
    const platform = await Game.getPlatformById(filters.platformId);
    parts.push(`Platform: ${platform?.name ?? `ID ${filters.platformId}`}`);
  }
  if (filters.year) parts.push(`Year: ${filters.year}`);
  return parts.join(" | ");
}

export async function runSearchFlow(
  interaction: CommandInteraction,
  searchTerm: string,
  rawQuery?: string,
  filters?: ISearchFilters,
): Promise<void> {
  const activeFilters = filters ?? {};
  const results = await Game.searchGames(searchTerm, activeFilters);

  if (results.length === 0) {
    if (!searchTerm) {
      await safeReply(interaction, buildTextReply("No games found matching your filters.", true));
    } else {
      await handleNoResults(interaction, searchTerm || rawQuery || "Unknown");
    }
    return;
  }

  if (results.length === 1 && searchTerm && !Object.keys(activeFilters).length) {
    await showGameProfile(interaction, results[0].id);
    return;
  }

  const filterSummary = Object.keys(activeFilters).length
    ? await buildFilterSummary(activeFilters)
    : "";
  const response = buildSearchResponse(
    searchTerm, results, interaction.user.id, 0, true, activeFilters, filterSummary,
  );

  await safeReply(interaction, response);
}

function buildSearchResponse(
  searchTerm: string,
  results: any[],
  ownerId: string,
  page: number,
  includeList: boolean,
  filters?: ISearchFilters,
  filterSummary?: string,
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
    const dateStr = formatUpcomingDate(game.upcomingReleaseDate);
    const platforms: string[] = game.upcomingReleasePlatforms ?? [];
    const platformStr = platforms.length ? ` (${platforms.join(", ")})` : "";
    const datePart = dateStr ? `${dateStr} ` : "";
    return `• ${datePart}**${title}**${platformStr}`;
  }).join("\n");

  const title = searchTerm
    ? `Search Results for "${searchTerm}" (Page ${safePage + 1}/${totalPages})`
    : `Upcoming Releases (Page ${safePage + 1}/${totalPages})`;

  const selectCustomId = buildSearchCustomId("select", ownerId, safePage, searchTerm, undefined, filters);
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
    const upcomingDate = game.upcomingReleaseDate as Date | null | undefined;
    const dateLabel = upcomingDate
      ? (() => {
        const d = upcomingDate instanceof Date ? upcomingDate : new Date(upcomingDate);
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        const yyyy = d.getUTCFullYear();
        return `${mm}/${dd}/${yyyy}`;
      })()
      : null;
    const releasePlatforms: string[] = game.upcomingReleasePlatforms
      ?? (game.platforms ?? []).map((p: any) => p.abbreviation ?? p.name);
    const platformLabel = releasePlatforms.length ? ` (${releasePlatforms.join(", ")})` : "";
    const description = dateLabel ? `${dateLabel}${platformLabel}` : undefined;
    return {
      label: label.substring(0, 100),
      value: String(game.id),
      ...(description ? { description: description.substring(0, 100) } : {}),
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

    .setCustomId(buildSearchCustomId("page", ownerId, safePage, searchTerm, "prev", filters))
    .setLabel("Previous Page")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(prevDisabled);

  const nextButton = new ButtonBuilder()

    .setCustomId(buildSearchCustomId("page", ownerId, safePage, searchTerm, "next", filters))
    .setLabel("Next Page")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(nextDisabled);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);
  const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [];
  if (includeList) {
    const filterNote = filterSummary ? `\n*Filters: ${filterSummary}*` : "";
    const listText = resultList || "No results.";
    const content = trimTextDisplayContent(
      `## ${title}\n\n${listText}\n\n*${results.length} results total*${filterNote}`,
    );
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
    );
    components.push(container);
  }
  components.push(selectRow);

  if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {

    components.push(buttonRow);
  }

  return {
    // eslint-disable-next-line local/dynamic-components-require-chunking
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
      description: "Search query (game title). Optional if other filters are provided.",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | null,
    @SlashOption({
      description: "Filter to games with any upcoming release (including games already out on other platforms).",
      name: "upcoming_release",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    upcomingRelease: boolean | null,
    @SlashOption({
      description: "Filter to a specific platform.",
      name: "platform",
      required: false,
      type: ApplicationCommandOptionType.String,
      autocomplete: async (interaction: AutocompleteInteraction) => {
        await autocompleteSearchPlatform(interaction);
      },
    })
    platformValue: string | null,
    @SlashOption({
      description: "Filter to a specific release year (uses first release date).",
      name: "year",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    year: number | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

    try {
      const searchTerm = query ? sanitizeUserInput(query, { preserveNewlines: false }) : "";
      const filters: ISearchFilters = {};
      if (upcomingRelease === true) filters.upcomingRelease = true;
      const platformId = platformValue ? Number(platformValue) : null;
      if (platformId && Number.isInteger(platformId) && platformId > 0) {
        filters.platformId = platformId;
      }
      if (year && Number.isInteger(year) && year > 0) filters.year = year;
      const hasFilters = filters.upcomingRelease || filters.platformId || filters.year;
      if (!searchTerm && !hasFilters) {
        await safeReply(interaction, buildTextReply(
          "Please provide a title or at least one filter (upcoming_release, platform, or year).", true,
        ));
        return;
      }
      await runSearchFlow(interaction, searchTerm, query ?? undefined, filters);
    } catch (error: any) {
      await safeReply(interaction, buildTextReply(
        `Failed to search games. Error: ${error.message}`, true,
      ));
    }
  }

  @SelectMenuComponent({ id: /^gamedb-search-select:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async handleSearchSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const page = Number(parts[2]);
    const encodedQuery = parts[3] ?? "";

    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply("This menu isn't for you.", true));
      return;
    }

    const searchTerm = sanitizeUserInput(
      decodeSearchQuery(encodedQuery),
      { preserveNewlines: false },
    );
    const filters = decodeISearchFilters(encodedQuery);
    const hasFilters = filters.upcomingRelease || filters.platformId || filters.year;
    if (!searchTerm && !hasFilters) {
      const recoveryComponents = buildSearchRecoveryComponents(ownerId, encodedQuery);
      const textParts = buildTextReply(
        "This search request expired. Refresh to run it again.", true,
      );
      await safeReply(interaction, {
        components: [...textParts.components, ...recoveryComponents],
        flags: textParts.flags,
      });
      return;
    }

    const results = await Game.searchGames(searchTerm, filters);

    const gameId = Number(interaction.values?.[0]);
    if (!Number.isFinite(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
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
        ...buildTextReply("Unable to load that game.", true),
        __forceFollowUp: true,
      });
      return;
    }

    const response = buildSearchResponse(searchTerm, results, ownerId, page, false, filters);
    const actionRows = buildGameProfileActionRow(
      gameId,
      profile.hasThread,
      profile.featuredVideoUrl,
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
      await safeReply(interaction, buildTextReply("This menu isn't for you.", true));
      return;
    }

    const searchTerm = sanitizeUserInput(
      decodeSearchQuery(encodedQuery),
      { preserveNewlines: false },
    );
    const filters = decodeISearchFilters(encodedQuery);
    const hasFilters = filters.upcomingRelease || filters.platformId || filters.year;
    if (!searchTerm && !hasFilters) {
      const recoveryComponents = buildSearchRecoveryComponents(ownerId, encodedQuery);
      const textParts = buildTextReply(
        "This search request expired. Refresh to run it again.", true,
      );
      await safeReply(interaction, {
        components: [...textParts.components, ...recoveryComponents],
        flags: textParts.flags,
      });
      return;
    }

    const results = await Game.searchGames(searchTerm, filters);
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

    const filterSummary = Object.keys(filters).length
      ? await buildFilterSummary(filters)
      : "";
    const response = buildSearchResponse(
      searchTerm, results, ownerId, newPage, true, filters, filterSummary,
    );

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
        ...buildTextReply("This refresh button isn't for you.", true),
        __forceFollowUp: true,
      });
      return;
    }

    const searchTerm = sanitizeUserInput(
      decodeSearchQuery(encodedQuery),
      { preserveNewlines: false },
    );
    const filters = decodeISearchFilters(encodedQuery);
    const hasFilters = filters.upcomingRelease || filters.platformId || filters.year;
    if (!searchTerm && !hasFilters) {
      await safeReply(interaction, buildTextReply(
        "Unable to refresh: search details were not found.", true,
      ));
      return;
    }

    const results = await Game.searchGames(searchTerm, filters);
    if (results.length === 0) {
      const msg = searchTerm
        ? `No results found for "${searchTerm}".`
        : "No games found matching your filters.";
      await safeReply(interaction, buildTextReply(msg, true));
      return;
    }

    const filterSummary = Object.keys(filters).length
      ? await buildFilterSummary(filters)
      : "";
    const response = buildSearchResponse(
      searchTerm, results, ownerId, 0, true, filters, filterSummary,
    );
    await safeUpdate(interaction, response);
  }
}
