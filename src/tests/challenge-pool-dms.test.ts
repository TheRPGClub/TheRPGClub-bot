import assert from "node:assert/strict";
import test from "node:test";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IChallengeJobDeps, IChallengePost } from "../services/ChallengeAnnouncements.js";
import type { IGameSummary, IPage } from "../services/ChallengeApi.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { buttonsOf, coverUrl, poolChallenge, poolRun, textOf } from "./challengeFixtures.js";

// The Pool goal-change DM (bot#1567, design 2B): `challenge_dm` `pool_goal_changed`, run
// through processBotJobs with a fake surface.

type Ack =
  | { id: number; status: "done"; resultText?: string }
  | { id: number; status: "failed"; error: string };

interface IFakeDeps extends IChallengeJobDeps {
  dms: { userId: string; post: IChallengePost }[];
}

function fakeDeps(): IFakeDeps {
  const deps: IFakeDeps = {
    dms: [],
    postMessage: async () => {},
    storeSignupPost: async () => {},
    poolPreview: async (_pool, page): Promise<IPage<IGameSummary>> =>
      ({ items: [], page, pages: 1, count: 0 }),
    coverImage: async () => null,
    sendDm: async (userId, post) => {
      deps.dms.push({ userId, post });
    },
    memberEmoji: () => null,
  };
  return deps;
}

async function run(
  deps: IChallengeJobDeps,
  payload: Record<string, unknown>,
  state: FeatureState | null = "live",
): Promise<Ack[]> {
  const acks: Ack[] = [];
  const api: IBotJobApi = {
    claim: async () => [],
    done: async (id, resultText) => {
      acks.push({ id, status: "done", ...(resultText === undefined ? {} : { resultText }) });
    },
    failed: async (id, error) => {
      acks.push({ id, status: "failed", error });
    },
  };
  const job: IBotJob = {
    id: 1,
    kind: "challenge_dm",
    payload,
    attempts: 1,
    requestedByUserId: null,
  };
  const surface = {
    challenges: deps,
    featureState: async () => state,
  } as unknown as IBotJobSurface;
  await processBotJobs([job], BOT_JOB_HANDLERS, surface, api);
  return acks;
}

function goalChanged(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "pool_goal_changed",
    user_id: "222",
    challenge: poolChallenge(),
    run: poolRun({
      progress: {
        in_progress: 1,
        cleared: 10,
        target: 18,
        core: { cleared: 9, total: 15 },
        optional: { cleared: 1, target: 3 },
      },
    }),
    added_core_games: [
      { game_id: 77, title: "Final Fantasy VII Remake", cover_url: coverUrl(77) },
    ],
    optional_target: { from: 2, to: 3 },
    feature_key: "challenges",
    ...extra,
  };
}

