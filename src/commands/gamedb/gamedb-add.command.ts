import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import axios from "axios";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import { igdbService, type IGDBGameDetails } from "../../services/IGDB/IgdbService.js";
import { createIgdbSession } from "../../services/IGDB/IgdbSelectService.js";
import type { IGame } from "../../types/GameTypes.js";
import Game from "../../classes/Game.js";
import {
  buildTextContainer,
  buildTextReply,
  safeV2TextContent,
} from "../../functions/ComponentsV2Utils.js";
import {
  autocompleteGameDbViewTitle,
  buildComponentsV2Flags,
  isUniqueConstraintError,
  isUnknownWebhookError,
} from "./gamedb-utils.js";
import { buildIgdbSelectOptions } from "./gamedb-csv-import.service.js";
import { showGameProfile, trimTextDisplayContent } from "./gamedb-profile.service.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { logError, logWarn } from "../../utilities/LogUtils.js";
import { apiPost } from "../../services/RpgClubApiClient.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";
import { importReleaseDatesFromIgdb, saveFullGameMetadata } from "../../functions/GameIgdbSync.js";

async function fetchIgdbCoverImage(details: IGDBGameDetails): Promise<Buffer | null> {
  if (!details.cover?.image_id) return null;
  try {
    const imageUrl =
      `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
    return Buffer.from(imageResponse.data);
  } catch (err) {
    logError("GamedbAddCommand.downloadCoverImage", err);
    return null;
  }
}

export async function processReleaseDates(
  gameId: number,
  releaseDates: any[],
): Promise<void> {
  if (!releaseDates || !Array.isArray(releaseDates)) {
    return;
  }

  const platformIds: number[] = [];
  for (const release of releaseDates) {
    const platformId: number | null = typeof release.platform === "number"
      ? release.platform
      : (release.platform?.id ?? null);
    if (platformId) {
      platformIds.push(platformId);
    }
  }
  const uniquePlatformIds: number[] = Array.from(new Set(platformIds));
  const platformMap = await GamePlatformRegionService.getPlatformsByIgdbIds(uniquePlatformIds);
  const missingPlatformIds = uniquePlatformIds.filter((id) => !platformMap.has(id));
  if (missingPlatformIds.length) {
    logWarn("GamedbAdd.addGame", `Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingPlatformIds.join(", ")}`);
  }

  for (const release of releaseDates) {
    const platformId: number | null = typeof release.platform === "number"
      ? release.platform
      : (release.platform?.id ?? null);
    if (!platformId || !release.region) {
      continue;
    }

    const platform = platformMap.get(platformId);
    const region = await GamePlatformRegionService.ensureRegion(release.region);

    if (!platform || !region) {
      continue;
    }

    try {
      await Game.addReleaseInfo(
        gameId,
        platform.id,
        region.id,
        "Physical",
        release.date ? new Date(release.date * 1000) : null,
        null,
      );
    } catch (err) {
      logError("GamedbAddCommand.addRelease", err);
    }
  }
}

export async function addGameToDatabase(
  interaction: CommandInteraction | StringSelectMenuInteraction,
  igdbId: number,
  opts?: { selectionMessage?: import("discord.js").Message | null; showProfile?: boolean },
): Promise<void> {
  const details = await igdbService.getGameDetails(igdbId);
  if (!details) {
    const msg = "Failed to fetch details from IGDB.";
    const payload = { content: msg };
    try {
      if (interaction.isMessageComponent()) {
        await safeReply(interaction, { ...payload, __forceFollowUp: true });
      } else {
        await safeReply(interaction, payload);
      }
    } catch (err) {
      if (isUnknownWebhookError(err)) {
        await safeReply(interaction, { ...payload, __forceFollowUp: true });
      } else {
        throw err;
      }
    }
    return;
  }

  const imageData = await fetchIgdbCoverImage(details);

  const igdbUrl = details.url
    || (details.slug ? `https://www.igdb.com/games/${details.slug}` : null);
  let newGame;
  try {
    newGame = await Game.createGame(
      details.name,
      details.summary || null,
      imageData,
      details.id,
      details.slug,
      details.total_rating ?? null,
      igdbUrl,
      Game.getFeaturedVideoUrl(details),
    );
  } catch (err: any) {
    if (isUniqueConstraintError(err)) {
      const msg = "This game has already been imported.";
      const payload = { content: msg };
      try {
        if (interaction.isMessageComponent()) {
          await safeReply(interaction, { ...payload, __forceFollowUp: true });
        } else {
          await safeReply(interaction, payload);
        }
      } catch (e) {
        if (isUnknownWebhookError(e)) {
          await safeReply(interaction, { ...payload, __forceFollowUp: true });
        } else {
          throw e;
        }
      }
      return;
    }
    throw err;
  }

  await saveFullGameMetadata(newGame.id, details);

  const igdbPlatformIds: number[] = (details.platforms ?? [])
    .map((platform) => platform.id)
    .filter(isPositiveInt);
  await GamePlatformRegionService.addGamePlatformsByIgdbIds(newGame.id, igdbPlatformIds);

  await processReleaseDates(newGame.id, details.release_dates || []);

  if (opts?.selectionMessage) {
    try {
      await opts.selectionMessage.edit({ components: [] });
    } catch {
      // ignore cleanup failures
    }
  }

  await apiPost(`/api/v1/games/${newGame.id}/refresh-images`).catch((err) => {
    logError("GamedbAddCommand.addGameToDatabase.refreshImages", err);
  });

  await showGameProfile(interaction, newGame.id, true);
}

