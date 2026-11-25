import assert from "node:assert/strict";
import test from "node:test";
import type {
  IGotyEligibility,
  IGotyNomination,
  IGotyVoteApi,
  IGotyVoteSummary,
} from "../services/GotyVoteApi.js";
import {
  buildGotyWithdrawId,
  createGotyAutocompleteCache,
  gotyNominateChoices,
  gotyNominateReply,
  gotyNominationsReply,
  gotyWithdrawReply,
  parseGotyWithdrawId,
  pickNominationsGotyVote,
} from "../services/GotyNominations.js";
import { apiError, buttonsOf, textOf } from "./challengeFixtures.js";
import { UNUSED_GOTY_API } from "./gotyFixtures.js";

// /goty nominate, /goty nominations and Withdraw (bot#1580), against a fake API client.

const MEMBER = "222";
const OTHER = "333";

function summary(overrides: Partial<IGotyVoteSummary> = {}): IGotyVoteSummary {
  return {
    year: 2026,
    name: "GOTY Vote 2026",
    nominations_open_at: "2027-01-01T05:00:00.000Z",
    voting_opens_at: "2027-01-15T17:00:00.000Z",
    voting_closes_at: "2027-01-18T04:59:59.000Z",
    phase: "nominating",
    nominations_open: true,
    voting_open: false,
    runoff_open: false,
    ...overrides,
  };
}

function nomination(
  id: number,
  gameId: number,
  title: string,
  userId = MEMBER,
): IGotyNomination {
  return {
    id,
    year: 2026,
    user_id: userId,
    gamedb_game_id: gameId,
    nominated_at: "2027-01-02T00:00:00.000Z",
    game: { game_id: gameId, title },
  };
}

interface IFakeApi extends IGotyVoteApi {
  calls: string[];
}

function fakeApi(options: {
  votes?: IGotyVoteSummary[];
  /** Successive nomination lists; the last one repeats. */
  lists?: IGotyNomination[][];
  nominate?: IGotyNomination | Error;
  withdraw?: boolean | Error;
  eligibility?: Record<number, IGotyEligibility>;
}): IFakeApi {
  const calls: string[] = [];
  let read = 0;
  return {
    ...UNUSED_GOTY_API,
    calls,
    async listVotes() {
      calls.push("votes");
      return options.votes ?? [summary()];
    },
    async listNominations(year, userId) {
      calls.push(`list ${year} ${userId ?? "all"}`);
      const lists = options.lists ?? [[]];
      const list = lists[Math.min(read, lists.length - 1)];
      read += 1;
      return userId ? list.filter((entry) => entry.user_id === userId) : list;
    },
    async nominate(year, userId, gameId) {
      calls.push(`nominate ${year} ${userId} ${gameId}`);
      if (options.nominate instanceof Error) throw options.nominate;
      if (!options.nominate) throw new Error("no nominate expected");
      return options.nominate;
    },
    async withdrawNomination(year, id) {
      calls.push(`withdraw ${year} ${id}`);
      if (options.withdraw instanceof Error) throw options.withdraw;
      return options.withdraw ?? true;
    },
    async eligibility(gameId, year) {
      calls.push(`eligibility ${gameId} ${year}`);
      const found = options.eligibility?.[gameId];
      if (!found) throw new Error("no eligibility");
      return found;
    },
  };
}

function viewOf(reply: unknown): { components: unknown[] } {
  assert.ok(reply && typeof reply === "object" && "view" in reply, JSON.stringify(reply));
  return (reply as { view: { components: unknown[] } }).view;
}

function refusal(code: string, message: string): Error {
  return apiError(422, { error: code, message }, {
    method: "post",
    url: "/api/v1/goty_votes/2026/nominations",
    data: { data: { gamedb_game_id: 7, user_id: MEMBER } },
  });
}

