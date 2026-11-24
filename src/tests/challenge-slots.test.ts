import assert from "node:assert/strict";
import test from "node:test";
import type {
  IChallenge,
  IChallengeRun,
  IChallengeSlots,
  IPastPlay,
} from "../services/ChallengeApi.js";
import {
  clearedGameChoices,
  movePickerView,
  moveYearPickerView,
  pastPickReply,
  pastPlayChoices,
  pastPlayPickerView,
  pastPlayYearPickerView,
  slotMoveReply,
  slotsRunChoices,
  yearChoices,
  type ChallengeSlotResult,
  type IChallengeSlotActionsApi,
} from "../services/ChallengeSlotActions.js";
import {
  buildShowView,
  buildSlotsRunView,
  type IChallengeShowApi,
} from "../services/ChallengeSlotsShow.js";
import {
  apiError,
  buttonsOf,
  poolRun,
  selectsOf,
  slotsChallenge,
  slotsRun,
  textOf,
} from "./challengeFixtures.js";

// Slots in /challenge (bot#1550): the decade pages of /challenge show (design 4D), and
// moving games and picking past play, with fake APIs.

const NOW = new Date("2026-11-17T15:00:00.000Z");

/** Lufia's Run of the 1990s and on: 1991, 2003 and 2021 open. */
function lufiaRun(overrides: Partial<IChallengeRun> = {}): IChallengeRun {
  return slotsRun({ first: 1990, open: [1991, 2003, 2021, 2026] }, {
    user: { user_id: "222", username: "lufia", global_name: "Lufia" },
    ...overrides,
  });
}

interface IFakeApi extends IChallengeShowApi, IChallengeSlotActionsApi {
  calls: string[];
}

function fakeApi(options: {
  challenge?: IChallenge | null;
  run?: IChallengeRun | null;
  memberRuns?: IChallengeRun[];
  runs?: IChallengeRun[];
  error?: unknown;
  plays?: IPastPlay[];
} = {}): IFakeApi {
  const challenge = options.challenge === undefined ? slotsChallenge() : options.challenge;
  const run = options.run === undefined ? lufiaRun() : options.run;
  const api: IFakeApi = {
    calls: [],
    getChallenge: async (id, actingUserId) => {
      api.calls.push(`challenge ${id} as ${actingUserId}`);
      return challenge;
    },
    listChallenges: async () => ({ items: [], page: 1, pages: 1, count: 0 }),
    listRuns: async (challengeId, actingUserId, page) => {
      api.calls.push(`runs of challenge ${challengeId} page ${page}`);
      const items = options.runs ?? [];
      return { items, page, pages: 1, count: items.length };
    },
    poolProgress: async () => ({ items: [], page: 1, pages: 1, count: 0 }),
    listMemberRuns: async (userId, actingUserId, page) => {
      api.calls.push(`runs of ${userId} as ${actingUserId} page ${page}`);
      const items = options.memberRuns ?? [];
      return { items, page, pages: 1, count: items.length };
    },
    getRun: async (runId, actingUserId) => {
      api.calls.push(`run ${runId} as ${actingUserId}`);
      return run;
    },
    slotMove: async (runId, gameId, year, actingUserId) => {
      api.calls.push(`move ${gameId} to ${year} on ${runId} as ${actingUserId}`);
      if (options.error) throw options.error;
      return run!;
    },
    pastPick: async (runId, completionId, year, actingUserId) => {
      api.calls.push(`pick ${completionId} for ${year} on ${runId} as ${actingUserId}`);
      if (options.error) throw options.error;
      return run!;
    },
    pastPlay: async (runId, actingUserId, query) => {
      api.calls.push(`past play of ${runId} as ${actingUserId}${query ? ` q=${query}` : ""}`);
      if (options.error) throw options.error;
      return options.plays ?? [];
    },
  };
  return api;
}

function viewOf(result: ChallengeSlotResult): Extract<ChallengeSlotResult, { view: unknown }> {
  assert.ok("view" in result, "error" in result ? result.error : "no view");
  return result;
}

// Show: design 4D, Slots one decade per page.