export async function handleNoResults(
  interaction: CommandInteraction | StringSelectMenuInteraction,
  query: string,
): Promise<void> {
  try {
    const existing = await Game.searchGames(query);
    const existingList = existing
      .slice(0, 10)
      .map((g) => `• **${g.title}** (GameDB #${g.id})`);
    const existingText = existingList.length
      ? `${existingList.join("\n")}${existing.length > 10 ? "\n(and more...)" : ""}`
      : null;

    const searchRes = await igdbService.searchGames(query);
    const results = searchRes.results;

    if (!results.length) {
      const noResultsMsg = existingText
        ? `No games found on IGDB matching "${query}".\nSimilar GameDB entries:\n${existingText}`
        : `No games found on IGDB matching "${query}".`;
      await safeReply(interaction, {
        ...buildTextReply(noResultsMsg, false),
        __forceFollowUp: true,
      });
      return;
    }

    if (results.length === 1) {
      await addGameToDatabase(interaction, results[0].id, {
        selectionMessage: null,
        showProfile: true,
      });
      return;
    }

    const opts = await buildIgdbSelectOptions(results);

    const { components } = createIgdbSession(
      interaction.user.id,
      opts,
      async (sel, igdbId) => {
        if (!sel.deferred && !sel.replied) {
          await safeDeferUpdate(sel);
        }
        await addGameToDatabase(sel, igdbId, { selectionMessage: sel.message as any });
      },
    );

    const totalLabel =
      typeof searchRes.total === "number" ? searchRes.total : results.length;
    const needsPaging = totalLabel > 22;
    const pagingHint = needsPaging
      ? "\nUse the dropdown's Next page option to see more results."
      : "";

    const baseText =
      `## IGDB Results for "${query}"\n` +
      `Found ${totalLabel} results. Showing first ${Math.min(results.length, 22)}.` +
      `${pagingHint ? ` ${pagingHint}` : ""}`;
    const contentParts = [baseText];
    if (existingText) {
      contentParts.push(`**Existing GameDB matches**\n${existingText}`);
    }
    const content = trimTextDisplayContent(contentParts.join("\n\n"));
    const container = buildTextContainer(safeV2TextContent(content, 3500));

    await safeReply(interaction, {
      components: [container, ...components],
      flags: buildComponentsV2Flags(false),
      __forceFollowUp: true,
    });
  } catch (err: any) {
    await safeReply(interaction, {
      ...buildTextReply(`Auto-import failed: ${err?.message ?? err}`, false),
      __forceFollowUp: true,
    });
  }
}

