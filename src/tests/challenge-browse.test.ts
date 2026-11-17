import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChallengeListView,
  buildChallengeShowView,
  type IChallengeBrowseApi,
} from "../services/ChallengeBrowse.js";
import type {
  IChallenge,
  IChallengeRun,
  IPage,
  IPoolGameProgress,
} from "../services/ChallengeApi.js";
import { describeOpen } from "../functions/ChallengeCopy.js";
import { buttonsOf, game, poolChallenge, selectsOf, textOf } from "./challengeFixtures.js";

interface IFakeBrowseApi extends IChallengeBrowseApi {
  calls: string[];
}

function page<T>(items: T[], pageNumber: number, per: number): IPage<T> {
  const slice = items.slice((pageNumber - 1) * per, pageNumber * per);
  return {
    items: slice,
    page: pageNumber,
    pages: Math.max(1, Math.ceil(items.length / per)),
    count: items.length,
  };
}

function fakeApi(options: {
  challenge?: IChallenge | null;
  challenges?: IChallenge[];
  runs?: IChallengeRun[];
  games?: IPoolGameProgress[];
} = {}): IFakeBrowseApi {
  const api: IFakeBrowseApi = {
    calls: [],
    getChallenge: async (id, actingUserId) => {
      api.calls.push(`get ${id} as ${actingUserId}`);
      return options.challenge === undefined ? poolChallenge() : options.challenge;
    },
    listChallenges: async ({ actingUserId, open, page: p, per }) => {
      api.calls.push(`list open=${String(open)} page=${p} as ${actingUserId}`);
      return page(options.challenges ?? [], p, per);
    },
    listRuns: async (challengeId, actingUserId, p, per) => {
      api.calls.push(`runs ${challengeId} page=${p} per=${per} as ${actingUserId}`);
      return page(options.runs ?? [], p, per);
    },
    poolProgress: async (challengeId, actingUserId, p, per) => {
      api.calls.push(`progress ${challengeId} page=${p} per=${per} as ${actingUserId}`);
      return page(options.games ?? [], p, per);
    },
  };
  return api;
}

function run(
  id: number,
  name: string,
  status: IChallengeRun["status"],
  entries: [number, "cleared" | "in_progress"][],
  target = 3,
): IChallengeRun {
  const cleared = entries.filter(([, state]) => state === "cleared").length;
  return {
    id,
    user: { user_id: String(100 + id), username: name.toLowerCase(), global_name: name },
    status,
    started_at: "2026-09-22T12:00:00Z",
    progress: { cleared, in_progress: entries.length - cleared, target },
    entries: entries.map(([gameId, state]) =>
      ({ game_id: gameId, title: `Game ${gameId}`, state })),
  };
}

const NOW = new Date("2026-11-17T15:00:00Z");

function member(name: string, runId: number) {
  return {
    user_id: String(100 + runId),
    username: name.toLowerCase(),
    global_name: name,
    run_id: runId,
  };
}

/** The Pool's progress as the API serves it: who Cleared each game, who plays it. */
const games: IPoolGameProgress[] = [
  { ...game(1, "Final Fantasy", 1987), cleared_by: [member("ashtear", 1)], in_progress: [] },
  {
    ...game(4, "Final Fantasy IV", 1991),
    cleared_by: [member("ashtear", 1), member("tenpenny", 2)],
    in_progress: [],
  },
  {
    ...game(5, "Final Fantasy V", 1992),
    cleared_by: [member("ashtear", 1), member("Zeal", 3)],
    in_progress: [member("moogle_mail", 4)],
  },
  { ...game(10, "Final Fantasy X", 2001), cleared_by: [], in_progress: [member("tenpenny", 2)] },
];

const runs = [
  run(1, "ashtear", "finished", [[1, "cleared"], [4, "cleared"], [5, "cleared"]]),
  run(2, "tenpenny", "active", [[4, "cleared"], [10, "in_progress"]]),
  run(3, "Zeal", "abandoned", [[5, "cleared"], [10, "in_progress"]]),
  run(4, "moogle_mail", "active", [[5, "in_progress"]]),
];

async function show(
  api: IChallengeBrowseApi,
  view: "game" | "member" = "game",
  pageNumber = 1,
) {
  return buildChallengeShowView(
    { challengeId: 7, view, page: pageNumber, actingUserId: "42" },
    { api, now: () => NOW },
  );
}

