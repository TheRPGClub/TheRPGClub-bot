import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, CHALLENGES_CHANNEL_ID } from "../config/channels.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IChallengeJobDeps, IChallengePost } from "../services/ChallengeAnnouncements.js";
import type { IGameSummary, IPage, IPoolDefinition } from "../services/ChallengeApi.js";
import {
  buttonsOf,
  galleryUrls,
  game,
  poolChallenge,
  poolRun,
  textOf,
} from "./challengeFixtures.js";

type Ack =
  | { id: number; status: "done"; resultText?: string }
  | { id: number; status: "failed"; error: string };

function fakeApi(): IBotJobApi & { acks: Ack[] } {
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

interface IFakeChallengeDeps extends IChallengeJobDeps {
  posts: { channelId: string; post: IChallengePost }[];
  previews: { pool: IPoolDefinition; page: number; per: number }[];
  coverLookups: number[];
}

/** A small solid PNG standing in for a game's cover. */
async function coverPng(): Promise<Buffer> {
  return sharp({
    create: { width: 30, height: 40, channels: 3, background: { r: 200, g: 120, b: 40 } },
  }).png().toBuffer();
}

function fakeDeps(options: {
  preview?: IGameSummary[];
  previewError?: unknown;
  /** Game IDs with a cover; every game has one when left out. */
  covered?: number[];
} = {}): IFakeChallengeDeps {
  const deps: IFakeChallengeDeps = {
    posts: [],
    previews: [],
    coverLookups: [],
    coverImage: async (gameId) => {
      deps.coverLookups.push(gameId);
      return !options.covered || options.covered.includes(gameId) ? coverPng() : null;
    },
    postMessage: async (channelId, post) => {
      deps.posts.push({ channelId, post });
    },
    poolPreview: async (pool, page, per): Promise<IPage<IGameSummary>> => {
      deps.previews.push({ pool, page, per });
      if (options.previewError) throw options.previewError;
      const items = options.preview ?? [];
      return { items, page, pages: 1, count: items.length };
    },
    sendDm: async () => {
      throw new Error("The #challenges posts send no DMs.");
    },
    memberEmoji: () => null,
  };
  return deps;
}

function surface(challenges: IChallengeJobDeps, state: FeatureState | null): IBotJobSurface {
  return { challenges, featureState: async () => state } as unknown as IBotJobSurface;
}

function job(payload: Record<string, unknown>): IBotJob {
  return { id: 1, kind: "challenge_announce", payload, attempts: 1, requestedByUserId: "111" };
}

async function run(
  deps: IChallengeJobDeps,
  payload: Record<string, unknown>,
  state: FeatureState | null = "live",
): Promise<Ack[]> {
  const api = fakeApi();
  await processBotJobs([job(payload)], BOT_JOB_HANDLERS, surface(deps, state), api);
  return api.acks;
}

const finalFantasies = [
  "Final Fantasy", "Final Fantasy II", "Final Fantasy III", "Final Fantasy IV",
  "Final Fantasy V", "Final Fantasy VI", "Final Fantasy VII", "Final Fantasy Tactics",
  "Final Fantasy VIII", "Final Fantasy IX",
].map((title, index) => game(index + 1, title));

function created(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "challenge_created",
    challenge: poolChallenge(),
    feature_key: "challenges",
    pool_games: finalFantasies,
    ...extra,
  };
}

test("challenge_created: a Live Feature posts the cover wall in #challenges", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, created());

  assert.equal(acks[0]?.status, "done");
  assert.equal(deps.posts.length, 1);
  const [{ channelId, post }] = deps.posts;
  assert.equal(channelId, CHALLENGES_CHANNEL_ID);
  const text = textOf(post.components);
  assert.match(text, /^# Fall of Final Fantasy$/m);
  assert.match(text, /^-# New Challenge · hosted by <@111>$/m);
  assert.match(text, /Play Final Fantasy through the autumn\./);
  assert.match(text, /^\*\*Pool\*\* 38 games from the Final Fantasy franchise$/m);
  assert.match(text, /^\*\*To Finish\*\* Clear 3$/m);
  assert.match(text, /^\*\*Season\*\* 22 September to 21 December, every year$/m);
  assert.match(text, /^-# Showing 10 of 38 games in the Pool$/m);
  assert.deepEqual(galleryUrls(post.components), finalFantasies.map((g) => g.cover_url));
  assert.deepEqual(
    buttonsOf(post.components).map((b) => b.label),
    ["Start a Run", "See all 38 games"],
  );
  // The Host is named, never pinged.
  assert.deepEqual(post.allowedMentions, { parse: [] });
  assert.deepEqual(deps.previews, []);
});

test("challenge_created: Preview posts in the bot-dev channel and says so", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, created(), "preview");

  assert.equal(deps.posts[0]?.channelId, BOT_DEV_CHANNEL_ID);
  const ack = acks[0];
  assert.equal(ack?.status, "done");
  assert.match(ack?.status === "done" ? ack.resultText ?? "" : "", /^Preview: posted to the/);
});

