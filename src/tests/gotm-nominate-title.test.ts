import assert from "node:assert/strict";
import test from "node:test";
import {
  gotmNominationChoices,
  resolveGotmNominatedGame,
} from "../commands/nominate.command.js";

// bot#1586: /gotm nominate read a typed all-digit title as a GameDB id.

function fakeLookup(calls: string[]) {
  return {
    getGameById: async (id: number) => {
      calls.push(`id ${id}`);
      return id === 42 ? { id, title: "Picked Game" } : null;
    },
    searchGames: async (title: string) => {
      calls.push(`search ${title}`);
      return [{ id: 7, title: "1942" }, { id: 8, title: "1942: Joint Strike" }];
    },
  };
}

test("gotm nominate: choices carry gamedb:<id>", () => {
  const choices = gotmNominationChoices([
    { id: 1942, title: "Chrono Trigger", initialReleaseDate: new Date("1995-03-11T00:00:00Z") },
  ]);
  assert.deepEqual(choices, [{ name: "Chrono Trigger (1995)", value: "gamedb:1942" }]);
});

test("gotm nominate: a typed all-digit title is searched, not read as an id", async () => {
  const calls: string[] = [];
  const resolved = await resolveGotmNominatedGame("1942", fakeLookup(calls));
  assert.deepEqual(resolved, { id: 7, found: ["1942", "1942: Joint Strike"] });
  assert.deepEqual(calls, ["search 1942"]);
});

test("gotm nominate: a picked suggestion nominates exactly that game", async () => {
  const calls: string[] = [];
  const resolved = await resolveGotmNominatedGame("gamedb:42", fakeLookup(calls));
  assert.deepEqual(resolved, { id: 42, found: ["Picked Game"] });
  assert.deepEqual(calls, ["id 42"]);
});

test("gotm nominate: a picked id GameDB no longer has resolves to nothing", async () => {
  const calls: string[] = [];
  const resolved = await resolveGotmNominatedGame("gamedb:5", fakeLookup(calls));
  assert.deepEqual(resolved, { id: null, found: [] });
  assert.deepEqual(calls, ["id 5"]);
});