test("pool_goal_changed: DMs what the edit asks for now and the Run's new progress",
  async () => {
    const deps = fakeDeps();
    const acks = await run(deps, goalChanged());

    assert.equal(acks[0]?.status, "done");
    assert.match(
      acks[0]?.status === "done" ? acks[0].resultText ?? "" : "",
      /DMed member 222 the goal change for "Fall of Final Fantasy" \(Run \d+\)/,
    );
    const [{ userId, post }] = deps.dms;
    assert.equal(userId, "222");
    const text = textOf(post.components);
    assert.match(text, /^### Your goal changed$/m);
    assert.ok(text.includes(
      "**Fall of Final Fantasy** now asks for one more Core Game and one more Optional Game.\n",
    ), text);
    assert.match(text, /^> New Core Game: \*\*Final Fantasy VII Remake\*\*$/m);
    assert.match(text, /^> Optional Games to Clear: 2 → 3$/m);
    assert.match(text, /^Your Run: \*\*Core 9\/15 · Optional 1\/3\*\*$/m);
    assert.match(text, /Turn Challenge DMs off with \/challenge dms\.$/m);
    assert.deepEqual(
      buttonsOf(post.components).map((b) => [b.label, b.url]),
      [["Open the Challenge", "https://the-rpg-club-www.vercel.app/challenges/7"]],
    );
    // The first new Core Game's cover sits beside the text.
    assert.ok(JSON.stringify(post.components).includes(coverUrl(77)));
  });

test("pool_goal_changed: Core Games alone, several, with no target line", async () => {
  const deps = fakeDeps();
  await run(deps, goalChanged({
    added_core_games: [
      { game_id: 77, title: "Final Fantasy VII Remake", cover_url: null },
      { game_id: 78, title: "Final Fantasy XVI", cover_url: null },
    ],
    optional_target: null,
  }));

  const text = textOf(deps.dms[0]!.post.components);
  assert.match(text, /now asks for 2 more Core Games\.$/m);
  assert.match(
    text,
    /^> New Core Games: \*\*Final Fantasy VII Remake\*\* and \*\*Final Fantasy XVI\*\*$/m,
  );
  assert.doesNotMatch(text, /Optional Games to Clear/);
});

test("pool_goal_changed: a raised target alone", async () => {
  const deps = fakeDeps();
  await run(deps, goalChanged({ added_core_games: [], optional_target: { from: 0, to: 2 } }));

  const text = textOf(deps.dms[0]!.post.components);
  assert.match(text, /now asks for 2 more Optional Games\.$/m);
  assert.match(text, /^> Optional Games to Clear: 0 → 2$/m);
  assert.doesNotMatch(text, /New Core/);
});

test("pool_goal_changed: not sent while Challenges is Off", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, goalChanged(), "off");

  assert.deepEqual(deps.dms, []);
  assert.match(acks[0]?.status === "done" ? acks[0].resultText ?? "" : "", /Off/);
});

test("pool_goal_changed: a payload without a Run fails the job", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const deps = fakeDeps();
  const acks = await run(deps, goalChanged({ run: null }));

  assert.equal(acks[0]?.status, "failed");
  assert.deepEqual(deps.dms, []);
});

// The Pool Proposal DMs (bot#1569, design 2B), and the club-hosted one posted in #dev.

function proposal(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 41,
    challenge_id: 7,
    game: {
      game_id: 90,
      title: "Final Fantasy Crystal Chronicles Remastered",
      cover_url: coverUrl(90),
    },
    proposer: { user_id: "333", username: "tavi", global_name: "Tavi" },
    note: "It's the one with the chalice.",
    status: "pending",
    accepted_as: null,
    decider: null,
    created_at: "2026-11-22T11:02:00Z",
    updated_at: "2026-11-22T11:02:00Z",
    ...extra,
  };
}