test("withdraw ids round-trip and refuse other prefixes", () => {
  const id = buildGotyWithdrawId({ year: 2026, nominationId: 41, scope: "mine" });
  assert.equal(id, "goty-nom-withdraw-v1:2026:41:m");
  assert.deepEqual(parseGotyWithdrawId(id), { year: 2026, nominationId: 41, scope: "mine" });
  assert.equal(parseGotyWithdrawId("goty-vote-pick-v1:2026:gotm:m:4"), null);
  assert.equal(parseGotyWithdrawId("goty-nom-withdraw-v1:2026:x:a"), null);
});

test("the nominations vote is the one taking nominations, else the newest under way", () => {
  const decided = summary({ year: 2025, phase: "decided", nominations_open: false });
  const upcoming = summary({ year: 2027, phase: "upcoming", nominations_open: false });
  assert.equal(pickNominationsGotyVote([upcoming, summary(), decided])?.year, 2026);
  assert.equal(pickNominationsGotyVote([upcoming, decided])?.year, 2027);
  assert.equal(pickNominationsGotyVote([decided])?.year, 2025);
  assert.equal(pickNominationsGotyVote([]), null);
});

test("nominate: records the game and shows how many of three are used", async () => {
  const saved = nomination(12, 7, "Clair Obscur");
  const api = fakeApi({ lists: [[nomination(11, 5, "Metaphor")]], nominate: saved });
  const reply = await gotyNominateReply(api, { userId: MEMBER, gameId: 7 });
  const view = viewOf(reply);
  const text = textOf(view.components);
  assert.match(text, /Nominated \*\*Clair Obscur\*\* for Game of the Year 2026\./);
  assert.match(text, /You have used 2 of your 3 nominations\./);
  assert.match(text, /GOTY Vote 2026/);
  assert.doesNotMatch(text, /reason/i);
  assert.deepEqual(api.calls, ["votes", `list 2026 ${MEMBER}`, `nominate 2026 ${MEMBER} 7`]);
  const labels = buttonsOf(view.components).map((button) => button.label);
  assert.deepEqual(labels, ["Withdraw Metaphor", "Withdraw Clair Obscur"]);
  assert.equal(
    buttonsOf(view.components)[1].customId,
    "goty-nom-withdraw-v1:2026:12:m",
  );
});

test("nominate: a game already nominated is not posted again", async () => {
  const api = fakeApi({ lists: [[nomination(11, 7, "Clair Obscur")]] });
  const text = textOf(viewOf(await gotyNominateReply(api, { userId: MEMBER, gameId: 7 }))
    .components);
  assert.match(text, /You already nominated \*\*Clair Obscur\*\*/);
  assert.match(text, /You have used 1 of your 3 nominations\./);
  assert.ok(!api.calls.some((call) => call.startsWith("nominate")));
});

test("nominate: outside the window says when, without calling the API", async () => {
  const api = fakeApi({
    votes: [summary({ phase: "upcoming", nominations_open: false })],
  });
  const reply = await gotyNominateReply(api, { userId: MEMBER, gameId: 7 });
  assert.ok("text" in reply);
  assert.match(reply.text, /nominations for GOTY Vote 2026 open <t:\d+:F>/);
  assert.deepEqual(api.calls, ["votes"]);

  const voting = fakeApi({
    votes: [summary({ phase: "voting", nominations_open: false, voting_open: true })],
  });
  const closed = await gotyNominateReply(voting, { userId: MEMBER, gameId: 7 });
  assert.ok("text" in closed);
  assert.match(closed.text, /are closed: they ended when voting opened/);
});

test("nominate: with no GOTY Vote at all", async () => {
  const reply = await gotyNominateReply(fakeApi({ votes: [] }), { userId: MEMBER, gameId: 7 });
  assert.ok("text" in reply);
  assert.match(reply.text, /There is no GOTY Vote yet/);
});

