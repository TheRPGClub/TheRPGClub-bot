import {
  ApplicationCommandOptionType,
  ButtonStyle,
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
import {
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
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
} from "./gamedb-utils.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../../services/IGDB/IgdbSelectService.js";
import { showGameProfile, trimTextDisplayContent } from "./gamedb-profile.service.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { logError, logWarn } from "../../utilities/LogUtils.js";
import { apiGet, apiPost } from "../../services/RpgClubApiClient.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";
import { importReleaseDatesFromIgdb } from "../../functions/GameIgdbSync.js";
import GameSearchService from "../../classes/GameSearchService.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import {
  buildActionButton,
  buildButtonRow,
} from "../../functions/uiComponents.js";

export interface IGdbApiCandidate {
  igdb_id: number;
  name: string;
  slug?: string | null;
  summary?: string | null;
  url?: string | null;
  total_rating?: number | null;
  first_release_date?: string | null;
  cover_url?: string | null;
  already_imported: boolean;
}

async function searchIgdbViaApi(query: string): Promise<IGdbApiCandidate[]> {
  const res = await apiGet<{ data: IGdbApiCandidate[] }>(
    "/api/v1/igdb/search",
    { params: { q: query } },
  );
  return res?.data ?? [];
}

function buildApiCandidateSelectOptions(candidates: IGdbApiCandidate[]): IgdbSelectOption[] {
  return candidates.map((c) => {
    const year = c.first_release_date
      ? new Date(c.first_release_date).getFullYear()
      : "TBD";
    return {
      id: c.igdb_id,
      label: `${c.name} (${year})`,
      description: c.summary ? c.summary.substring(0, 100) : "No summary",
    };
  });
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
    logWarn(
      "GamedbAdd.addGame",
      `Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingPlatformIds.join(", ")}`,
    );
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
  let result: { data: { id: number } } | null;
  try {
    result = await apiPost<{ data: { id: number } }>(
      "/api/v1/games",
      { igdb_id: igdbId },
    );
  } catch (err) {
    await safeReply(interaction, {
      ...buildTextReply(buildApiErrorMessage("Failed to import game.", err), false),
      __forceFollowUp: true,
    });
    return;
  }

  if (!result) {
    await safeReply(interaction, {
      ...buildTextReply(`No IGDB game found with id ${igdbId}.`, false),
      __forceFollowUp: true,
    });
    return;
  }

  if (opts?.selectionMessage) {
    try {
      await opts.selectionMessage.edit({ components: [] });
    } catch {
      // ignore cleanup failures
    }
  }

  await showGameProfile(interaction, result.data.id, true);
}

export async function handleNoResults(
  interaction: CommandInteraction | StringSelectMenuInteraction,
  query: string,
): Promise<void> {
  try {
    const existing = await GameSearchService.searchGames(query);
    const existingList = existing
      .slice(0, 10)
      .map((g) => `• **${g.title}** (GameDB #${g.id})`);
    const existingText = existingList.length
      ? `${existingList.join("\n")}${existing.length > 10 ? "\n(and more...)" : ""}`
      : null;

    const candidates = await searchIgdbViaApi(query);

    if (!candidates.length) {
      const noResultsMsg = existingText
        ? `No games found on IGDB matching "${query}".\nSimilar GameDB entries:\n${existingText}`
        : `No games found on IGDB matching "${query}".`;
      await safeReply(interaction, {
        ...buildTextReply(noResultsMsg, false),
        __forceFollowUp: true,
      });
      return;
    }

    if (candidates.length === 1) {
      const candidate = candidates[0];
      if (candidate.already_imported) {
        const existingGame = await Game.getGameByIgdbId(candidate.igdb_id);
        if (existingGame) {
          await showGameProfile(interaction, existingGame.id, undefined);
          return;
        }
      }
      const year = candidate.first_release_date
        ? new Date(candidate.first_release_date).getFullYear()
        : "TBD";
      const label = `${candidate.name} (${year})`;
      const statusMsg = candidate.already_imported
        ? `**${label}** is already in GameDB but could not be located. ` +
          `Use the button to refresh it.`
        : `**${label}** was found on IGDB but is not yet in GameDB.`;
      const fullText = existingText
        ? `${statusMsg}\n\nSimilar GameDB entries:\n${existingText}`
        : statusMsg;
      const container = buildTextContainer(safeV2TextContent(fullText, 3500));
      const importButton = buildActionButton({
        customId: `gamedb-action:igdb-import:${candidate.igdb_id}`,
        label: "Import to GameDB",
        style: ButtonStyle.Primary,
      });
      await safeReply(interaction, {
        components: [container, buildButtonRow(importButton)],
        flags: buildComponentsV2Flags(false),
        __forceFollowUp: true,
      });
      return;
    }

    const opts = buildApiCandidateSelectOptions(candidates);
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

    const needsPaging = candidates.length > 22;
    const pagingHint = needsPaging
      ? " Use the dropdown's Next page option to see more results."
      : "";
    const baseText =
      `## IGDB Results for "${query}"\n` +
      `Found ${candidates.length} results. Showing first ${Math.min(candidates.length, 22)}.` +
      pagingHint;
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
      ...buildTextReply(
        buildApiErrorMessage(`Auto-import failed for "${query}".`, err),
        false,
      ),
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
      const matches = await GameSearchService.searchGames(searchTerm);
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
        `GameDB #${game.id} (${game.title}) has no IGDB ID, ` +
        `so release data cannot be refreshed.`,
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
      const candidates = await searchIgdbViaApi(title);

      if (!candidates.length) {
        const existing = await GameSearchService.searchGames(title);
        const existingList = existing
          .slice(0, 10)
          .map((g) => `• **${g.title}** (GameDB #${g.id})`);
        const existingText = existingList.length
          ? `${existingList.join("\n")}${existing.length > 10 ? "\n(and more...)" : ""}`
          : null;
        const noResultsMsg = existingText
          ? `No games found on IGDB matching "${title}".\n` +
            `Similar GameDB entries:\n${existingText}`
          : `No games found on IGDB matching "${title}".`;
        await safeReply(interaction, {
          ...buildTextReply(noResultsMsg, false),
          __forceFollowUp: true,
        });
        return;
      }

      if (candidates.length === 1) {
        await addGameToDatabase(interaction, candidates[0].igdb_id, {
          selectionMessage: null,
          showProfile: true,
        });
        return;
      }

      const opts = buildApiCandidateSelectOptions(candidates);
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
        `## IGDB Results for "${title}"\n` +
        `Found ${candidates.length} results. Please select one:`,
      );
      const container = buildTextContainer(safeV2TextContent(content, 3500));
      await safeReply(interaction, {
        components: [container, ...components],
        flags: buildComponentsV2Flags(false),
        __forceFollowUp: true,
      });

    } catch (error: any) {
      await safeReply(interaction, {
        ...buildTextReply(
          buildApiErrorMessage(`Failed to search IGDB for "${title}".`, error),
          false,
        ),
        __forceFollowUp: true,
      });
    }
  }
}