test("challenge_created: an Off Feature posts nothing", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, created(), "off");

  assert.equal(acks[0]?.status, "done");
  assert.deepEqual(deps.posts, []);
});

test("challenge_created: without pool_games the covers come from the Pool preview", async () => {
  const deps = fakeDeps({ preview: finalFantasies.slice(0, 4) });
  const payload = created();
  delete payload.pool_games;
  await run(deps, payload);

  assert.deepEqual(deps.previews, [{
    pool: {
      franchise_ids: [5],
      collection_ids: [],
      included_game_ids: [],
      excluded_game_ids: [],
    },
    page: 1,
    per: 10,
  }]);
  const { post } = deps.posts[0]!;
  assert.equal(galleryUrls(post.components).length, 4);
  assert.match(textOf(post.components), /^-# Showing 4 of 38 games in the Pool$/m);
});

test("challenge_created: a failed Pool preview still posts, without covers", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const deps = fakeDeps({ previewError: new Error("API down") });
  const payload = created();
  delete payload.pool_games;
  const acks = await run(deps, payload);

  assert.equal(acks[0]?.status, "done");
  const { post } = deps.posts[0]!;
  assert.deepEqual(galleryUrls(post.components), []);
  assert.match(textOf(post.components), /^\*\*Pool\*\* 38 games from the Final Fantasy/m);
  assert.doesNotMatch(textOf(post.components), /Showing/);
});

test("challenge_created: games without a cover stay out of the gallery", async () => {
  const deps = fakeDeps();
  const games = [game(1, "Suikoden"), { ...game(2, "Suikoden II"), cover_url: null }];
  await run(deps, created({ pool_games: games }));

  const { post } = deps.posts[0]!;
  assert.deepEqual(galleryUrls(post.components), ["https://img.example/1.jpg"]);
  assert.match(textOf(post.components), /^-# Showing 1 of 38 games in the Pool$/m);
});

test("challenge_created: a club-hosted Always Open Challenge with an end date", async () => {
  const deps = fakeDeps();
  const challenge = poolChallenge({
    hosted_by_club: true,
    host: null,
    schedule: "always_open",
    season: null,
    ends_on: "2027-03-03",
    pool: {
      target: "all",
      franchises: [{ franchise_id: 9, name: "Suikoden" }],
      collections: [{ collection_id: 4, name: "Genso Suikogaiden" }],
      included_games: [{ game_id: 30, title: "Tierkreis" }],
      excluded_games: [],
      game_count: 10,
    },
  });
  await run(deps, created({ challenge, pool_games: [] }));

  const text = textOf(deps.posts[0]!.post.components);
  assert.match(text, /^-# New Challenge · hosted by the club$/m);
  assert.ok(text.includes(
    "**Pool** 10 games from the Suikoden franchise, the Genso Suikogaiden collection " +
      "and 1 game added by hand\n",
  ));
  assert.match(text, /^\*\*To Finish\*\* Clear every game in the Pool$/m);
  assert.match(text, /^\*\*Always Open\*\* until 3 March 2027$/m);
});

test("challenge_created: an Always Open Challenge with no end date says so", async () => {
  const deps = fakeDeps();
  const challenge = poolChallenge({ schedule: "always_open", season: null, ends_on: null });
  await run(deps, created({ challenge }));

  assert.match(textOf(deps.posts[0]!.post.components), /^\*\*Always Open\*\* no end date$/m);
});

test("challenge_created: Start a Run starts one; See all games opens it by game", async () => {
  const deps = fakeDeps();
  await run(deps, created());

  const [start, all] = buttonsOf(deps.posts[0]!.post.components);
  assert.equal(start?.customId, "challenge-run-v1:start:7");
  assert.equal(start?.style, 1);
  assert.equal(all?.customId, "challenge-show-v1:7:g:1:n");
});

test("challenge_created: an empty Pool still offers Start a Run", async () => {
  const deps = fakeDeps();
  const challenge = poolChallenge({ pool: { ...poolChallenge().pool!, game_count: 0 } });
  await run(deps, created({ challenge, pool_games: [] }));

  assert.deepEqual(buttonsOf(deps.posts[0]!.post.components).map((b) => b.label), [
    "Start a Run",
  ]);
});

test("challenge_created: a Secret Santa has no Start a Run (its Runs come from a draw)",
  async () => {
    const deps = fakeDeps();
    const challenge = poolChallenge({
      challenge_format: "assignment",
      pool: null,
      assignment: { signup_cutoff: "11-30", pick_deadline: "12-14", reveal: "12-24" },
    });
    await run(deps, created({ challenge, pool_games: [] }));

    assert.deepEqual(buttonsOf(deps.posts[0]!.post.components), []);
  });

test("challenge_announce: an event this bot does not post yet fails with its name", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const deps = fakeDeps();
  const acks = await run(deps, { ...created(), event: "edition_revealed" });

  const ack = acks[0];
  assert.equal(ack?.status, "failed");
  assert.match(ack?.status === "failed" ? ack.error : "", /edition_revealed/);
  assert.deepEqual(deps.posts, []);
});

test("challenge_announce: a payload without a Challenge fails", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const deps = fakeDeps();
  const acks = await run(deps, { event: "challenge_created", feature_key: "challenges" });

  assert.equal(acks[0]?.status, "failed");
  assert.deepEqual(deps.posts, []);
});

