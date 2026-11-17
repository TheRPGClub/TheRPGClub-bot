import assert from "node:assert/strict";
import test from "node:test";
import { RESTJSONErrorCodes } from "discord.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { parseSantaPickId } from "../functions/ChallengeCustomIds.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IChallengeJobDeps, IChallengePost } from "../services/ChallengeAnnouncements.js";
import type { IChallenge, IPage } from "../services/ChallengeApi.js";
import type { ISantaView } from "../services/ChallengeEditionApi.js";
import {
  santaChooseReply,
  santaPickReply,
  type ISantaPickDeps,
} from "../services/ChallengeSantaPick.js";
import {
  apiError,
  backlogEntry,
  buttonsOf,
  game,
  santaChallenge,
  santaEdition,
  santaView,
  selectsOf,
  textOf,
} from "./challengeFixtures.js";

// The Santa's pick and the pick reminder DM (spec api#376, bot#1552), design 7C "Gift
// tags": a private view of the recipient's eligible backlog with taste hints, the pick
// recorded through the API, and a DM for Santas who haven't picked.

interface IFakePick extends ISantaPickDeps {
  calls: string[];
}

function picking(): IChallenge {
  const challenge = santaChallenge();
  return santaChallenge({
    assignment: {
      ...challenge.assignment!,
      edition: { ...challenge.assignment!.edition!, phase: "picking" },
    },
  });
}

function fakeDeps(options: {
  view?: ISantaView | null;
  challenges?: IChallenge[];
  getError?: unknown;
  pickError?: unknown;
} = {}): IFakePick {
  const view = options.view === undefined ? santaView() : options.view;
  const challenges = options.challenges ?? [picking()];
  const deps: IFakePick = {
    calls: [],
    editions: {
      getSanta: async (id, actingUserId, query) => {
        deps.calls.push(`getSanta ${id} as ${actingUserId}${query ? ` q=${query}` : ""}`);
        if (options.getError) throw options.getError;
        if (!view || !query) return view;
        const q = query.toLowerCase();
        return {
          ...view,
          backlog: view.backlog.filter((e) => e.game?.title.toLowerCase().includes(q)),
        };
      },
      pick: async (id, actingUserId, gameId) => {
        deps.calls.push(`pick ${id} as ${actingUserId}: ${gameId}`);
        if (options.pickError) throw options.pickError;
        const entry = view!.backlog.find((e) => e.gamedb_game_id === gameId)!;
        return {
          ...view!,
          pick: { game: entry.game!, picked_at: "2026-12-03T10:00:00Z", picked_randomly: false },
        };
      },
    },
    challenges: {
      getChallenge: async (id) => {
        deps.calls.push(`getChallenge ${id}`);
        return challenges.find((c) => c.id === id) ?? null;
      },
      listChallenges: async (params): Promise<IPage<IChallenge>> => {
        deps.calls.push(`list ${params.challengeFormat ?? "all"}`);
        return { items: challenges, page: 1, pages: 1, count: challenges.length };
      },
    },
  };
  return deps;
}

function viewOf(result: Awaited<ReturnType<typeof santaPickReply>>): unknown {
  assert.ok("view" in result, `expected a view, got ${JSON.stringify(result)}`);
  return result.view.components;
}

const SANTA = { editionId: 12, actingUserId: "222" };

