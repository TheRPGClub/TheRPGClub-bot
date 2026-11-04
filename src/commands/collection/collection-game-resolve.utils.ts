import Game from "../../classes/Game.js";
import { igdbService, type IGDBGame } from "../../services/IGDB/IgdbService.js";
import type { IgdbSelectOption } from "../../services/IGDB/IgdbSelectService.js";
import { sanitizeUserInput } from "../../functions/InteractionUtils.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { truncateLabel } from "../../config/textLimits.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";
import { importGameFromIgdb } from "../../functions/GameIgdbSync.js";
import GameSearchService from "../../classes/GameSearchService.js";
import { UserFacingError } from "../../utilities/ApiErrorUtils.js";

export const GAME_NOT_FOUND_IN_GAMEDB_OR_IGDB = "Could not find that title in GameDB or IGDB.";

export type ResolvedCollectionGame =
  | { kind: "resolved"; gameId: number; title: string }
  | { kind: "choose"; titleQuery: string; options: IgdbSelectOption[] };

export async function buildCollectionIgdbSelectOptions(
  results: IGDBGame[],
): Promise<IgdbSelectOption[]> {
  const trimmedResults = results.slice(0, 50);
  const platformIds = Array.from(new Set(
    trimmedResults
      .flatMap((game) => game.platforms?.map((platform) => Number(platform.id)) ?? [])
      .filter(isPositiveInt),
  ));
  const platformMap = platformIds.length
    ? await GamePlatformRegionService.getPlatformsByIgdbIds(platformIds)
    : new Map<number, { name: string; abbreviation?: string }>();

  return trimmedResults.map((game) => {
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : "TBD";
    const platformText = (game.platforms ?? [])
      .map((platform) => platformMap.get(Number(platform.id)))
      .filter((platform): platform is NonNullable<typeof platform> => Boolean(platform))
      .map((platform) => platform.abbreviation ?? platform.name)
      .slice(0, 3)
      .join(", ");
    const summary = (game.summary ?? "No summary").replace(/\s+/g, " ").trim();
    const description = platformText
      ? truncateLabel(`${platformText} | ${summary}`)
      : truncateLabel(summary);
    return {
      id: game.id,
      label: truncateLabel(`${game.name} (${year})`),
      description,
    };
  });
}

/**
 * How a numeric input is read: "gamedb-or-igdb" tries a GameDB id, then imports it as an
 * IGDB id; "gamedb" tries a GameDB id, then searches it as a title; "none" always treats
 * it as a title, for free text such as a modal field where "1942" is a game name.
 */
export type ResolveGameIdMode = "gamedb-or-igdb" | "gamedb" | "none";

/** Resolves an autocomplete value (a GameDB id, or an IGDB id to import) or a typed title. */
export async function resolveCollectionGameForAdd(
  gameIdRaw: string,
  options?: { ids?: ResolveGameIdMode },
): Promise<ResolvedCollectionGame> {
  const idMode = options?.ids ?? "gamedb-or-igdb";
  const numericValue = Number(gameIdRaw);
  if (idMode !== "none" && isPositiveInt(numericValue)) {
    const localGame = await Game.getGameById(numericValue);
    if (localGame) {
      return { kind: "resolved", gameId: localGame.id, title: localGame.title };
    }

    if (idMode === "gamedb-or-igdb") {
      const importedById = await importGameFromIgdb(numericValue);
      return { kind: "resolved", gameId: importedById.gameId, title: importedById.title };
    }
  }

  const titleQuery = sanitizeUserInput(gameIdRaw, { preserveNewlines: false }).trim();
  if (!titleQuery) {
    throw new Error("Invalid game selection.");
  }

  const localResults = await GameSearchService.searchGames(titleQuery);
  const exactLocal = localResults.find(
    (game) => game.title.toLowerCase() === titleQuery.toLowerCase(),
  );
  if (exactLocal) {
    return { kind: "resolved", gameId: exactLocal.id, title: exactLocal.title };
  }

  const igdbSearch = await igdbService.searchGames(titleQuery, 10);
  if (!igdbSearch.results.length) {
    throw new UserFacingError(GAME_NOT_FOUND_IN_GAMEDB_OR_IGDB);
  }

  return {
    kind: "choose",
    titleQuery,
    options: await buildCollectionIgdbSelectOptions(igdbSearch.results),
  };
}
