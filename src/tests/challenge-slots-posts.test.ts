import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, CHALLENGES_CHANNEL_ID } from "../config/channels.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IChallengeJobDeps, IChallengePost } from "../services/ChallengeAnnouncements.js";
import {
  buttonsOf,
  coverIdOf,
  galleryUrls,
  slotsChallenge,
  slotsRun,
  textOf,
} from "./challengeFixtures.js";

// The Slots posts in #challenges (bot#1550): the new-Challenge year strip (1B) and the
// Caught Up year poster (3B), through the challenge_announce job.

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

interface IFakeDeps extends IChallengeJobDeps {
  posts: { channelId: string; post: IChallengePost }[];
  coverLookups: number[];
}

async function coverPng(): Promise<Buffer> {
  return sharp({
    create: { width: 30, height: 40, channels: 3, background: { r: 60, g: 90, b: 160 } },
  }).png().toBuffer();
}

function fakeDeps(options: { covered?: number[] } = {}): IFakeDeps {
  const deps: IFakeDeps = {
    posts: [],
    coverLookups: [],
    coverImage: async (url) => {
      const gameId = coverIdOf(url);
      deps.coverLookups.push(gameId);
      return !options.covered || options.covered.includes(gameId) ? coverPng() : null;
    },
    postMessage: async (channelId, post) => {
      deps.posts.push({ channelId, post });
    },
    poolPreview: async () => {
      throw new Error("A Slots Challenge has no Pool to preview.");
    },
    storeSignupPost: async () => {},
    sendDm: async () => {
      throw new Error("Slots posts send no DMs.");
    },
    memberEmoji: () => null,
  };
  return deps;
}

function surface(challenges: IChallengeJobDeps, state: FeatureState | null): IBotJobSurface {
  return { challenges, featureState: async () => state } as unknown as IBotJobSurface;
}

async function run(
  deps: IChallengeJobDeps,
  payload: Record<string, unknown>,
  state: FeatureState | null = "live",
): Promise<Ack[]> {
  const api = fakeApi();
  const job: IBotJob = {
    id: 1,
    kind: "challenge_announce",
    payload,
    attempts: 1,
    requestedByUserId: "111",
  };
  await processBotJobs([job], BOT_JOB_HANDLERS, surface(deps, state), api);
  return api.acks;
}

