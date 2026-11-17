import assert from "node:assert/strict";
import test from "node:test";
import type { IChallenge, IChallengeRun, IPage } from "../services/ChallengeApi.js";
import { buildMyRunsView, type IMyRunsDeps } from "../services/ChallengeMyRuns.js";
import type { IChallengeEdition } from "../services/ChallengeEditionApi.js";
import {
  santaJoinReply,
  santaLeaveReply,
  santaWithdrawReply,
  type ISantaSignupDeps,
} from "../services/ChallengeSignup.js";
import {
  apiError,
  buttonsOf,
  poolChallenge,
  santaChallenge,
  santaEdition,
  textOf,
} from "./challengeFixtures.js";

// /challenge santa join and leave, and the sign-up buttons (spec api#376, bot#1551). The
// API decides every rule; the bot finds the Edition, asks before a leave that drops a
// Santa's pick, and shows refusals as given.

interface IFakeSignup extends ISantaSignupDeps {
  calls: string[];
}

function fakeDeps(options: {
  edition?: IChallengeEdition | null;
  challenges?: IChallenge[];
  signUpError?: unknown;
  withdrawError?: unknown;
} = {}): IFakeSignup {
  const edition = options.edition === undefined ? santaEdition() : options.edition;
  const challenges = options.challenges ?? [santaChallenge()];
  const deps: IFakeSignup = {
    calls: [],
    editions: {
      getEdition: async (id, actingUserId) => {
        deps.calls.push(`get ${id} as ${actingUserId}`);
        return edition;
      },
      signUp: async (id, actingUserId) => {
        deps.calls.push(`signUp ${id} as ${actingUserId}`);
        if (options.signUpError) throw options.signUpError;
        return santaEdition({ signed_up: true, signed_up_count: 15 });
      },
      withdraw: async (id, actingUserId) => {
        deps.calls.push(`withdraw ${id} as ${actingUserId}`);
        if (options.withdrawError) throw options.withdrawError;
        return edition && { ...edition, signed_up: false };
      },
    },
    challenges: {
      getChallenge: async (id) => {
        deps.calls.push(`getChallenge ${id}`);
        return challenges.find((c) => c.id === id) ?? null;
      },
      listChallenges: async (params): Promise<IPage<IChallenge>> => {
        deps.calls.push(`list ${params.challengeFormat ?? "all"}`);
        const items = challenges.filter((c) =>
          !params.challengeFormat || c.challenge_format === params.challengeFormat);
        return { items, page: 1, pages: 1, count: items.length };
      },
    },
  };
  return deps;
}

function viewOf(result: Awaited<ReturnType<typeof santaJoinReply>>): unknown {
  assert.ok("view" in result, `expected a view, got ${JSON.stringify(result)}`);
  return result.view.components;
}

test("join: signs the member up for the open Edition and offers a way out", async () => {
  const deps = fakeDeps();
  const result = await santaJoinReply({ editionId: 12, actingUserId: "222" }, deps);

  assert.deepEqual(deps.calls, ["signUp 12 as 222"]);
  const components = viewOf(result);
  assert.equal(
    textOf(components),
    "## You're in Secret Santa 2026\n" +
      "On 1 December the draw makes you someone's Santa, and someone yours. On 25 " +
      "December everyone unwraps theirs.\n" +
      "-# 15 members signed up · Changed your mind? Leave before 1 December.",
  );
  assert.deepEqual(
    buttonsOf(components).map((b) => [b.label, b.customId]),
    [["Leave", "challenge-santa-v1:leave:12"]],
  );
});

test("join: the 5-game minimum refusal is shown as given, with the exchange", async () => {
  const message = "You need at least 5 games in your backlog to sign up. You have 3.";
  const deps = fakeDeps({
    signUpError: apiError(
      422,
      { error: "backlog_too_small", message, minimum: 5, backlog_count: 3 },
      {
        method: "post",
        url: "/api/v1/challenge_editions/12/signup",
        data: { data: { acting_user_id: "222" } },
      },
    ),
  });
  const result = await santaJoinReply({ editionId: 12, actingUserId: "222" }, deps);

  assert.ok("error" in result);
  assert.ok(result.error.startsWith(message));
  assert.match(result.error, /\/api\/v1\/challenge_editions\/12\/signup/);
  assert.match(result.error, /backlog_too_small/);
});

