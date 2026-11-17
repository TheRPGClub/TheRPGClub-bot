import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { RESTJSONErrorCodes } from "discord-api-types/v10";
import { DiscordAPIError } from "discord.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, CHALLENGES_CHANNEL_ID } from "../config/channels.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IChallengeJobDeps, IChallengePost } from "../services/ChallengeAnnouncements.js";
import type { IGameSummary, IPage } from "../services/ChallengeApi.js";
import {
  buttonsOf,
  coverIdOf,
  galleryUrls,
  game,
  poolChallenge,
  poolRun,
  textOf,
} from "./challengeFixtures.js";

// The Season jobs (bot#1548): the Season opened post (design 2B "Returning faces") and the
// Season-end reminder DM, run through processBotJobs with a fake surface.

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
  dms: { userId: string; post: IChallengePost }[];
  coverLookups: number[];
}

async function coverPng(): Promise<Buffer> {
  return sharp({
    create: { width: 30, height: 40, channels: 3, background: { r: 40, g: 90, b: 160 } },
  }).png().toBuffer();
}

function fakeDeps(options: {
  covered?: number[];
  dmError?: unknown;
  emojis?: Record<string, string>;
} = {}): IFakeDeps {
  const deps: IFakeDeps = {
    posts: [],
    dms: [],
    coverLookups: [],
    postMessage: async (channelId, post) => {
      deps.posts.push({ channelId, post });
    },
    storeSignupPost: async () => {},
    poolPreview: async (_pool, page): Promise<IPage<IGameSummary>> =>
      ({ items: [], page, pages: 1, count: 0 }),
    coverImage: async (url) => {
      const gameId = coverIdOf(url);
      deps.coverLookups.push(gameId);
      return !options.covered || options.covered.includes(gameId) ? coverPng() : null;
    },
    sendDm: async (userId, post) => {
      if (options.dmError) throw options.dmError;
      deps.dms.push({ userId, post });
    },
    memberEmoji: (userId) => options.emojis?.[userId] ?? null,
  };
  return deps;
}

function surface(deps: IChallengeJobDeps, state: FeatureState | null): IBotJobSurface {
  return { challenges: deps, featureState: async () => state } as unknown as IBotJobSurface;
}

async function run(
  deps: IChallengeJobDeps,
  kind: string,
  payload: Record<string, unknown>,
  state: FeatureState | null = "live",
): Promise<Ack[]> {
  const api = fakeApi();
  const job: IBotJob = { id: 1, kind, payload, attempts: 1, requestedByUserId: null };
  await processBotJobs([job], BOT_JOB_HANDLERS, surface(deps, state), api);
  return api.acks;
}

// Season opened: design 2B "Returning faces".

const suikodens = [
  "Suikoden", "Suikoden II", "Genso Suikogaiden Vol.1", "Genso Suikogaiden Vol.2",
  "Suikoden III", "Suikoden IV", "Suikoden Tactics", "Suikoden V", "Suikoden Tierkreis",
].map((title, index) => game(index + 1, title));

function summer() {
  return poolChallenge({
    id: 12,
    name: "Summer of Suikoden",
    season: { start: "06-21", end: "09-22", crosses_new_year: false },
    pool: {
      target: 2,
      franchises: [{ franchise_id: 9, name: "Suikoden" }],
      game_count: 9,
    },
  });
}

const finishers = [
  { user_id: "301", username: "lufia", global_name: "Lufia" },
  { user_id: "302", username: "tenpenny", global_name: null },
  { user_id: "303", username: "ashtear", global_name: "ashtear" },
];

function opened(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "season_opened",
    challenge: summer(),
    season: { starts_on: "2027-06-21", ends_on: "2027-09-22" },
    pool_games: suikodens,
    last_season_finishers: finishers,
    feature_key: "challenges",
    ...extra,
  };
}