test("pick: the recipient's eligible backlog with taste hints, privately", async () => {
  const deps = fakeDeps();
  const components = viewOf(await santaPickReply(SANTA, deps));

  assert.deepEqual(deps.calls, ["getSanta 12 as 222"]);
  assert.equal(
    textOf(components),
    "## You're Lufia's Santa\n" +
      "Pick one game from their backlog. Nobody else sees this. Picks close on 15 December, " +
      "and Secret Santa 2026 is revealed on 25 December.\n" +
      "-# To help you choose · Lufia plays most on PlayStation 2 · Their top genres: " +
      "Role-playing (RPG), Adventure and Strategy",
  );
  const [select] = selectsOf(components);
  assert.equal(select?.customId, "challenge-santa-pick-v1:choose:12:1");
  assert.deepEqual(select?.options.map((o) => [o.label, o.value, o.default]), [
    ["Shadow Hearts: Covenant", "1", false],
    ["Dragon Quest XI S", "2", false],
    ["Chained Echoes", "3", false],
  ]);
  // The mock's HowLongToBeat time; a game without one shows its release year instead.
  assert.match(JSON.stringify(components), /"description":"PlayStation 2 · about 50 hours"/);
  assert.match(JSON.stringify(components), /"description":"Nintendo Switch · about 80 hours"/);
  assert.match(JSON.stringify(components), /"label":"Chained Echoes","value":"3"/);
  assert.match(JSON.stringify(components), /"description":"1993"/);
  assert.match(JSON.stringify(components), /"placeholder":"Pick a game for Lufia"/);
  assert.deepEqual(
    buttonsOf(components).map((b) => [b.label, b.customId]),
    [["Search their backlog", "challenge-santa-pick-v1:search:12:1"]],
  );
});

test("pick: no taste hints when the API has none", async () => {
  const deps = fakeDeps({
    view: santaView({ taste: { genres: [], platform: null } }),
  });
  const text = textOf(viewOf(await santaPickReply(SANTA, deps)));
  assert.doesNotMatch(text, /To help you choose/);
});

test("pick: with no Challenge named, finds the one Secret Santa taking picks", async () => {
  const deps = fakeDeps();
  await santaPickReply({ challengeId: null, actingUserId: "222" }, deps);

  assert.deepEqual(deps.calls, ["list assignment", "getSanta 12 as 222"]);
});

test("pick: says so when no Secret Santa is taking picks", async () => {
  const deps = fakeDeps({ challenges: [santaChallenge()] });
  const result = await santaPickReply({ challengeId: null, actingUserId: "222" }, deps);
  const text = textOf(viewOf(result));

  assert.match(text, /No Secret Santa is taking picks right now/);
});