test("join: with no Challenge named, finds the one Secret Santa taking sign-ups", async () => {
  const deps = fakeDeps({ challenges: [poolChallenge(), santaChallenge()] });
  const result = await santaJoinReply({ challengeId: null, actingUserId: "222" }, deps);

  assert.deepEqual(deps.calls, ["list assignment", "signUp 12 as 222"]);
  assert.match(textOf(viewOf(result)), /^## You're in Secret Santa 2026/);
});

test("join: says so when no Secret Santa is taking sign-ups", async () => {
  const drawn = santaChallenge();
  drawn.assignment!.edition!.phase = "picking";
  const deps = fakeDeps({ challenges: [drawn] });
  const result = await santaJoinReply({ challengeId: null, actingUserId: "222" }, deps);

  assert.equal(
    textOf(viewOf(result)),
    "No Secret Santa is taking sign-ups right now. Sign-up opens the day after each reveal.",
  );
  assert.deepEqual(deps.calls, ["list assignment"]);
});

test("join: asks which one when several Secret Santas take sign-ups", async () => {
  const other = santaChallenge({ id: 10, name: "Spooky Santa" });
  other.assignment = { ...other.assignment!, edition: { ...other.assignment!.edition!, id: 13 } };
  const deps = fakeDeps({ challenges: [santaChallenge(), other] });
  const result = await santaJoinReply({ challengeId: null, actingUserId: "222" }, deps);

  assert.match(
    textOf(viewOf(result)),
    /^Secret Santa and Spooky Santa both take sign-ups\. Pick one with the challenge option\.$/,
  );
});

test("join: a named Challenge that isn't a Secret Santa is turned away", async () => {
  const deps = fakeDeps({ challenges: [poolChallenge()] });
  const result = await santaJoinReply({ challengeId: 7, actingUserId: "222" }, deps);

  assert.equal(
    textOf(viewOf(result)),
    "Fall of Final Fantasy isn't a Secret Santa. Start a Run of it with /challenge start.",
  );
});

test("join: a named Secret Santa uses its latest Edition", async () => {
  const deps = fakeDeps();
  await santaJoinReply({ challengeId: 9, actingUserId: "222" }, deps);

  assert.deepEqual(deps.calls, ["getChallenge 9", "signUp 12 as 222"]);
});

test("leave: before the cutoff takes the member off at once", async () => {
  const deps = fakeDeps({ edition: santaEdition({ signed_up: true }) });
  const result = await santaLeaveReply({ editionId: 12, actingUserId: "222" }, deps);

  assert.deepEqual(deps.calls, ["get 12 as 222", "withdraw 12 as 222"]);
  assert.equal(
    textOf(viewOf(result)),
    "You left Secret Santa 2026. Changed your mind? Sign up again before 1 December.",
  );
});

test("leave: after the draw asks first, since it drops the Santa's pick", async () => {
  const deps = fakeDeps({
    edition: santaEdition({
      phase: "picking",
      signup_open: false,
      signed_up: true,
      members: [{ user_id: "222", username: "lufia", left_out: false, withdrawn: false }],
    }),
  });
  const result = await santaLeaveReply({ editionId: 12, actingUserId: "222" }, deps);

  assert.deepEqual(deps.calls, ["get 12 as 222"]);
  const components = viewOf(result);
  assert.equal(
    textOf(components),
    "## Leave Secret Santa 2026?\n" +
      "The draw is done, so leaving now drops your pick: the member you're Santa for gets " +
      "a random game from their backlog on 15 December instead. Your own Secret Santa Run " +
      "is Abandoned. This can't be undone.",
  );
  assert.deepEqual(
    buttonsOf(components).map((b) => [b.label, b.customId]),
    [
      ["Leave Secret Santa", "challenge-santa-v1:withdraw:12"],
      ["Stay in", "challenge-santa-v1:stay:12"],
    ],
  );
});

test("leave: a member the draw left out gets the API's answer, not the question", async () => {
  const deps = fakeDeps({
    edition: santaEdition({
      phase: "picking",
      signed_up: true,
      members: [{ user_id: "222", username: "lufia", left_out: true, withdrawn: false }],
    }),
    withdrawError: apiError(
      409,
      { error: "not_drawn", message: "The draw left you out, so there's nothing to leave." },
      { method: "delete", url: "/api/v1/challenge_editions/12/signup?acting_user_id=222" },
    ),
  });
  const result = await santaLeaveReply({ editionId: 12, actingUserId: "222" }, deps);

  assert.ok("error" in result);
  assert.ok(result.error.startsWith("The draw left you out, so there's nothing to leave."));
});

test("withdraw: leaves after the draw once confirmed", async () => {
  const deps = fakeDeps({ edition: santaEdition({ phase: "picking", signed_up: true }) });
  const result = await santaWithdrawReply({ editionId: 12, actingUserId: "222" }, deps);

  assert.deepEqual(deps.calls, ["withdraw 12 as 222"]);
  assert.equal(
    textOf(viewOf(result)),
    "You left Secret Santa 2026. The member you were Santa for gets a random game on " +
      "15 December.",
  );
});

test("withdraw: from the pick deadline on, the API's refusal is shown", async () => {
  const message = "Picks for the 2026 Edition closed on 15 December 2026.";
  const deps = fakeDeps({
    withdrawError: apiError(
      409,
      { error: "picks_closed", message },
      { method: "delete", url: "/api/v1/challenge_editions/12/signup?acting_user_id=222" },
    ),
  });
  const result = await santaWithdrawReply({ editionId: 12, actingUserId: "222" }, deps);

  assert.ok("error" in result);
  assert.ok(result.error.startsWith(message));
});

// /challenge my-runs for Secret Santa (design 5C): Assignment Runs get their advice, and
// an Edition the member signed up for shows before the draw gives them a Run.

function thumbnails(components: unknown): string[] {
  return JSON.stringify(components).match(/"type":11,"media":\{"url":"[^"]+"/g)
    ?.map((m) => m.replace(/.*"url":"/, "").replace(/"$/, "")) ?? [];
}

function santaRun(overrides: Partial<IChallengeRun> = {}): IChallengeRun {
  return {
    id: 51,
    challenge: {
      id: 9,
      name: "Secret Santa",
      challenge_format: "assignment",
      schedule: "always_open",
    },
    user: { user_id: "222", username: "lufia", global_name: "Lufia" },
    status: "active",
    started_at: "2026-12-01T05:00:00.000Z",
    ended_at: null,
    window: { starts_on: "2026-12-25", ends_on: "2027-12-24" },
    progress: { in_progress: 0, cleared: 0, target: 1 },
    entries: [],
    edition: { id: 12, year: 2026 },
    assignment: { game: null, picked_randomly: null, santa: null },
    ...overrides,
  };
}

function myRunsDeps(runs: IChallengeRun[], signups: IChallengeEdition[] = []): IMyRunsDeps {
  return {
    api: {
      listMemberRuns: async (_userId, _acting, page) =>
        ({ items: runs, page, pages: 1, count: runs.length }),
    },
    coverUrl: async () => null,
    santaSignups: async () => signups,
    now: () => new Date("2026-12-10T15:00:00.000Z"),
  };
}

const vagrantStory = {
  game_id: 77,
  title: "Vagrant Story",
  cover_url: "https://img/vagrant.jpg",
};

test("my-runs: before the reveal, the Santa is still picking", async () => {
  const view = await buildMyRunsView(
    { actingUserId: "222", past: false },
    myRunsDeps([santaRun()]),
  );
  const text = textOf(view.components);

  assert.ok(text.includes(
    "**Secret Santa 2026**: your Santa is picking a game from your backlog. It's revealed " +
      "on 25 December.\n",
  ), text);
  assert.match(text, /^-# Closes <t:\d+:R>$/m);
});

test("my-runs: after the reveal, the picked game and what to do with it", async () => {
  const run = santaRun({
    assignment: { game: vagrantStory, picked_randomly: false, santa: null },
  });
  const deps = { ...myRunsDeps([run]), now: () => new Date("2027-01-03T15:00:00.000Z") };
  const view = await buildMyRunsView({ actingUserId: "222", past: false }, deps);
  const text = textOf(view.components);

  assert.ok(text.includes(
    "**Secret Santa 2026**: your Santa picked **Vagrant Story**. Clear it to Finish: " +
      "start it with /now-playing add.",
  ), text);
  assert.deepEqual(thumbnails(view.components), ["https://img/vagrant.jpg"]);
});

test("my-runs: a random pick being played", async () => {
  const run = santaRun({
    assignment: { game: vagrantStory, picked_randomly: true, santa: null },
    progress: { in_progress: 1, cleared: 0, target: 1 },
    entries: [{ game_id: 77, title: "Vagrant Story", state: "in_progress" }],
  });
  const deps = { ...myRunsDeps([run]), now: () => new Date("2027-01-03T15:00:00.000Z") };
  const text = textOf((await buildMyRunsView({ actingUserId: "222", past: false }, deps))
    .components);

  assert.ok(text.includes(
    "**Secret Santa 2026**: **Vagrant Story** was picked for you at random. You're playing " +
      "it. Log it with /game-completion add when you finish.",
  ), text);
});

test("my-runs: no game could be picked", async () => {
  const deps = { ...myRunsDeps([santaRun()]), now: () => new Date("2027-01-03T15:00:00.000Z") };
  const text = textOf((await buildMyRunsView({ actingUserId: "222", past: false }, deps))
    .components);

  assert.ok(text.includes(
    "**Secret Santa 2026**: no game in your backlog could be picked, so this Run can't Finish.",
  ), text);
});

test("my-runs: an Edition the member signed up for shows until the draw", async () => {
  const view = await buildMyRunsView(
    { actingUserId: "222", past: false },
    myRunsDeps([], [santaEdition({ signed_up: true })]),
  );
  const text = textOf(view.components);

  assert.match(
    text,
    /^\*\*Secret Santa 2026\*\* · you're signed up\. The draw is on 1 December\.$/m,
  );
  assert.doesNotMatch(text, /You have no Active Runs/);
});