test("pool_proposal: DMs the Host the game, who proposed it, the note and Decide",
  async () => {
    const deps = fakeDeps();
    const acks = await run(deps, {
      event: "pool_proposal",
      club_hosted: false,
      user_id: "111",
      challenge: poolChallenge(),
      proposal: proposal(),
      feature_key: "challenges",
    });

    assert.equal(acks[0]?.status, "done");
    const [{ userId, post }] = deps.dms;
    assert.equal(userId, "111");
    const text = textOf(post.components);
    assert.match(text, /^### New Pool Proposal$/m);
    assert.ok(text.includes("<@333> proposed **Final Fantasy Crystal Chronicles Remastered** " +
      "for **Fall of Final Fantasy**.\n"), text);
    assert.match(text, /^> It's the one with the chalice\.$/m);
    assert.match(text, /Turn Challenge DMs off with \/challenge dms\.$/m);
    assert.deepEqual(buttonsOf(post.components).map((b) => [b.label, b.customId, b.url]), [
      ["Decide", "challenge-proposal-v1:view:7:1:n", null],
      ["Open the Challenge", null, "https://the-rpg-club-www.vercel.app/challenges/7"],
    ]);
    assert.ok(JSON.stringify(post.components).includes(coverUrl(90)));
    assert.deepEqual(post.allowedMentions, { parse: [] });
  });

test("pool_proposal: a club-hosted one posts in #dev with a link, and DMs no one",
  async () => {
    const posts: { channelId: string; post: IChallengePost }[] = [];
    const deps = fakeDeps();
    deps.postMessage = async (channelId, post) => {
      posts.push({ channelId, post });
    };
    const acks = await run(deps, {
      event: "pool_proposal",
      club_hosted: true,
      challenge: poolChallenge({ name: "The Club Canon", hosted_by_club: true, host: null }),
      proposal: proposal({ game: { game_id: 91, title: "Suikoden II", cover_url: null } }),
      feature_key: "challenges",
    });

    assert.equal(acks[0]?.status, "done");
    assert.match(
      acks[0]?.status === "done" ? acks[0].resultText ?? "" : "",
      /Posted the Pool Proposal of "Suikoden II" for "The Club Canon" in the bot-dev channel/,
    );
    assert.equal(deps.dms.length, 0);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.channelId, BOT_DEV_CHANNEL_ID);
    const text = textOf(posts[0]!.post.components);
    assert.match(text, /^### Pool Proposal · club-hosted$/m);
    assert.match(text, /^\*\*Suikoden II\*\*$/m);
    assert.match(text, /^for \*\*The Club Canon\*\*, from <@333>$/m);
    assert.match(text, /Any Moderator or above can decide on the website or with/);
    assert.deepEqual(buttonsOf(posts[0]!.post.components).map((b) => b.label), [
      "Open the Challenge",
    ]);
  });

test("pool_proposal: nothing goes out while Challenges is Off", async () => {
  const deps = fakeDeps();
  let posted = false;
  deps.postMessage = async () => {
    posted = true;
  };
  const acks = await run(deps, {
    event: "pool_proposal",
    club_hosted: true,
    challenge: poolChallenge(),
    proposal: proposal(),
    feature_key: "challenges",
  }, "off");
  assert.equal(acks[0]?.status, "done");
  assert.equal(posted, false);
});

test("pool_proposal_accepted: tells the proposer what it joined as and who accepted it",
  async () => {
    const deps = fakeDeps();
    await run(deps, {
      event: "pool_proposal_accepted",
      user_id: "333",
      challenge: poolChallenge(),
      proposal: proposal({
        status: "accepted",
        accepted_as: "optional",
        decider: { user_id: "111", username: "rowan", global_name: "Rowan" },
      }),
      feature_key: "challenges",
    });

    const [{ userId, post }] = deps.dms;
    assert.equal(userId, "333");
    const text = textOf(post.components);
    assert.match(text, /^### Proposal accepted$/m);
    assert.ok(text.includes("**Final Fantasy Crystal Chronicles Remastered** is now an " +
      "Optional Game in **Fall of Final Fantasy**. Rowan accepted it.\n"), text);
    assert.match(text, /If you have a Run, Clearing it counts\./);
    assert.deepEqual(buttonsOf(post.components).map((b) => b.label), ["Open the Challenge"]);
  });

test("pool_proposal_accepted: as a Core Game", async () => {
  const deps = fakeDeps();
  await run(deps, {
    event: "pool_proposal_accepted",
    user_id: "333",
    challenge: poolChallenge(),
    proposal: proposal({ status: "accepted", accepted_as: "core" }),
    feature_key: "challenges",
  });
  const text = textOf(deps.dms[0]!.post.components);
  assert.match(text, /is now a Core Game in \*\*Fall of Final Fantasy\*\*\.$/m);
  assert.match(text, /Every Run must Clear it now\./);
});

test("pool_proposal: a payload without a proposal fails the job", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, {
    event: "pool_proposal",
    club_hosted: false,
    user_id: "111",
    challenge: poolChallenge(),
    feature_key: "challenges",
  });
  assert.equal(acks[0]?.status, "failed");
  assert.match(acks[0]?.status === "failed" ? acks[0].error : "", /proposal must be/);
});