test("nominate: a game released in another year leads with that year", async () => {
  const api = fakeApi({
    nominate: refusal(
      "not_released_in_year",
      "Hades was not first released in 2026, so it can't be nominated for Game of the Year 2026",
    ),
    eligibility: {
      7: {
        game_id: 7, year: 2026, eligible: false, reason: "not_released_in_year",
        released_on: "2020-09-17",
      },
    },
  });
  const reply = await gotyNominateReply(api, { userId: MEMBER, gameId: 7 });
  assert.ok("error" in reply);
  assert.match(reply.error, /^Released in 2020\. Hades was not first released in 2026/);
  assert.match(reply.error, /```json/);
  assert.match(reply.error, /goty_votes\/2026\/nominations/);
});

test("nominate: the API's refusal reads first (unknown release, cap)", async () => {
  const unknown = await gotyNominateReply(fakeApi({
    nominate: refusal(
      "release_unknown",
      "Obscure RPG has no known release date, so it can't be nominated yet: " +
        "ask staff to record its release",
    ),
  }), { userId: MEMBER, gameId: 7 });
  assert.ok("error" in unknown);
  assert.match(unknown.error, /^Obscure RPG has no known release date.*ask staff to record/);

  const cap = await gotyNominateReply(fakeApi({
    nominate: refusal("nomination_cap_reached", "you already have 3 Game of the Year nominations"),
  }), { userId: MEMBER, gameId: 7 });
  assert.ok("error" in cap);
  assert.match(cap.error, /^you already have 3 Game of the Year nominations/);
  assert.match(cap.error, /"status": 422/);
});

test("nominations: every game once, with its nominators, and only own Withdraw buttons", async () => {
  const api = fakeApi({
    lists: [[
      nomination(1, 7, "Clair Obscur", OTHER),
      nomination(2, 8, "Metaphor", MEMBER),
      nomination(3, 7, "Clair Obscur", MEMBER),
    ]],
  });
  const view = viewOf(await gotyNominationsReply(api, {
    userId: MEMBER, year: null, scope: "all",
  }));
  const text = textOf(view.components);
  assert.match(text, /## GOTY Vote 2026: Game of the Year nominations/);
  assert.match(text, /2 games nominated by 2 members\./);
  assert.match(text, /1\. \*\*Clair Obscur\*\*, nominated by <@333>, <@222>/);
  assert.match(text, /2\. \*\*Metaphor\*\*, nominated by <@222>/);
  assert.match(text, /You have used 2 of your 3 nominations\./);
  assert.deepEqual(
    buttonsOf(view.components).map((button) => button.customId),
    ["goty-nom-withdraw-v1:2026:2:a", "goty-nom-withdraw-v1:2026:3:a"],
  );
  assert.deepEqual(api.calls, ["votes", "list 2026 all"]);
});

test("nominations: once voting opens there are no Withdraw buttons", async () => {
  const api = fakeApi({
    votes: [summary({ phase: "voting", nominations_open: false, voting_open: true })],
    lists: [[nomination(2, 8, "Metaphor")]],
  });
  const view = viewOf(await gotyNominationsReply(api, {
    userId: MEMBER, year: 2026, scope: "mine",
  }));
  assert.deepEqual(buttonsOf(view.components), []);
  assert.match(textOf(view.components), /are closed/);
});

test("nominations: an unknown year, and an empty list", async () => {
  const none = await gotyNominationsReply(fakeApi({}), {
    userId: MEMBER, year: 2030, scope: "all",
  });
  assert.ok("text" in none);
  assert.equal(none.text, "There is no GOTY Vote for 2030.");

  const empty = viewOf(await gotyNominationsReply(fakeApi({}), {
    userId: MEMBER, year: null, scope: "all",
  }));
  assert.match(textOf(empty.components), /Nobody has nominated a game yet\./);
});

test("withdraw: removes the member's own nomination and redraws the view", async () => {
  const mine = nomination(2, 8, "Metaphor");
  const api = fakeApi({ lists: [[mine], []] });
  const reply = await gotyWithdrawReply(
    api,
    { year: 2026, nominationId: 2, scope: "mine" },
    MEMBER,
  );
  const text = textOf(viewOf(reply).components);
  assert.match(text, /Withdrew \*\*Metaphor\*\*\./);
  assert.match(text, /You have used 0 of your 3 nominations\./);
  assert.ok(api.calls.includes("withdraw 2026 2"));
});

test("withdraw: someone else's nomination is refused without a delete", async () => {
  const api = fakeApi({ lists: [[nomination(5, 8, "Metaphor", OTHER)]] });
  const reply = await gotyWithdrawReply(
    api,
    { year: 2026, nominationId: 5, scope: "all" },
    MEMBER,
  );
  assert.match(textOf(viewOf(reply).components), /not yours, or it was already withdrawn/);
  assert.ok(!api.calls.some((call) => call.startsWith("withdraw")));
});

test("withdraw: an API refusal carries the request and response", async () => {
  const api = fakeApi({
    lists: [[nomination(2, 8, "Metaphor")]],
    withdraw: apiError(422, { error: "nominations_closed", message: "voting has opened" }, {
      method: "delete",
      url: "/api/v1/goty_votes/2026/nominations/2",
    }),
  });
  const reply = await gotyWithdrawReply(
    api,
    { year: 2026, nominationId: 2, scope: "mine" },
    MEMBER,
  );
  assert.ok("error" in reply);
  assert.match(reply.error, /^voting has opened/);
  assert.match(reply.error, /nominations\/2/);
});

test("autocomplete: eligible games first, ineligible ones marked with why", async () => {
  const eligible = (id: number): IGotyEligibility =>
    ({ game_id: id, year: 2026, eligible: true });
  const api = fakeApi({
    eligibility: {
      1: { game_id: 1, year: 2026, eligible: false, reason: "not_released_in_year",
        released_on: "2025-04-24" },
      2: eligible(2),
      3: { game_id: 3, year: 2026, eligible: false, reason: "release_unknown" },
    },
  });
  const cache = createGotyAutocompleteCache();
  const games = [
    { id: 1, label: "Clair Obscur (2025)" },
    { id: 2, label: "Hollow Knight Silksong (2026)" },
    { id: 3, label: "Obscure RPG (Unknown Year)" },
  ];
  const choices = await gotyNominateChoices(games, { api, cache, now: () => 1000 });
  assert.deepEqual(choices, [
    { name: "Hollow Knight Silksong (2026)", value: "2" },
    { name: "Clair Obscur (2025) [not eligible: released 2025]", value: "1" },
    { name: "Obscure RPG (Unknown Year) [not eligible: no known release]", value: "3" },
  ]);

  // A second keystroke within the cache's life asks the API nothing again.
  api.calls.length = 0;
  await gotyNominateChoices(games, { api, cache, now: () => 2000 });
  assert.deepEqual(api.calls, []);
});

test("autocomplete: with no GOTY Vote, or failing checks, games show unmarked", async () => {
  const games = [{ id: 1, label: "Clair Obscur (2025)" }];
  const noVote = await gotyNominateChoices(games, {
    api: fakeApi({ votes: [] }),
    cache: createGotyAutocompleteCache(),
  });
  assert.deepEqual(noVote, [{ name: "Clair Obscur (2025)", value: "1" }]);

  const failing = await gotyNominateChoices(games, {
    api: fakeApi({}),
    cache: createGotyAutocompleteCache(),
  });
  assert.deepEqual(failing, [{ name: "Clair Obscur (2025)", value: "1" }]);
});

test("autocomplete: checks still out at the deadline show unmarked", async () => {
  const api: IGotyVoteApi = {
    ...fakeApi({}),
    eligibility: () => new Promise(() => undefined),
  };
  const choices = await gotyNominateChoices([{ id: 1, label: "Slow (2026)" }], {
    api,
    cache: createGotyAutocompleteCache(),
    deadlineMs: 10,
  });
  assert.deepEqual(choices, [{ name: "Slow (2026)", value: "1" }]);
});
