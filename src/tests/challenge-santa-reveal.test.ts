import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, CHALLENGES_CHANNEL_ID } from "../config/channels.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IChallengeJobDeps, IChallengePost } from "../services/ChallengeAnnouncements.js";
import type { IEditionAssignment } from "../services/ChallengeEditionApi.js";
import { game, santaChallenge, santaEdition, textOf } from "./challengeFixtures.js";

// The Secret Santa reveal (spec api#376, bot#1552), design 7C "Gift tags": one generated
// sheet of covers tagged with their recipients, as a reply to the opening post, and never
// a Santa's name.

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
  covers: number[];
}

let coverPng: Promise<Buffer> | null = null;

function cover(): Promise<Buffer> {
  coverPng ??= sharp({
    create: { width: 30, height: 40, channels: 4, background: "#884422" },
  }).png().toBuffer();
  return coverPng;
}

function fakeDeps(options: { noCovers?: boolean } = {}): IFakeDeps {
  const deps: IFakeDeps = {
    posts: [],
    covers: [],
    postMessage: async (channelId, post) => {
      deps.posts.push({ channelId, post });
      return "950";
    },
    storeSignupPost: async () => {},
    sendDm: async () => {},
    poolPreview: async (_pool, page) => ({ items: [], page, pages: 1, count: 0 }),
    coverImage: async (gameId) => {
      deps.covers.push(gameId);
      return options.noCovers ? null : cover();
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
    requestedByUserId: null,
  };
  await processBotJobs([job], BOT_JOB_HANDLERS, surface(deps, state), api);
  return api.acks;
}

function member(id: string, username: string, globalName: string | null = null) {
  return { user_id: id, username, global_name: globalName };
}

function assignments(): IEditionAssignment[] {
  return [
    {
      recipient: member("101", "lufia", "Lufia"),
      game: game(1, "Vagrant Story"),
      picked_randomly: false,
      santa: null,
    },
    {
      recipient: member("102", "kaiserkaze"),
      game: game(2, "Shadow Hearts: Covenant"),
      picked_randomly: false,
      santa: null,
    },
    {
      recipient: member("103", "vexx", "Vexx"),
      game: game(3, "Chrono Cross"),
      picked_randomly: true,
      santa: null,
    },
  ];
}

function revealed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "edition_revealed",
    challenge: santaChallenge(),
    edition: santaEdition({
      phase: "revealed",
      signup_open: false,
      signed_up_count: 3,
      assignments: assignments(),
    }),
    signup_post: { channel_id: CHALLENGES_CHANNEL_ID, message_id: "777" },
    feature_key: "challenges",
    ...overrides,
  };
}

test("edition_revealed: one gift-tag sheet, replying to the opening post", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, revealed());

  assert.equal(acks[0]?.status, "done", JSON.stringify(acks));
  assert.equal(deps.posts.length, 1);
  const [{ channelId, post }] = deps.posts;
  assert.equal(channelId, CHALLENGES_CHANNEL_ID);
  assert.equal(post.replyTo, "777");
  assert.equal(
    textOf(post.components),
    "# Secret Santa 2026\n" +
      "The presents are open. Clear yours before 25 December 2027 to Finish.\n" +
      "-# Full list: /challenge show Secret Santa · 3 games · Vexx's was picked at " +
      "random",
  );
  // One generated image: the covers, each tagged with its recipient.
  assert.equal(post.files?.length, 1);
  const file = post.files![0]!;
  assert.equal(file.name, "secret-santa-2026-reveal.png");
  const meta = await sharp(file.data).metadata();
  assert.equal(meta.format, "png");
  assert.ok((meta.width ?? 0) > (meta.height ?? 0), "a landscape sheet");
  assert.deepEqual(deps.covers.sort(), [1, 2, 3]);
  const json = JSON.stringify(post.components);
  assert.match(json, /attachment:\/\/secret-santa-2026-reveal\.png/);
  // The alt text carries the list for anyone who can't see the image.
  assert.match(
    json,
    /To Lufia: Vagrant Story\. To kaiserkaze: Shadow Hearts: Covenant\. To Vexx: Chrono Cross/,
  );
  const result = (acks[0] as { resultText?: string }).resultText ?? "";
  assert.match(result, /Revealed Secret Santa 2026/);
});

test("edition_revealed: never names a Santa, even if a payload carried one", async () => {
  const deps = fakeDeps();
  const leaked = assignments().map((a) => ({ ...a, santa: member("900", "sneaky_santa") }));
  await run(deps, revealed({
    edition: santaEdition({ phase: "revealed", assignments: leaked }),
  }));

  assert.doesNotMatch(JSON.stringify(deps.posts[0]!.post.components), /sneaky_santa/);
});

test("edition_revealed: in Preview it posts in bot-dev, plainly, not as a reply", async () => {
  const deps = fakeDeps();
  await run(deps, revealed(), "preview");

  assert.equal(deps.posts[0]?.channelId, BOT_DEV_CHANNEL_ID);
  assert.equal(deps.posts[0]?.post.replyTo, undefined);
});

test("edition_revealed: covers missing still draw the sheet with title cards", async () => {
  const deps = fakeDeps({ noCovers: true });
  await run(deps, revealed());

  assert.equal(deps.posts[0]?.post.files?.length, 1);
});

test("edition_revealed: a recipient with nothing to pick is named, without a game", async () => {
  const deps = fakeDeps();
  const list: IEditionAssignment[] = [
    ...assignments(),
    { recipient: member("104", "zeal", "Zeal"), game: null, picked_randomly: false },
  ];
  await run(deps, revealed({ edition: santaEdition({ phase: "revealed", assignments: list }) }));

  const post = deps.posts[0]!.post;
  assert.match(textOf(post.components), /3 games · Vexx's was picked at random · Zeal's /);
  assert.match(
    textOf(post.components),
    /Zeal's backlog had nothing to pick$/,
  );
  assert.match(JSON.stringify(post.components), /To Zeal: nothing to pick/);
});

test("edition_revealed: with no assignments it says so, without an image", async () => {
  const deps = fakeDeps();
  await run(deps, revealed({ edition: santaEdition({ phase: "revealed", assignments: [] }) }));

  const post = deps.posts[0]!.post;
  assert.equal(post.files, undefined);
  assert.match(textOf(post.components), /^# Secret Santa 2026\n/);
});
