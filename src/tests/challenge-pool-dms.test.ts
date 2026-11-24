import assert from "node:assert/strict";
import test from "node:test";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IChallengeJobDeps, IChallengePost } from "../services/ChallengeAnnouncements.js";
import type { IGameSummary, IPage } from "../services/ChallengeApi.js";
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
