import Game from "../classes/Game.js";

export async function importGameFromIgdb(
  igdbId: number,
): Promise<{ gameId: number; title: string }> {
  const game = await Game.createGame(igdbId);
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
