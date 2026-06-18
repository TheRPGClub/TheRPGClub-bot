import { apiPost } from "../services/RpgClubApiClient.js";
import { clearAutocompleteSearchCaches } from "./GameAutocompleteCache.js";
import Game from "../classes/Game.js";

export async function importGameFromIgdb(
  igdbId: number,
): Promise<{ gameId: number; title: string }> {
  const existing = await Game.getGameByIgdbId(igdbId);
  if (existing) {
    clearAutocompleteSearchCaches();
    return { gameId: existing.id, title: existing.title };
  }

  const result = await apiPost<{ data: { game_id: number } }>(
    "/api/v1/games",
    { igdb_id: igdbId },
  );
  if (!result) throw new Error("No IGDB game found with that id.");

  const game = await Game.getGameById(result.data.game_id);
  if (!game) throw new Error("Failed to fetch newly imported game.");

  clearAutocompleteSearchCaches();
  return { gameId: game.id, title: game.title };
}

export async function refreshReleaseDates(gameId: number): Promise<void> {
  await apiPost(`/api/v1/games/${gameId}/refresh-releases`);
}

export async function importReleaseDatesFromIgdb(
  gameId: number,
): Promise<void> {
  await apiPost(`/api/v1/games/${gameId}/refresh-releases`);
}
