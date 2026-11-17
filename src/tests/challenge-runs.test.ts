import assert from "node:assert/strict";
import test from "node:test";
import {
  abandonRunReply,
  confirmRunChange,
  deleteRunReply,
  runChoices,
  startRunReply,
  type ChallengeRunResult,
  type IChallengeRunsApi,
} from "../services/ChallengeRuns.js";
import type { IChallengeRun } from "../services/ChallengeApi.js";
import { buildMyRunsView } from "../services/ChallengeMyRuns.js";
import { apiError, buttonsOf, poolRun, textOf } from "./challengeFixtures.js";

interface IFakeRunsApi extends IChallengeRunsApi {
  calls: string[];
}

function fakeApi(options: {
  error?: unknown;
  run?: IChallengeRun | null;
  runs?: IChallengeRun[];
} = {}): IFakeRunsApi {
  const run = options.run === undefined ? poolRun() : options.run;
  const api: IFakeRunsApi = {
    calls: [],
    startRun: async (challengeId, actingUserId) => {
      api.calls.push(`start ${challengeId} as ${actingUserId}`);
      if (options.error) throw options.error;
      return run!;
    },
    getRun: async (runId, actingUserId) => {
      api.calls.push(`get ${runId} as ${actingUserId}`);
      return run;
    },
    abandonRun: async (runId, actingUserId) => {
      api.calls.push(`abandon ${runId} as ${actingUserId}`);
      if (options.error) throw options.error;
      return { ...run!, status: "abandoned" };
    },
    deleteRun: async (runId, actingUserId) => {
      api.calls.push(`delete ${runId} as ${actingUserId}`);
      if (options.error) throw options.error;
      return true;
    },
    listMemberRuns: async (userId, actingUserId, page, per) => {
      api.calls.push(`runs of ${userId} as ${actingUserId} page ${page} per ${per}`);
      const items = options.runs ?? [];
      return { items, page, pages: 1, count: items.length };
    },
  };
  return api;
}

const NOW = new Date("2026-11-17T15:00:00.000Z");

/** The text a result shows: its view's, or its error. */
function shown(result: ChallengeRunResult): string {
  return "error" in result ? result.error : textOf(result.view.components);
}

function viewOf(result: ChallengeRunResult): Extract<ChallengeRunResult, { view: unknown }> {
  assert.ok("view" in result, "error" in result ? result.error : "no view");
  return result;
}