test("show by game: each Pool game with who Cleared it and who has it In Progress", async () => {
  const api = fakeApi({ games, runs });
  const view = await show(api);
  const text = textOf(view.components);

  assert.match(text, /^## Fall of Final Fantasy$/m);
  assert.match(text, /Play Final Fantasy through the autumn\. Clear 3 to Finish\./);
  const closes = Math.floor(Date.parse("2026-12-22T05:00:00Z") / 1000);
  assert.ok(text.includes(
    "-# Pool · 38 games · Clear 3 · Seasonal, 22 September to 21 December · " +
      `Open, closes <t:${closes}:R>`,
  ), text);
  // The Host is the header's button, linking to their profile.
  assert.doesNotMatch(text, /Hosted by/);
  assert.deepEqual(
    buttonsOf(view.components).map((b) => [b.label, b.url]).slice(0, 1),
    [["Kaiserkaze", "https://the-rpg-club-www.vercel.app/members/111"]],
  );
  assert.match(text, /^### By game · 1 to 4 of 4$/m);
  assert.match(text, /^\*\*Final Fantasy\*\* `1987`\n-# Cleared by ashtear$/m);
  assert.match(text, /^\*\*Final Fantasy IV\*\* `1991`\n-# Cleared by ashtear, tenpenny$/m);
  assert.match(
    text,
    /^\*\*Final Fantasy V\*\* `1992`\n-# Cleared by ashtear, Zeal · In Progress: moogle\\_mail$/m,
  );
  assert.match(
    text,
    /^\*\*Final Fantasy X\*\* `2001`\n-# Cleared by nobody yet · In Progress: tenpenny$/m,
  );
  // One page of the Pool's progress: no Runs are read.
  assert.deepEqual(api.calls, ["get 7 as 42", "progress 7 page=1 per=10 as 42"]);
});

test("show by game: the buttons flip the view and page through the Pool", async () => {
  const many = Array.from({ length: 23 }, (_, i) => game(i + 1, `Game ${i + 1}`));
  const view = await show(fakeApi({ games: many }), "game", 2);

  assert.match(textOf(view.components), /^### By game · 11 to 20 of 23$/m);
  assert.deepEqual(
    buttonsOf(view.components).map((b) => [b.label, b.customId, b.disabled]),
    [
      ["Kaiserkaze", null, false],
      ["By game", "challenge-show-v1:7:g:2:u", true],
      ["By member", "challenge-show-v1:7:m:1:u", false],
      ["Previous", "challenge-show-v1:7:g:1:u", false],
      ["Next", "challenge-show-v1:7:g:3:u", false],
    ],
  );
});

test("show by member: each Run with its status and progress", async () => {
  const view = await show(fakeApi({ games, runs }), "member");
  const text = textOf(view.components);

  assert.match(text, /^### By member · 4 Runs$/m);
  assert.match(text, /^\*\*ashtear\*\* · Finished · 3 of 3 Cleared$/m);
  assert.match(text, /^\*\*tenpenny\*\* · Active · 1 of 3 Cleared · 1 In Progress$/m);
  assert.match(text, /^\*\*Zeal\*\* · Abandoned · 1 of 3 Cleared · 1 In Progress$/m);
  const labels = buttonsOf(view.components).map((b) => [b.label, b.disabled]);
  assert.deepEqual(labels.slice(1, 3), [["By game", false], ["By member", true]]);
});

test("show by member: no Runs yet says so", async () => {
  const view = await show(fakeApi({ games, runs: [] }), "member");

  assert.match(textOf(view.components), /Nobody has started a Run yet\./);
});

test("show: a Challenge that is gone or hidden from the member", async () => {
  const view = await show(fakeApi({ challenge: null }));

  assert.match(textOf(view.components), /There is no Challenge 7, or it is hidden from you\./);
});

test("show: a Closed Seasonal Challenge says when it opens", async () => {
  const challenge = poolChallenge({
    open: false,
    season: { start: "06-21", end: "09-22", crosses_new_year: false },
  });
  const view = await show(fakeApi({ challenge, games }));

  const opens = Math.floor(Date.parse("2027-06-21T04:00:00Z") / 1000);
  assert.ok(textOf(view.components).includes(`Closed, opens <t:${opens}:R>`));
});

test("a 29 February Season day falls back like the API's in a year without one", () => {
  // 2027 has no 29 February: a Season starting then opens on 1 March, and one ending then
  // ends on 28 February (so it closes as 1 March begins).
  const closed = poolChallenge({
    open: false,
    season: { start: "02-29", end: "03-31", crosses_new_year: false },
  });
  const opens = Math.floor(Date.parse("2027-03-01T05:00:00Z") / 1000);
  assert.equal(describeOpen(closed, NOW), `Closed, opens <t:${opens}:R>`);

  const open = poolChallenge({
    open: true,
    season: { start: "11-01", end: "02-29", crosses_new_year: true },
  });
  assert.equal(describeOpen(open, NOW), `Open, closes <t:${opens}:R>`);
});

test("show: a club-hosted Challenge names the club, with no Host button", async () => {
  const challenge = poolChallenge({ hosted_by_club: true, host: null });
  const view = await show(fakeApi({ challenge, games }));

  assert.match(textOf(view.components), /^-# Hosted by the club$/m);
  assert.equal(buttonsOf(view.components)[0]?.label, "By game");
});

test("show: a hidden Challenge is marked for those who may see it", async () => {
  const view = await show(fakeApi({ challenge: poolChallenge({ hidden: true }), games }));

  assert.match(textOf(view.components), /Hidden from members/);
});

test("show: a Challenge that is not a Pool opens by member, with no by-game view", async () => {
  const challenge = poolChallenge({
    challenge_format: "slots",
    pool: null,
    slots: { first_year: 1990, last_year: 1999, counts_past_play: false },
  });
  const view = await show(fakeApi({ challenge, runs }), "game");

  assert.match(textOf(view.components), /^### By member · 4 Runs$/m);
  assert.ok(!buttonsOf(view.components).some((b) => b.label === "By game"));
});

function listed(id: number, name: string, overrides: Partial<IChallenge> = {}): IChallenge {
  return poolChallenge({ id, name, run_count: null, ...overrides });
}

test("list: the Challenges with their Format, schedule and Host, and a select to show one",
  async () => {
    const api = fakeApi({
      challenges: [
        listed(9, "Summer of Suikoden", { open: false, hosted_by_club: true, host: null }),
        listed(7, "Fall of Final Fantasy"),
      ],
    });
    const view = await buildChallengeListView(
      { actingUserId: "42", filter: "all", page: 1 },
      { api, now: () => NOW },
    );
    const text = textOf(view.components);

    assert.match(text, /^## Challenges$/m);
    assert.ok(text.includes(
      "**Summer of Suikoden** · Pool · Seasonal, 22 September to 21 December · Closed\n" +
        "-# Hosted by the club\n",
    ), text);
    assert.match(
      text,
      /^\*\*Fall of Final Fantasy\*\* · Pool · .* · Open\n-# Hosted by Kaiserkaze$/m,
    );
    assert.deepEqual(api.calls, ["list open=undefined page=1 as 42"]);
    const [select] = selectsOf(view.components);
    assert.equal(select?.customId, "challenge-list-v1:show");
    assert.deepEqual(select?.options.map((o) => [o.label, o.value]), [
      ["Summer of Suikoden", "9"],
      ["Fall of Final Fantasy", "7"],
    ]);
  });

test("list: the Open filter asks the API for Open Challenges and pages", async () => {
  const challenges = Array.from({ length: 12 }, (_, i) => listed(i + 1, `Challenge ${i + 1}`));
  const api = fakeApi({ challenges });
  const view = await buildChallengeListView(
    { actingUserId: "42", filter: "open", page: 2 },
    { api, now: () => NOW },
  );

  assert.deepEqual(api.calls, ["list open=true page=2 as 42"]);
  assert.match(textOf(view.components), /^-# Open Challenges · page 2 of 2$/m);
  assert.deepEqual(
    buttonsOf(view.components).map((b) => [b.label, b.customId, b.disabled]),
    [
      ["Previous", "challenge-list-v1:open:1", false],
      ["Next", "challenge-list-v1:open:3", true],
    ],
  );
});

test("list: nothing to list says so", async () => {
  const view = await buildChallengeListView(
    { actingUserId: "42", filter: "closed", page: 1 },
    { api: fakeApi(), now: () => NOW },
  );

  assert.match(textOf(view.components), /No Closed Challenges\./);
  assert.deepEqual(selectsOf(view.components), []);
});
