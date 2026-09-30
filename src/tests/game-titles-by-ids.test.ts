import assert from "node:assert/strict";
import test, { mock } from "node:test";
import Game from "../classes/Game.js";
import GameSearchService from "../classes/GameSearchService.js";
import type { IGame } from "../types/GameTypes.js";

test.afterEach(() => {
  mock.restoreAll();
});

function fakeGame(id: number, title: string): IGame {
  return { id, title } as IGame;
}

test("getTitlesByIds reads the title cache and fetches only its misses", async () => {
  const cached = mock.method(GameSearchService, "getCachedTitles", async () =>
    new Map([[1, "Chrono Trigger"], [2, "Pokémon Red"]]));
  const fetched = mock.method(Game, "getGameById", async (id: number) =>
    fakeGame(id, "New Game"));

  const titles = await Game.getTitlesByIds([1, 2, 2, 3, 0]);

  assert.deepEqual(cached.mock.calls[0].arguments[0], [1, 2, 3]);
  assert.deepEqual(fetched.mock.calls.map((call) => call.arguments[0]), [3]);
  assert.deepEqual(
    [...titles.entries()],
    [[1, "Chrono Trigger"], [2, "Pokémon Red"], [3, "New Game"]],
  );
});

test("getTitlesByIds falls back to per-id fetches when the cache fails", async () => {
  mock.method(GameSearchService, "getCachedTitles", async () => {
    throw new Error("games list down");
  });
  const fetched = mock.method(Game, "getGameById", async (id: number) =>
    id === 5 ? null : fakeGame(id, `Game ${id}`));

  const titles = await Game.getTitlesByIds([4, 5]);

  assert.equal(fetched.mock.callCount(), 2);
  assert.deepEqual([...titles.entries()], [[4, "Game 4"]]);
});