async function imageSize(post: IChallengePost): Promise<{ width: number; height: number }> {
  const file = post.files?.[0];
  assert.ok(file, "the post carries no image");
  const meta = await sharp(file.data).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

// New Challenge: design 1B, the Slots year strip.

function created(challenge = slotsChallenge()): Record<string, unknown> {
  return { event: "challenge_created", challenge, feature_key: "challenges", pool_games: [] };
}

test("challenge_created: a fixed Slots range posts its year strip and rules", async () => {
  const deps = fakeDeps();
  const challenge = slotsChallenge({
    name: "The 1990s, Year by Year",
    description: "One game from each year of the 1990s, ten in all.",
    hosted_by_club: false,
    host: { user_id: "444", username: "tenpenny" },
    slots: { first_year: 1990, last_year: 1999, counts_past_play: false },
  });
  const acks = await run(deps, created(challenge));

  assert.equal(acks[0]?.status, "done");
  const [{ channelId, post }] = deps.posts;
  assert.equal(channelId, CHALLENGES_CHANNEL_ID);
  const text = textOf(post.components);
  assert.match(text, /^# The 1990s, Year by Year$/m);
  assert.match(text, /^-# New Challenge · hosted by <@444>$/m);
  assert.match(text, /^\*\*Slots\*\* 1990 to 1999$/m);
  assert.match(text, /^\*\*To Finish\*\* Clear all 10 slots$/m);
  assert.match(text, /^\*\*Always Open\*\* no end date$/m);
  assert.doesNotMatch(text, /Counts past play/);
  assert.deepEqual(galleryUrls(post.components), [`attachment://${post.files?.[0]?.name}`]);
  const size = await imageSize(post);
  assert.ok(size.width > size.height * 4, `a strip is wide: ${size.width}x${size.height}`);
  assert.deepEqual(buttonsOf(post.components).map((b) => b.label), ["Start a Run"]);
  assert.deepEqual(deps.coverLookups, []);
});

test("challenge_created: a birth-year range that grows says so, with Counts past play",
  async () => {
    const deps = fakeDeps();
    await run(deps, created());

    const text = textOf(deps.posts[0]!.post.components);
    assert.match(text, /^\*\*Slots\*\* Your birth year to the current year$/m);
    assert.match(
      text,
      /^\*\*To Finish\*\* Clear every slot to be Caught Up; a new slot opens every 1 January$/m,
    );
    assert.match(
      text,
      /^\*\*Counts past play\*\* Pick earlier Game Completions for open years$/m,
    );
    assert.ok(deps.posts[0]!.post.files?.length, "the strip is drawn for a birth-year range");
  });

test("challenge_created: Preview posts the Slots strip in the bot-dev channel", async () => {
  const deps = fakeDeps();
  await run(deps, created(), "preview");

  assert.equal(deps.posts[0]?.channelId, BOT_DEV_CHANNEL_ID);
});

// Caught Up: design 3B, the year poster.

function caughtUp(runOverrides = slotsRun()): Record<string, unknown> {
  return {
    event: "run_caught_up",
    challenge: slotsChallenge(),
    run: runOverrides,
    feature_key: "challenges",
  };
}

test("run_caught_up: posts the member's year poster in #challenges", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, caughtUp());

  assert.equal(acks[0]?.status, "done");
  assert.match(acks[0]?.status === "done" ? acks[0].resultText ?? "" : "", /Tamsin/);
  const [{ channelId, post }] = deps.posts;
  assert.equal(channelId, CHALLENGES_CHANNEL_ID);
  const text = textOf(post.components);
  assert.match(text, /^## Caught Up$/m);
  assert.match(text, /^\*\*Years Alive\*\*$/m);
  assert.match(
    text,
    /^Every year from 1994 to 2026 has a Cleared game\. The 2027 slot opens on 1 January\.$/m,
  );
  assert.match(text, /^-# 33 slots · Run started 4 March 2024$/m);
  assert.deepEqual(post.allowedMentions, { parse: [] });

  const [member] = buttonsOf(post.components);
  assert.equal(member?.label, "Tamsin");
  assert.match(member?.customId ?? "", /^challenge-slots-v1:decade:90:/);
  assert.equal(galleryUrls(post.components)[0], "attachment://caught-up-90.png");
  const size = await imageSize(post);
  assert.ok(size.width >= 900 && size.height >= 500, `${size.width}x${size.height}`);
  // Each year's cover read from its entry's cover_url.
  assert.deepEqual(deps.coverLookups, Array.from({ length: 33 }, (_, i) => 1994 + i));
});

test("run_caught_up: Preview goes to bot-dev and Off posts nothing", async () => {
  const preview = fakeDeps();
  await run(preview, caughtUp(), "preview");
  assert.equal(preview.posts[0]?.channelId, BOT_DEV_CHANNEL_ID);

  const off = fakeDeps();
  const acks = await run(off, caughtUp(), "off");
  assert.equal(acks[0]?.status, "done");
  assert.deepEqual(off.posts, []);
});

test("run_caught_up: years without covers are drawn as title cards", async () => {
  const deps = fakeDeps({ covered: [] });
  const acks = await run(deps, caughtUp(slotsRun({ first: 2020, last: 2026 })));

  assert.equal(acks[0]?.status, "done");
  const post = deps.posts[0]!.post;
  assert.ok(post.files?.length, "the poster is still drawn");
  assert.match(textOf(post.components), /Every year from 2020 to 2026 has a Cleared game\./);
  assert.match(textOf(post.components), /^-# 7 slots · Run started 4 March 2024$/m);
});

test("run_caught_up: a payload without a Run fails the job", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const deps = fakeDeps();
  const acks = await run(deps, { ...caughtUp(), run: null });

  assert.equal(acks[0]?.status, "failed");
  assert.deepEqual(deps.posts, []);
});