test("show: a Slots Challenge opens on the member's own Run, a decade at a time", async () => {
  const api = fakeApi({ memberRuns: [poolRun(), lufiaRun()] });
  const view = await buildShowView(
    { challengeId: 12, view: "game", page: 1, actingUserId: "222" },
    { api, now: () => NOW },
  );

  const text = textOf(view.components);
  assert.match(text, /^## Years Alive$/m);
  assert.match(text, /^\*\*Lufia\*\*'s Run · 33 of 37 years$/m);
  assert.match(text, /^### 1990s · 9 of 10 Cleared$/m);
  assert.match(text, /^`1990` \*\*Game 1990\*\*$/m);
  assert.match(text, /^`1991` \*open\*$/m);
  assert.doesNotMatch(text, /`2000`/);
  const buttons = buttonsOf(view.components);
  assert.deepEqual(
    buttons.map((b) => b.label),
    ["Lufia", "1990s", "2000s", "2010s", "2020s", "Move a game", "Pick past play"],
  );
  const decade = buttons.find((b) => b.label === "1990s");
  assert.equal(decade?.disabled, true);
  assert.equal(
    buttons.find((b) => b.label === "2000s")?.customId,
    "challenge-slots-v1:decade:90:2000:u",
  );
  assert.equal(buttons.at(-2)?.customId, "challenge-slots-v1:move:90");
  assert.equal(buttons.at(-1)?.customId, "challenge-slots-v1:pick:90");
});

test("show: without a Run of it, a Slots Challenge shows its Runs with a member select",
  async () => {
    const api = fakeApi({ memberRuns: [], runs: [lufiaRun()] });
    const view = await buildShowView(
      { challengeId: 12, view: "game", page: 1, actingUserId: "999" },
      { api, now: () => NOW },
    );

    const text = textOf(view.components);
    assert.match(text, /^### By member · 1 Run$/m);
    assert.match(text, /Slots · Your birth year to the current year · Always Open/);
    const [select] = selectsOf(view.components);
    assert.equal(select?.customId, "challenge-slots-v1:runs:12");
    assert.deepEqual(select?.options.map((o) => [o.label, o.value]), [["Lufia · Active", "90"]]);
  });

test("show: another member's Run has no Move or Pick buttons", async () => {
  const api = fakeApi();
  const view = await buildSlotsRunView({ runId: 90, decade: 2020, actingUserId: "999" }, { api });

  const text = textOf(view.components);
  assert.match(text, /^### 2020s · 5 of 7 Cleared$/m);
  assert.match(text, /^`2026` \*open\*$/m);
  const labels = buttonsOf(view.components).map((b) => b.label);
  assert.ok(!labels.includes("Move a game") && !labels.includes("Pick past play"));
});

test("show: without Counts past play there is no Pick past play", async () => {
  const slots: IChallengeSlots = {
    first_year: "birth_year",
    last_year: "current_year",
    counts_past_play: false,
  };
  const run = lufiaRun({
    challenge: { ...lufiaRun().challenge!, counts_past_play: false, slots },
  });
  const api = fakeApi({ run });
  const view = await buildSlotsRunView({ runId: 90, actingUserId: "222" }, { api });

  // The Run's own Challenge says whether Counts past play is on: nothing else is read.
  assert.deepEqual(api.calls, ["run 90 as 222"]);
  const labels = buttonsOf(view.components).map((b) => b.label);
  assert.ok(labels.includes("Move a game"));
  assert.ok(!labels.includes("Pick past play"));
});

test("show: a Run of more than five decades picks its decade from a select", async () => {
  const api = fakeApi({ run: slotsRun({ first: 1975, open: [1977] }) });
  const view = await buildSlotsRunView({ runId: 90, actingUserId: "333" }, { api });

  assert.match(textOf(view.components), /^### 1970s · 4 of 5 Cleared$/m);
  const [select] = selectsOf(view.components);
  assert.equal(select?.customId, "challenge-slots-v1:decades:90");
  assert.deepEqual(
    select?.options.map((o) => o.label),
    ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"],
  );
  assert.equal(select?.options.find((o) => o.default)?.label, "1970s");
});

test("show: a Run that isn't Active says so, and a waiting game is named", async () => {
  const run = lufiaRun({ status: "abandoned" });
  run.entries!.push({
    game_id: 501,
    title: "Chrono Trigger",
    state: "cleared",
    slot_year: null,
    picked_by_hand: false,
  });
  const view = await buildSlotsRunView({ runId: 90, actingUserId: "222" }, {
    api: fakeApi({ run }),
  });

  const text = textOf(view.components);
  assert.match(text, /'s Run · Abandoned · 33 of 37 years$/m);
  assert.match(text, /^-# Cleared and waiting for an open year: Chrono Trigger$/m);
  assert.ok(!buttonsOf(view.components).some((b) => b.label === "Move a game"));
});

// Slot move and past pick.

test("slot move: moves the game and shows its new decade", async () => {
  const api = fakeApi();
  const result = viewOf(await slotMoveReply(
    { runId: 90, gameId: 1993, year: 2003, actingUserId: "222" },
    { api },
  ));

  assert.deepEqual(api.calls, ["move 1993 to 2003 on 90 as 222"]);
  const text = textOf(result.view.components);
  assert.match(text, /^Moved \*\*Game 1993\*\* to 2003\.$/m);
  assert.match(text, /^### 2000s/m);
});

test("slot move: a refusal shows the API's message with the request and response", async () => {
  const api = fakeApi({
    error: apiError(409, {
      error: "slot_filled",
      message: "2003 already holds Kingdom Hearts II.",
      game_id: 8,
    }, {
      method: "post",
      url: "/api/v1/challenge_runs/90/slot_move",
      data: { data: { game_id: 1993, slot_year: 2003, acting_user_id: "222" } },
    }),
  });
  const result = await slotMoveReply(
    { runId: 90, gameId: 1993, year: 2003, actingUserId: "222" },
    { api },
  );

  assert.ok("error" in result);
  assert.match(result.error, /2003 already holds Kingdom Hearts II\./);
  assert.match(result.error, /slot_move/);
  assert.match(result.error, /409/);
});

test("past pick: picks the Game Completion and names the game in its year", async () => {
  const api = fakeApi();
  const result = viewOf(await pastPickReply(
    { runId: 90, completionId: 31, year: 1995, actingUserId: "222" },
    { api },
  ));

  assert.equal(api.calls[0], "pick 31 for 1995 on 90 as 222");
  assert.match(textOf(result.view.components), /^Picked \*\*Game 1995\*\* for 1995\.$/m);
});

test("past pick: Counts past play off is refused with the API's message", async () => {
  const api = fakeApi({
    error: apiError(422, {
      error: "past_play_off",
      message: "This Challenge doesn't count past play.",
    }, { method: "post", url: "/api/v1/challenge_runs/90/past_pick" }),
  });
  const result = await pastPickReply(
    { runId: 90, completionId: 31, year: 1995, actingUserId: "222" },
    { api },
  );

  assert.ok("error" in result);
  assert.match(result.error, /^This Challenge doesn't count past play\./);
});

test("move a game: the first step offers the Cleared games with their years", async () => {
  const run = lufiaRun();
  run.entries!.unshift({
    game_id: 501,
    title: "Chrono Trigger",
    state: "cleared",
    slot_year: null,
    picked_by_hand: false,
  });
  const result = viewOf(await movePickerView({ runId: 90, actingUserId: "222" }, {
    api: fakeApi({ run }),
  }));

  assert.match(textOf(result.view.components), /Open years: 1991, 2003, 2021, 2026\./);
  const [select] = selectsOf(result.view.components);
  assert.equal(select?.customId, "challenge-slots-v1:move-game:90");
  assert.equal(select?.options.length, 25);
  assert.deepEqual(select?.options[0], {
    label: "Chrono Trigger",
    value: "501",
    default: false,
    description: "waiting for an open year",
  });
  assert.match(textOf(result.view.components), /Showing 25 of 34 games/);
});

/** Lufia's Run, its Game 1993 released in `years` (the entry's release_years). */
function releasedIn(years: number[] | null): IChallengeRun {
  const run = lufiaRun();
  run.entries = run.entries!.map((entry) =>
    entry.game_id === 1993 ? { ...entry, release_years: years } : entry);
  return run;
}

test("move a game: the year step offers only the open years the game came out in",
  async () => {
    const result = viewOf(await moveYearPickerView(
      { runId: 90, gameId: 1993, actingUserId: "222" },
      { api: fakeApi({ run: releasedIn([1993, 2003, 2026]) }) },
    ));

    const [select] = selectsOf(result.view.components);
    assert.equal(select?.customId, "challenge-slots-v1:move-year:90:1993");
    assert.deepEqual(select?.options.map((o) => o.value), ["2003", "2026"]);
  });

test("move a game: no open year fits, or unknown release years offer every open year",
  async () => {
    const none = viewOf(await moveYearPickerView(
      { runId: 90, gameId: 1993, actingUserId: "222" },
      { api: fakeApi({ run: releasedIn([1993]) }) },
    ));
    assert.match(textOf(none.view.components), /didn't come out in any open year/);

    const unknown = viewOf(await moveYearPickerView(
      { runId: 90, gameId: 1993, actingUserId: "222" },
      { api: fakeApi({ run: releasedIn(null) }) },
    ));
    assert.deepEqual(
      selectsOf(unknown.view.components)[0]?.options.map((o) => o.value),
      ["1991", "2003", "2021", "2026"],
    );
  });

const plays: IPastPlay[] = [
  {
    completion_id: 31,
    game_id: 600,
    title: "Chrono Trigger",
    completed_at: "2019-05-03",
    open_years: [1995],
  },
  { completion_id: 32, game_id: 601, title: "Suikoden", completed_at: null, open_years: [1995] },
];

test("pick past play: the steps offer the earlier play that fits, then its years", async () => {
  const api = fakeApi({ plays });
  const first = viewOf(await pastPlayPickerView({ runId: 90, actingUserId: "222" }, { api }));
  const [select] = selectsOf(first.view.components);
  assert.equal(select?.customId, "challenge-slots-v1:pick-play:90");
  assert.deepEqual(select?.options.map((o) => o.value), ["31", "32"]);

  const second = viewOf(await pastPlayYearPickerView(
    { runId: 90, completionId: 31, actingUserId: "222" },
    { api },
  ));
  assert.match(textOf(second.view.components), /Cleared 3 May 2019\. Pick its year\./);
  const [years] = selectsOf(second.view.components);
  assert.equal(years?.customId, "challenge-slots-v1:pick-year:90:31");
  assert.deepEqual(years?.options.map((o) => o.value), ["1995"]);
});

test("pick past play: nothing to pick says so; a refusal shows the API's message", async () => {
  const empty = viewOf(await pastPlayPickerView({ runId: 90, actingUserId: "222" }, {
    api: fakeApi({ plays: [] }),
  }));
  assert.match(textOf(empty.view.components), /None of your earlier Game Completions fit/);

  const refused = await pastPlayPickerView({ runId: 90, actingUserId: "222" }, {
    api: fakeApi({
      error: apiError(409, { error: "run_not_active", message: "That Run has ended." }, {
        method: "get",
        url: "/api/v1/challenge_runs/90/past_play?acting_user_id=222",
      }),
    }),
  });
  assert.ok("error" in refused);
  assert.match(refused.error, /^That Run has ended\./);
});

test("autocomplete: Active Slots Runs, Cleared games, years and past play", () => {
  const runs = [poolRun(), lufiaRun(), lufiaRun({ id: 91, status: "finished" })];
  assert.deepEqual(slotsRunChoices(runs, "years"), [
    { name: "Years Alive · 33 of 37 years", value: "90" },
  ]);
  assert.deepEqual(slotsRunChoices(runs, "fall"), []);

  assert.deepEqual(clearedGameChoices(lufiaRun(), "game 199").slice(0, 2), [
    { name: "Game 1990 · fills 1990", value: "1990" },
    { name: "Game 1992 · fills 1992", value: "1992" },
  ]);
  assert.deepEqual(yearChoices([1991, 2003, 2021], "20"), [
    { name: "2003", value: "2003" },
    { name: "2021", value: "2021" },
  ]);
  assert.deepEqual(pastPlayChoices(plays), [
    { name: "Chrono Trigger · Cleared 3 May 2019 · fits 1995", value: "31" },
    { name: "Suikoden · No date · fits 1995", value: "32" },
  ]);
});