test("start: a new Run says what it takes and where to follow it", async () => {
  const api = fakeApi({
    run: poolRun({
      progress: { in_progress: 0, cleared: 0, target: 3 },
      entries: [],
    }),
  });
  const text = shown(viewOf(
    await startRunReply({ challengeId: 7, actingUserId: "222" }, { api, now: () => NOW }),
  ));

  assert.deepEqual(api.calls, ["start 7 as 222"]);
  assert.match(text, /^## You started a Run of Fall of Final Fantasy$/m);
  assert.match(text, /Clear 3 games from its Pool to Finish\./);
  assert.match(text, /Your Game Completions and Now Playing fill it in by themselves\./);
  assert.match(text, /^-# Season closes <t:\d+:R> · \/challenge my-runs shows what's next$/m);
});

test("start: earlier play this Season counts at once", async () => {
  const api = fakeApi();
  const text = shown(viewOf(
    await startRunReply({ challengeId: 7, actingUserId: "222" }, { api, now: () => NOW }),
  ));

  assert.match(text, /Your play earlier this Season already counts: 2 of 3 Cleared\./);
  assert.match(text, /\*\*Final Fantasy X\*\* is In Progress\./);
});

test("start: a Run that Finishes at once says so", async () => {
  const api = fakeApi({
    run: poolRun({
      status: "finished",
      progress: { in_progress: 0, cleared: 3, target: 3 },
    }),
  });
  const text = shown(viewOf(
    await startRunReply({ challengeId: 7, actingUserId: "222" }, { api, now: () => NOW }),
  ));

  assert.match(text, /Your play earlier this Season already Finished it\./);
});

for (const [code, message] of [
  ["season_run_exists", "You already have a Run of this Challenge this Season."],
  ["run_active", "You already have an Active Run of this Challenge."],
  ["challenge_closed", "This Challenge is Closed."],
  ["birth_date_required", "Set your Birth Date first: this Challenge starts in your birth year."],
] as const) {
  test(`start: a 409 ${code} shows the API's message with the exchange`, async () => {
    const error = apiError(409, { error: code, message }, {
      method: "post",
      url: "/api/v1/challenges/7/runs",
      data: { data: { acting_user_id: "222" } },
    });
    const result = await startRunReply(
      { challengeId: 7, actingUserId: "222" },
      { api: fakeApi({ error }), now: () => NOW },
    );
    assert.ok("error" in result);
    const text = shown(result);

    assert.ok(text.startsWith(message), text);
    assert.match(text, /\/api\/v1\/challenges\/7\/runs/);
    assert.match(text, /"error": "\w+"/);
    assert.doesNotMatch(text, /<@&?\d+>/);
  });
}

test("abandon: asks first, saying the Run stays and the Season is spent", async () => {
  const api = fakeApi();
  const result = viewOf(await confirmRunChange(
    { action: "abandon", runId: 41, actingUserId: "222" },
    { api },
  ));
  const text = shown(result);

  assert.deepEqual(api.calls, ["get 41 as 222"]);
  assert.match(text, /^## Abandon your Run of Fall of Final Fantasy\?$/m);
  assert.match(text, /2 of 3 Cleared/);
  assert.match(text, /stays on your profile, Abandoned, until you delete it/);
  assert.match(text, /You can't start another Run of it this Season\./);
  assert.deepEqual(
    buttonsOf(result.view.components).map((b) => [b.label, b.customId]),
    [
      ["Abandon the Run", "challenge-run-v1:abandon:41"],
      ["Keep it", "challenge-run-v1:keep:41"],
    ],
  );
});

test("abandon: a Run that is not Active can't be abandoned", async () => {
  const result = await confirmRunChange(
    { action: "abandon", runId: 41, actingUserId: "222" },
    { api: fakeApi({ run: poolRun({ status: "finished" }) }) },
  );

  assert.match(shown(result), /That Run is Finished, so there is nothing to abandon\./);
  assert.deepEqual("view" in result ? buttonsOf(result.view.components) : [], []);
});

test("abandon: confirming abandons it for the clicking member", async () => {
  const api = fakeApi();
  const result = await abandonRunReply({ runId: 41, actingUserId: "222" }, { api });

  assert.deepEqual(api.calls, ["abandon 41 as 222"]);
  assert.match(shown(result), /^You abandoned your Run of Fall of Final Fantasy\./);
  assert.match(shown(result), /\/challenge delete-run/);
});

test("abandon: the API's refusal is shown with the exchange", async () => {
  const error = apiError(403, {
    error: "forbidden",
    message: "You can only change your own Runs.",
  }, { method: "post", url: "/api/v1/challenge_runs/41/abandon" });
  const result = await abandonRunReply(
    { runId: 41, actingUserId: "333" },
    { api: fakeApi({ error }) },
  );

  assert.ok("error" in result);
  assert.match(result.error, /^You can only change your own Runs\./);
  assert.match(result.error, /challenge_runs\/41\/abandon/);
});

test("delete: asks first, and an Active Run must be abandoned before", async () => {
  const active = await confirmRunChange(
    { action: "delete", runId: 41, actingUserId: "222" },
    { api: fakeApi() },
  );
  assert.match(shown(active), /That Run is Active\. Abandon it with \/challenge abandon first\./);

  const finished = viewOf(await confirmRunChange(
    { action: "delete", runId: 41, actingUserId: "222" },
    { api: fakeApi({ run: poolRun({ status: "finished" }) }) },
  ));
  assert.match(shown(finished), /^## Delete your Finished Run of Fall of Final Fantasy\?$/m);
  assert.match(shown(finished), /This can't be undone\./);
  assert.deepEqual(
    buttonsOf(finished.view.components).map((b) => b.customId),
    ["challenge-run-v1:delete:41", "challenge-run-v1:keep:41"],
  );
});

test("delete: a missing Run says so", async () => {
  const result = await confirmRunChange(
    { action: "delete", runId: 99, actingUserId: "222" },
    { api: fakeApi({ run: null }) },
  );

  assert.match(shown(result), /There is no Run 99, or it is hidden from you\./);
});

test("delete: confirming deletes it, and the API's refusal is shown", async () => {
  const api = fakeApi();
  assert.match(
    shown(await deleteRunReply({ runId: 41, actingUserId: "222" }, { api })),
    /^Deleted the Run\./,
  );
  assert.deepEqual(api.calls, ["delete 41 as 222"]);

  const error = apiError(409, {
    error: "run_active",
    message: "Abandon this Run before deleting it.",
  }, { method: "delete", url: "/api/v1/challenge_runs/41?acting_user_id=222" });
  const refused = await deleteRunReply(
    { runId: 41, actingUserId: "222" },
    { api: fakeApi({ error }) },
  );
  assert.ok("error" in refused);
  assert.match(refused.error, /^Abandon this Run before deleting it\./);
});

// /challenge my-runs: design 5C "What's next".

function myRunsDeps(runs: IChallengeRun[], covers: Record<number, string> = {}) {
  const api = fakeApi({ runs });
  const coverLookups: number[] = [];
  return {
    api,
    coverLookups,
    deps: {
      api,
      now: () => NOW,
      coverUrl: async (gameId: number) => {
        coverLookups.push(gameId);
        return covers[gameId] ?? null;
      },
    },
  };
}

function thumbnails(components: unknown): string[] {
  return JSON.stringify(components).match(/"type":11,"media":\{"url":"[^"]+"/g)
    ?.map((m) => m.replace(/.*"url":"/, "").replace(/"$/, "")) ?? [];
}

const pastRuns = [
  poolRun({
    id: 30,
    status: "finished",
    started_at: "2025-09-23T14:00:00.000Z",
    ended_at: "2025-11-14T12:00:00.000Z",
  }),
  poolRun({ id: 20, status: "abandoned", ended_at: "2024-10-01T12:00:00.000Z" }),
];

test("my-runs: each Active Run says what is left and what you play that counts", async () => {
  const { deps, api } = myRunsDeps([poolRun(), ...pastRuns], { 10: "https://img/ffx.jpg" });
  const view = await buildMyRunsView({ actingUserId: "222", past: false }, deps);
  const text = textOf(view.components);

  assert.deepEqual(api.calls, ["runs of 222 as 222 page 1 per 100"]);
  assert.match(text, /^## What's next for your Runs$/m);
  assert.match(text, /^\*\*Fall of Final Fantasy\*\* needs 1 more Cleared game\.$/m);
  assert.ok(text.includes(
    "\nYou're playing **Final Fantasy X**. Log it with /game-completion add when you finish.\n",
  ), text);
  assert.match(text, /^-# Season closes <t:\d+:R>$/m);
  assert.match(text, /^-# 2 past Runs · \/challenge my-runs past:True$/m);
  assert.deepEqual(thumbnails(view.components), ["https://img/ffx.jpg"]);
});

test("my-runs: a Run with nothing In Progress points at the Pool", async () => {
  const run = poolRun({
    progress: { in_progress: 0, cleared: 0, target: 3 },
    entries: [],
    window: { starts_on: "2026-03-01", ends_on: null },
    challenge: { id: 8, name: "Tales Forever", challenge_format: "pool", schedule: "always_open" },
  });
  const { deps } = myRunsDeps([run]);
  const view = await buildMyRunsView({ actingUserId: "222", past: false }, deps);
  const text = textOf(view.components);

  assert.match(text, /^\*\*Tales Forever\*\* needs 3 more Cleared games\.$/m);
  assert.ok(text.includes(
    "None of your Now Playing games are in its Pool. See them with /challenge show.",
  ), text);
  assert.match(text, /^-# Always Open, no end date$/m);
  assert.doesNotMatch(text, /past Runs/);
  assert.deepEqual(thumbnails(view.components), []);
});

test("my-runs: without Active Runs it says how to start one", async () => {
  const { deps } = myRunsDeps(pastRuns);
  const text = textOf((await buildMyRunsView({ actingUserId: "222", past: false }, deps))
    .components);

  assert.ok(text.includes(
    "You have no Active Runs. Find an Open Challenge with /challenge list and start a Run " +
      "with /challenge start.",
  ), text);
  assert.match(text, /^-# 2 past Runs · \/challenge my-runs past:True$/m);
});

test("my-runs: past lists the Runs that ended, newest first", async () => {
  const { deps } = myRunsDeps([poolRun(), ...pastRuns]);
  const text = textOf((await buildMyRunsView({ actingUserId: "222", past: true }, deps))
    .components);

  assert.match(text, /^## Your past Runs$/m);
  assert.match(text, /\*\*Fall of Final Fantasy\*\* · Finished · 2 of 3 Cleared/);
  assert.match(text, /-# 23 September 2025 to 14 November 2025/);
  assert.match(text, /\*\*Fall of Final Fantasy\*\* · Abandoned/);
  assert.match(text, /\/challenge delete-run/);
  assert.ok(text.indexOf("Finished") < text.indexOf("Abandoned"));
  assert.doesNotMatch(text, /needs 1 more/);
});

test("my-runs: a Run of another Format gets its progress plainly", async () => {
  const run = poolRun({
    challenge: { id: 9, name: "Years Alive", challenge_format: "slots", schedule: "always_open" },
    progress: { in_progress: 1, cleared: 29, target: 33 },
    entries: [],
    window: { starts_on: "2024-03-04", ends_on: null },
  });
  const { deps } = myRunsDeps([run]);
  const text = textOf((await buildMyRunsView({ actingUserId: "222", past: false }, deps))
    .components);

  assert.match(text, /^\*\*Years Alive\*\* · 29 of 33 Cleared · 1 In Progress$/m);
});

test("run choices: abandon offers Active Runs, delete-run the others, matching the name",
  () => {
    const runs = [
      poolRun(),
      poolRun({
        id: 30,
        status: "finished",
        started_at: "2025-09-23T14:00:00.000Z",
        challenge: { id: 8, name: "Tales Forever", challenge_format: "pool", schedule: "always_open" },
      }),
    ];

    assert.deepEqual(runChoices(runs, "abandon", ""), [{
      name: "Fall of Final Fantasy · Active · 2 of 3 Cleared · started 23 September 2026",
      value: "41",
    }]);
    assert.deepEqual(runChoices(runs, "delete", "tales").map((c) => c.value), ["30"]);
    assert.deepEqual(runChoices(runs, "delete", "final"), []);
  });