test("season_opened: posts the Pool strip and last Season's Finishers by name", async () => {
  const deps = fakeDeps({ emojis: { "301": "<:u_lufia:900>" } });
  const acks = await run(deps, "challenge_announce", opened());

  assert.equal(acks[0]?.status, "done");
  const [{ channelId, post }] = deps.posts;
  assert.equal(channelId, CHALLENGES_CHANNEL_ID);
  const text = textOf(post.components);
  assert.match(text, /^## Summer of Suikoden is back$/m);
  assert.match(
    text,
    new RegExp(
      "^Last Season <:u_lufia:900> Lufia, tenpenny and ashtear Finished\\. " +
        "Anyone can start a new Run this year, them included\\.$",
      "m",
    ),
  );
  assert.match(text, /^-# 21 June to 22 September · Clear 2 · 9 games in the Pool$/m);
  // Named, never pinged.
  assert.doesNotMatch(text, /<@/);
  assert.deepEqual(post.allowedMentions, { parse: [] });
  // One composite strip of the Pool's covers.
  assert.deepEqual(deps.coverLookups, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(galleryUrls(post.components), ["attachment://season-opened-12.png"]);
  const file = post.files?.[0];
  assert.equal(file?.name, "season-opened-12.png");
  const meta = await sharp(file!.data).metadata();
  assert.ok((meta.width ?? 0) > (meta.height ?? 0) * 4, "the covers stand in one row");
  assert.deepEqual(
    buttonsOf(post.components).map((b) => [b.label, b.customId]),
    [["Start a Run", "challenge-run-v1:start:12"]],
  );
});

test("season_opened: with no Finishers last Season, it opens without names", async () => {
  const deps = fakeDeps();
  await run(deps, "challenge_announce", opened({ last_season_finishers: [] }));

  const text = textOf(deps.posts[0]!.post.components);
  assert.match(text, /^## Summer of Suikoden is open$/m);
  assert.match(text, /^A new Season has started\. Anyone can start a Run\.$/m);
  assert.doesNotMatch(text, /Finished/);
});

test("season_opened: games without a cover get title cards; none at all posts text only",
  async () => {
    const some = fakeDeps({ covered: [1] });
    await run(some, "challenge_announce", opened());
    assert.equal(some.posts[0]!.post.files?.length, 1);

    const none = fakeDeps({ covered: [] });
    const games = suikodens.map((g) => ({ ...g, cover_url: null }));
    await run(none, "challenge_announce", opened({ pool_games: games }));
    const { post } = none.posts[0]!;
    assert.deepEqual(none.coverLookups, []);
    assert.equal(post.files, undefined);
    assert.deepEqual(galleryUrls(post.components), []);
    assert.match(textOf(post.components), /is back/);
  });

test("season_opened: many Finishers are named up to a count", async () => {
  const deps = fakeDeps();
  const many = Array.from({ length: 30 }, (_, i) => ({
    user_id: String(400 + i),
    username: `member${i + 1}`,
  }));
  await run(deps, "challenge_announce", opened({ last_season_finishers: many }));

  const text = textOf(deps.posts[0]!.post.components);
  assert.match(text, /member20 and 10 more Finished\./);
  assert.doesNotMatch(text, /member21/);
});

test("season_opened: Preview posts in bot-dev, Off posts nothing", async () => {
  const preview = fakeDeps();
  const acks = await run(preview, "challenge_announce", opened(), "preview");
  assert.equal(preview.posts[0]?.channelId, BOT_DEV_CHANNEL_ID);
  assert.match(acks[0]?.status === "done" ? acks[0].resultText ?? "" : "", /^Preview/);

  const off = fakeDeps();
  await run(off, "challenge_announce", opened(), "off");
  assert.deepEqual(off.posts, []);
  assert.deepEqual(off.coverLookups, []);
});

// The Season-end reminder DM.

function ending(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "season_ending",
    user_id: "222",
    challenge: poolChallenge(),
    run: poolRun(),
    season: { starts_on: "2026-09-22", ends_on: "2026-12-21" },
    days_left: 7,
    feature_key: "challenges",
    ...extra,
  };
}

test("season_ending: DMs the member a link to their Run", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, "challenge_dm", ending());

  assert.equal(acks[0]?.status, "done");
  assert.match(acks[0]?.status === "done" ? acks[0].resultText ?? "" : "", /Lufia|222/);
  assert.deepEqual(deps.posts, []);
  const [{ userId, post }] = deps.dms;
  assert.equal(userId, "222");
  const text = textOf(post.components);
  assert.match(text, /^## Fall of Final Fantasy closes in 7 days$/m);
  assert.match(text, /^You've Cleared 2 of 3\. The Season ends on 21 December\.$/m);
  assert.match(text, /^-# Turn Challenge DMs off with \/challenge dms$/m);
  assert.deepEqual(
    buttonsOf(post.components).map((b) => [b.label, b.url]),
    [["Your Run", "https://the-rpg-club-www.vercel.app/challenges/7"]],
  );
});

test("season_ending: a late reminder counts the real days left", async () => {
  const one = fakeDeps();
  await run(one, "challenge_dm", ending({ days_left: 1 }));
  assert.match(textOf(one.dms[0]!.post.components), /^## Fall of Final Fantasy closes in 1 day$/m);

  const today = fakeDeps();
  await run(today, "challenge_dm", ending({ days_left: 0 }));
  assert.match(
    textOf(today.dms[0]!.post.components),
    /^## Fall of Final Fantasy closes today$/m,
  );
});

test("season_ending: goes out in Preview without a Preview note, and not while Off",
  async () => {
    const preview = fakeDeps();
    const acks = await run(preview, "challenge_dm", ending(), "preview");
    assert.equal(preview.dms.length, 1);
    assert.doesNotMatch(acks[0]?.status === "done" ? acks[0].resultText ?? "" : "", /Preview/);

    const off = fakeDeps();
    const offAcks = await run(off, "challenge_dm", ending(), "off");
    assert.deepEqual(off.dms, []);
    assert.equal(offAcks[0]?.status, "done");
    assert.match(offAcks[0]?.status === "done" ? offAcks[0].resultText ?? "" : "", /Off/);
  });

test("season_ending: closed DMs ack the job done with the reason", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const closed = Object.assign(new Error("Cannot send messages to this user"), {
    code: RESTJSONErrorCodes.CannotSendMessagesToThisUser,
  });
  const deps = fakeDeps({ dmError: closed });
  const acks = await run(deps, "challenge_dm", ending());

  assert.equal(acks[0]?.status, "done");
  assert.match(
    acks[0]?.status === "done" ? acks[0].resultText ?? "" : "",
    /Not delivered: .*DMs (are )?closed/,
  );
});

test("season_ending: another DM failure fails the job", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const deps = fakeDeps({ dmError: new Error("Discord is down") });
  const acks = await run(deps, "challenge_dm", ending());

  assert.equal(acks[0]?.status, "failed");
});

test("season_ending: a temporary DM failure is left for the lease to retry", async (t) => {
  t.mock.method(console, "error", () => undefined);
  t.mock.method(console, "log", () => undefined);
  const discordDown = new DiscordAPIError(
    { code: 0, message: "Service Unavailable" },
    0,
    503,
    "POST",
    "https://discord.com/api/v10/channels/1/messages",
    { body: {}, files: [] },
  );
  const deps = fakeDeps({ dmError: discordDown });
  const acks = await run(deps, "challenge_dm", ending());

  assert.deepEqual(acks, []);
});

test("challenge_dm: an event this bot does not send fails with its name", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const deps = fakeDeps();
  const acks = await run(deps, "challenge_dm", ending({ event: "gift_wrapped" }));

  assert.equal(acks[0]?.status, "failed");
  assert.match(acks[0]?.status === "failed" ? acks[0].error : "", /gift_wrapped/);
  assert.deepEqual(deps.dms, []);
});