// Run Finished: design 3B "Shelf".

function finished(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "run_finished",
    challenge: poolChallenge(),
    run: poolRun({
      status: "finished",
      ended_at: "2026-11-15T18:00:00.000Z",
      progress: { in_progress: 1, cleared: 3, target: 3 },
      entries: [
        { game_id: 9, title: "Final Fantasy IX", state: "cleared", cleared_on: "2026-10-02" },
        { game_id: 6, title: "Final Fantasy VI", state: "cleared", cleared_on: "2026-10-30" },
        { game_id: 15, title: "Final Fantasy Tactics", state: "cleared", cleared_on: "2026-11-15" },
        { game_id: 12, title: "Final Fantasy XII", state: "in_progress", cleared_on: null },
      ],
    }),
    feature_key: "challenges",
    ...extra,
  };
}

async function imageSize(post: IChallengePost): Promise<{ width: number; height: number }> {
  const file = post.files?.[0];
  assert.ok(file, "the post carries no image");
  const meta = await sharp(file.data).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

test("run_finished: posts the Run's shelf of Cleared covers in #challenges", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, finished());

  assert.equal(acks[0]?.status, "done");
  const [{ channelId, post }] = deps.posts;
  assert.equal(channelId, CHALLENGES_CHANNEL_ID);
  const text = textOf(post.components);
  assert.match(text, /^## Run Finished$/m);
  assert.match(text, /^\*\*Fall of Final Fantasy\*\*$/m);
  assert.match(
    text,
    /^Cleared Final Fantasy IX, Final Fantasy VI and Final Fantasy Tactics in 53 days\.$/m,
  );
  assert.match(text, /^-# Run started 23 September · still playing Final Fantasy XII$/m);
  // The member is named on the button, which links to their profile; never pinged.
  assert.deepEqual(
    buttonsOf(post.components).map((b) => [b.label, b.url]),
    [["Lufia", "https://the-rpg-club-www.vercel.app/members/222"]],
  );
  assert.deepEqual(post.allowedMentions, { parse: [] });
  assert.deepEqual(deps.coverLookups, [9, 6, 15]);
  assert.deepEqual(galleryUrls(post.components), ["attachment://run-finished-41.png"]);
  assert.equal(post.files?.[0]?.name, "run-finished-41.png");
  const size = await imageSize(post);
  assert.ok(size.width > size.height, `one shelf row is wide: ${JSON.stringify(size)}`);
});

test("run_finished: Preview posts in the bot-dev channel, Off posts nothing", async () => {
  const preview = fakeDeps();
  await run(preview, finished(), "preview");
  assert.equal(preview.posts[0]?.channelId, BOT_DEV_CHANNEL_ID);

  const off = fakeDeps();
  await run(off, finished(), "off");
  assert.deepEqual(off.posts, []);
  assert.deepEqual(off.coverLookups, []);
});

test("run_finished: more than 10 Cleared games shelve 9 covers and the rest as a count",
  async () => {
    const deps = fakeDeps();
    const entries = Array.from({ length: 12 }, (_, index) => ({
      game_id: index + 1,
      title: `Game ${index + 1}`,
      state: "cleared" as const,
      cleared_on: "2026-10-01",
    }));
    const payload = finished();
    const finishedRun = payload.run as ReturnType<typeof poolRun>;
    const progress = { in_progress: 0, cleared: 12, target: 12 };
    payload.run = { ...finishedRun, entries, progress };
    await run(deps, payload);

    const { post } = deps.posts[0]!;
    assert.deepEqual(deps.coverLookups, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.match(
      textOf(post.components),
      /^Cleared Game 1, Game 2, .*Game 9 and 3 more games in 53 days\.$/m,
    );
    assert.doesNotMatch(textOf(post.components), /still playing/);
    const size = await imageSize(post);
    assert.ok(size.height > 500, `two shelf rows: ${JSON.stringify(size)}`);
  });

test("run_finished: a Run Finished the day it started, with no covers, posts text only",
  async () => {
    const deps = fakeDeps({ covered: [] });
    const payload = finished();
    payload.run = {
      ...(payload.run as ReturnType<typeof poolRun>),
      ended_at: "2026-09-23T20:00:00.000Z",
    };
    await run(deps, payload);

    const { post } = deps.posts[0]!;
    assert.match(textOf(post.components), /Final Fantasy Tactics on the day the Run started\.$/m);
    assert.deepEqual(galleryUrls(post.components), []);
    assert.equal(post.files, undefined);
  });

test("run_finished: a payload without a Run fails the job", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const deps = fakeDeps();
  const payload = finished();
  delete payload.run;
  const acks = await run(deps, payload);

  assert.equal(acks[0]?.status, "failed");
  assert.match(acks[0]?.status === "failed" ? acks[0].error : "", /run/);
  assert.deepEqual(deps.posts, []);
});