test("pick: a member who isn't a Santa gets the API's answer with the exchange", async () => {
  const deps = fakeDeps({
    getError: apiError(
      403,
      { error: "not_a_santa", message: "You aren't a Santa in the 2026 Edition." },
      { method: "get", url: "/api/v1/challenge_editions/12/santa?acting_user_id=222" },
    ),
  });
  const result = await santaPickReply(SANTA, deps);

  assert.ok("error" in result);
  assert.match(result.error, /^You aren't a Santa in the 2026 Edition\./);
  assert.match(result.error, /challenge_editions\/12\/santa/);
  assert.match(result.error, /"status": 403/);
});

test("pick: a long backlog is paged 25 at a time", async () => {
  const backlog = Array.from({ length: 30 }, (_, i) => backlogEntry(i + 1, `Game ${i + 1}`));
  const deps = fakeDeps({ view: santaView({ backlog }) });

  const first = viewOf(await santaPickReply(SANTA, deps));
  assert.equal(selectsOf(first)[0]?.options.length, 25);
  assert.match(JSON.stringify(first), /"placeholder":"Pick a game for Lufia \(1 of 2\)"/);
  assert.deepEqual(buttonsOf(first).map((b) => [b.label, b.customId, b.disabled]), [
    ["Previous", "challenge-santa-pick-v1:page:12:0", true],
    ["More games", "challenge-santa-pick-v1:page:12:2", false],
    ["Search their backlog", "challenge-santa-pick-v1:search:12:1"],
  ].map(([label, id, disabled]) => [label, id, disabled ?? false]));

  const second = viewOf(await santaPickReply({ ...SANTA, page: 2 }, deps));
  const [select] = selectsOf(second);
  assert.equal(select?.customId, "challenge-santa-pick-v1:choose:12:2");
  assert.deepEqual(select?.options.map((o) => o.label), [
    "Game 26", "Game 27", "Game 28", "Game 29", "Game 30",
  ]);
});

test("pick: the same game twice in a backlog is offered once", async () => {
  const deps = fakeDeps({
    view: santaView({
      backlog: [backlogEntry(1, "Grandia II"), backlogEntry(1, "Grandia II", "Dreamcast")],
    }),
  });
  const [select] = selectsOf(viewOf(await santaPickReply(SANTA, deps)));
  assert.equal(select?.options.length, 1);
});

test("pick: a search narrows the backlog through the API", async () => {
  const deps = fakeDeps();
  const components = viewOf(await santaPickReply({ ...SANTA, query: "dragon" }, deps));

  assert.deepEqual(deps.calls, ["getSanta 12 as 222 q=dragon"]);
  assert.deepEqual(selectsOf(components)[0]?.options.map((o) => o.label), ["Dragon Quest XI S"]);
  assert.equal(selectsOf(components)[0]?.customId, "challenge-santa-pick-v1:choose:12:1:dragon");
  assert.match(textOf(components), /^-# 1 game in Lufia's backlog matches "dragon"\.$/m);
  assert.deepEqual(buttonsOf(components).map((b) => [b.label, b.customId]), [
    ["Search their backlog", "challenge-santa-pick-v1:search:12:1:dragon"],
    ["Show all", "challenge-santa-pick-v1:page:12:1"],
  ]);
});

test("pick: a search with no match says so, with a way back", async () => {
  const deps = fakeDeps();
  const components = viewOf(await santaPickReply({ ...SANTA, query: "zelda" }, deps));

  assert.equal(selectsOf(components).length, 0);
  assert.match(textOf(components), /No game in Lufia's backlog matches "zelda"\./);
  assert.ok(buttonsOf(components).some((b) => b.label === "Show all"));
});

test("pick: an empty backlog has nothing to pick yet", async () => {
  const deps = fakeDeps({ view: santaView({ backlog: [] }) });
  const components = viewOf(await santaPickReply(SANTA, deps));

  assert.equal(selectsOf(components).length, 0);
  assert.match(
    textOf(components),
    /Lufia's backlog has no games they haven't Cleared, so there is nothing to pick yet\./,
  );
});

test("choose: records the pick and shows it, still changeable", async () => {
  const deps = fakeDeps();
  const components = viewOf(await santaChooseReply({ ...SANTA, gameId: 2, page: 1 }, deps));

  assert.deepEqual(deps.calls, ["pick 12 as 222: 2"]);
  assert.match(
    textOf(components),
    /^You picked \*\*Dragon Quest XI S\*\* for Lufia\. Nobody else sees this\. You can change /m,
  );
  assert.match(
    textOf(components),
    /it until picks close on 15 December\. Secret Santa 2026 is revealed on 25 December\.$/m,
  );
  const [select] = selectsOf(components);
  assert.deepEqual(select?.options.filter((o) => o.default).map((o) => o.value), ["2"]);
});

test("choose: a refusal is shown as given, with the exchange", async () => {
  const deps = fakeDeps({
    pickError: apiError(
      409,
      { error: "picks_closed", message: "Picks for the 2026 Edition closed on 15 December 2026." },
      {
        method: "put",
        url: "/api/v1/challenge_editions/12/santa/pick",
        data: { data: { acting_user_id: "222", game_id: 2 } },
      },
    ),
  });
  const result = await santaChooseReply({ ...SANTA, gameId: 2, page: 1 }, deps);

  assert.ok("error" in result);
  assert.match(result.error, /^Picks for the 2026 Edition closed on 15 December 2026\./);
  assert.match(result.error, /"game_id":2|"game_id": 2/);
});

test("pick: once picks close, the pick is shown without the list", async () => {
  const deps = fakeDeps({
    view: santaView({
      picks_open: false,
      pick: {
        game: game(4, "Grandia II"),
        picked_at: "2026-12-15T05:00:00Z",
        picked_randomly: true,
      },
    }),
  });
  const components = viewOf(await santaPickReply(SANTA, deps));

  assert.equal(selectsOf(components).length, 0);
  assert.equal(buttonsOf(components).length, 0);
  assert.match(
    textOf(components),
    /^Picks are closed\. \*\*Grandia II\*\* was picked for Lufia at random\.$/m,
  );
});

test("custom IDs: a search keeps its words, colons included", () => {
  assert.deepEqual(parseSantaPickId("challenge-santa-pick-v1:page:12:3:ff: tactics"), {
    action: "page",
    editionId: 12,
    page: 3,
    query: "ff: tactics",
  });
  assert.equal(parseSantaPickId("challenge-santa-pick-v1:nope:12:1"), null);
  assert.equal(parseSantaPickId("challenge-santa-pick-v1:page:x:1"), null);
});

// The pick reminder DM, through the job runner.

type Ack =
  | { id: number; status: "done"; resultText?: string }
  | { id: number; status: "failed"; error: string };

function fakeJobApi(): IBotJobApi & { acks: Ack[] } {
  const acks: Ack[] = [];
  return {
    acks,
    claim: async () => [],
    done: async (id, resultText) => {
      acks.push(
        resultText === undefined ? { id, status: "done" } : { id, status: "done", resultText },
      );
    },
    failed: async (id, error) => {
      acks.push({ id, status: "failed", error });
    },
  };
}

function jobDeps(dmError?: unknown): IChallengeJobDeps & {
  dms: { userId: string; post: IChallengePost }[];
} {
  const dms: { userId: string; post: IChallengePost }[] = [];
  return {
    dms,
    postMessage: async () => "1",
    storeSignupPost: async () => {},
    sendDm: async (userId, post) => {
      if (dmError) throw dmError;
      dms.push({ userId, post });
    },
    poolPreview: async (_pool, page) => ({ items: [], page, pages: 1, count: 0 }),
    coverImage: async () => null,
    memberEmoji: () => null,
  };
}

async function remind(
  deps: IChallengeJobDeps,
  payload: Record<string, unknown>,
  state: FeatureState | null = "live",
): Promise<Ack[]> {
  const api = fakeJobApi();
  const job: IBotJob = {
    id: 1,
    kind: "challenge_dm",
    payload,
    attempts: 1,
    requestedByUserId: null,
  };
  const surface = { challenges: deps, featureState: async () => state } as unknown as
    IBotJobSurface;
  await processBotJobs([job], BOT_JOB_HANDLERS, surface, api);
  return api.acks;
}

function reminder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "pick_reminder",
    user_id: "222",
    challenge: picking(),
    edition: santaEdition({ phase: "picking", signup_open: false }),
    recipient: { user_id: "101", username: "lufia", global_name: "Lufia" },
    days_left: 2,
    feature_key: "challenges",
    ...overrides,
  };
}

test("pick_reminder: DMs the Santa with the deadline and a Pick now button", async () => {
  const deps = jobDeps();
  const acks = await remind(deps, reminder());

  assert.equal(acks[0]?.status, "done", JSON.stringify(acks));
  assert.equal(deps.dms.length, 1);
  const [{ userId, post }] = deps.dms;
  assert.equal(userId, "222");
  const deadline = Date.UTC(2026, 11, 15, 5) / 1000;
  assert.equal(
    textOf(post.components),
    "## Secret Santa: pick Lufia's game\n" +
      `You haven't picked yet. Picks close <t:${deadline}:R>, on 15 December. If you don't ` +
      "pick, a random game from Lufia's backlog is picked for them.\n" +
      "-# Turn Challenge DMs off with /challenge dms",
  );
  assert.deepEqual(buttonsOf(post.components).map((b) => [b.label, b.customId, b.style]), [
    ["Pick now", "challenge-santa-pick-v1:open:12:1", 1],
  ]);
  assert.match(
    (acks[0] as { resultText?: string }).resultText ?? "",
    /DMed member 222 the pick reminder for "Secret Santa" 2026/,
  );
});

test("pick_reminder: closed DMs are acked done with the reason", async () => {
  const closed = Object.assign(new Error("Cannot send messages to this user"), {
    code: RESTJSONErrorCodes.CannotSendMessagesToThisUser,
  });
  const acks = await remind(jobDeps(closed), reminder());

  assert.equal(acks[0]?.status, "done");
  assert.match((acks[0] as { resultText?: string }).resultText ?? "", /DMs are closed/);
});

test("pick_reminder: a payload without a recipient fails, naming it", async () => {
  const acks = await remind(jobDeps(), reminder({ recipient: null }));

  assert.equal(acks[0]?.status, "failed");
  assert.match((acks[0] as { error: string }).error, /recipient/);
});