@Discord()
@SlashGroup({ description: "Game Database Commands", name: "gamedb" })
@SlashGroup("gamedb")
export class GameDbAddCommand {
  @Slash({ description: "Add a new game to the database (searches IGDB)", name: "add" })
  async add(
    @SlashOption({
      description: "Title of the game to search for",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    title: string | undefined,
    @SlashOption({
      description: "IGDB id (skip search and import directly)",
      name: "igdb_id",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    igdbId: number | undefined,
    @SlashOption({
      description: "Comma-separated list of up to 5 titles to import",
      name: "bulk_titles",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    bulkTitles: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    if (igdbId) {
      await addGameToDatabase(interaction, Number(igdbId), { selectionMessage: null });
      return;
    }

    const sanitizedTitle = title
      ? sanitizeUserInput(title, { preserveNewlines: false })
      : "";
    const sanitizedBulk = bulkTitles
      ? sanitizeUserInput(bulkTitles, { preserveNewlines: false })
      : "";
    const parsedBulk = sanitizedBulk
      ? sanitizedBulk.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
    const singleTitle = sanitizedTitle.trim();
    const allTitles =
      (singleTitle ? [singleTitle] : []).concat(parsedBulk).filter(Boolean);

    if (!allTitles.length) {
      await safeReply(interaction, buildTextReply(
        "Provide a title or up to 5 comma-separated titles.",
        false,
      ));
      return;
    }

    if (allTitles.length > 5) {
      await safeReply(interaction, buildTextReply(
        "Bulk import supports up to 5 titles at a time.",
        false,
      ));
      return;
    }

    for (const t of allTitles) {
      await this.processTitle(interaction, t);
    }
  }

  @Slash({
    description: "Refresh release info from IGDB for a GameDB title",
    name: "refresh-release-info",
  })
  async refreshReleaseInfo(
    @SlashOption({
      description: "GameDB title (autocomplete) or GameDB ID",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
      autocomplete: autocompleteGameDbViewTitle,
    })
    titleInput: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const searchTerm = sanitizeUserInput(titleInput, { preserveNewlines: false }).trim();
    if (!searchTerm) {
      await safeReply(interaction, buildTextReply(
        "Please provide a GameDB title or GameDB ID.",
        true,
      ));
      return;
    }

    let game: IGame | null = null;
    if (/^\d+$/.test(searchTerm)) {
      const gameId = Number(searchTerm);
      if (isPositiveInt(gameId)) {
        game = await Game.getGameById(gameId);
      }
    } else {
      const matches = await Game.searchGames(searchTerm);
      const exactMatches = matches.filter(
        (entry) => entry.title.trim().toLowerCase() === searchTerm.toLowerCase(),
      );
      if (exactMatches.length === 1) {
        game = exactMatches[0];
      } else if (matches.length === 1) {
        game = matches[0];
      } else if (matches.length > 1) {
        const preview = matches
          .slice(0, 10)
          .map((entry) => `- ${entry.title} (GameDB #${entry.id})`)
          .join("\n");
        await safeReply(interaction, buildTextReply(
          "Multiple GameDB titles matched that input. Please rerun and choose one from " +
          `autocomplete or provide a GameDB ID.\n\n${preview}`,
          true,
        ));
        return;
      }
    }

    if (!game) {
      await safeReply(interaction, buildTextReply(
        `No GameDB title found for "${searchTerm}".`,
        true,
      ));
      return;
    }

    if (!game.igdbId) {
      await safeReply(interaction, buildTextReply(
        `GameDB #${game.id} (${game.title}) has no IGDB ID, so release data cannot be refreshed.`,
        true,
      ));
      return;
    }

    try {
      const before = await Game.getGameReleases(game.id);
      await importReleaseDatesFromIgdb(game.id, game.igdbId);
      const after = await Game.getGameReleases(game.id);
      const added = after.length - before.length;

      const summary = added > 0
        ? `Added ${added} release entr${added === 1 ? "y" : "ies"}.`
        : "No additional release entries were found on IGDB.";

      await safeReply(interaction, buildTextReply(
        `Release refresh complete for **${game.title}** ` +
        `(GameDB #${game.id}, IGDB #${game.igdbId}). ` +
        `${summary} Current total releases: ${after.length}.`,
        true,
      ));
    } catch (err: any) {
      await safeReply(interaction, buildTextReply(
        `Failed to refresh release info: ${err?.message ?? String(err)}`,
        true,
      ));
    }
  }

  private async processTitle(
    interaction: CommandInteraction,
    title: string,
  ): Promise<void> {
    try {
      const searchRes = await igdbService.searchGames(title);
      const results = searchRes.results;

      if (!results || results.length === 0) {
        await handleNoResults(interaction, title);
        return;
      }

      if (results.length === 1) {
        await addGameToDatabase(interaction, results[0].id, {
          selectionMessage: null,
          showProfile: true,
        });
        return;
      }

      const opts = await buildIgdbSelectOptions(results);

      const { components } = createIgdbSession(
        interaction.user.id,
        opts,
        async (sel, igdbId) => {
          if (!sel.deferred && !sel.replied) {
            await safeDeferUpdate(sel);
          }
          await addGameToDatabase(sel, igdbId, { selectionMessage: sel.message as any });
        },
      );

      const content = trimTextDisplayContent(
        `## IGDB Results for "${title}"\nFound ${results.length} results. Please select one:`,
      );
      const container = buildTextContainer(safeV2TextContent(content, 3500));
      await safeReply(interaction, {
        components: [container, ...components],
        flags: buildComponentsV2Flags(false),
        __forceFollowUp: true,
      });

    } catch (error: any) {
      await safeReply(interaction, {
        ...buildTextReply(`Failed to search IGDB. Error: ${error.message}`, false),
        __forceFollowUp: true,
      });
    }
  }
}
