import assert from "node:assert/strict";
import test from "node:test";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, CHALLENGES_CHANNEL_ID } from "../config/channels.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IChallengeJobDeps, IChallengePost } from "../services/ChallengeAnnouncements.js";
import type { ISignupPost } from "../services/ChallengeEditionApi.js";
import { buttonsOf, santaChallenge, santaEdition, textOf } from "./challengeFixtures.js";

// The Secret Santa sign-up posts and the left-out DM (spec api#376, bot#1551), design 7C
// "Gift tags": the opening post is stored on the Edition, and the closing, closed and
// cancelled posts reply to it.

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
  stored: { editionId: number; post: ISignupPost }[];
  dms: { userId: string; post: IChallengePost }[];
}

function fakeDeps(options: { storeError?: unknown; dmError?: unknown } = {}): IFakeDeps {
  const deps: IFakeDeps = {
    posts: [],
    stored: [],
    dms: [],
    postMessage: async (channelId, post) => {
      deps.posts.push({ channelId, post });
      return String(900 + deps.posts.length);
    },
    storeSignupPost: async (editionId, post) => {
      if (options.storeError) throw options.storeError;
      deps.stored.push({ editionId, post });
    },
    sendDm: async (userId, post) => {
      if (options.dmError) throw options.dmError;
      deps.dms.push({ userId, post });
    },
    poolPreview: async (_pool, page) => ({ items: [], page, pages: 1, count: 0 }),
    coverImage: async () => null,
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
  options: { state?: FeatureState | null; kind?: string } = {},
): Promise<Ack[]> {
  const api = fakeApi();
  const job: IBotJob = {
    id: 1,
    kind: options.kind ?? "challenge_announce",
    payload,
    attempts: 1,
    requestedByUserId: null,
  };
  await processBotJobs(
    [job],
    BOT_JOB_HANDLERS,
    surface(deps, options.state === undefined ? "live" : options.state),
    api,
  );
  return api.acks;
}

function opened(): Record<string, unknown> {
  return {
    event: "signup_opened",
    challenge: santaChallenge(),
    edition: santaEdition({ signed_up_count: 0 }),
    feature_key: "challenges",
  };
}

test("signup_opened: posts the gift tag with its dates and a Sign up button", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, opened());

  assert.equal(acks[0]?.status, "done");
  assert.equal(deps.posts.length, 1);
  const [{ channelId, post }] = deps.posts;
  assert.equal(channelId, CHALLENGES_CHANNEL_ID);
  const text = textOf(post.components);
  assert.match(text, /^## Secret Santa 2026$/m);
  assert.ok(text.includes(
    "\nSomeone in the club picks a game from your backlog. You pick one from someone " +
      "else's. On 25 December everyone unwraps theirs.\n",
  ), text);
  assert.match(text, /^\*\*1 December\*\* sign-up closes$/m);
  assert.match(text, /^\*\*15 December\*\* Santas have picked$/m);
  assert.match(text, /^\*\*25 December\*\* the reveal$/m);
  assert.deepEqual(
    buttonsOf(post.components).map((b) => [b.label, b.customId]),
    [["Sign up", "challenge-santa-v1:join:12"]],
  );
  assert.equal(post.replyTo, undefined);
  // The gift is drawn by the bot and attached.
  assert.equal(post.files?.length, 1);
  assert.match(JSON.stringify(post.components), /attachment:\/\/secret-santa-12\.png/);
});

test("signup_opened: stores the post on the Edition for the later replies", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, opened());

  assert.deepEqual(deps.stored, [
    { editionId: 12, post: { channel_id: CHALLENGES_CHANNEL_ID, message_id: "901" } },
  ]);
  assert.equal(acks[0]?.status, "done");
  assert.match(
    (acks[0] as { resultText?: string }).resultText ?? "",
    /Opened sign-up for Secret Santa 2026/,
  );
});

test("signup_opened: a failed store keeps the post and says so in the result", async () => {
  const deps = fakeDeps({ storeError: new Error("API down") });
  const acks = await run(deps, opened());

  assert.equal(deps.posts.length, 1);
  assert.equal(acks[0]?.status, "done");
  assert.match(
    (acks[0] as { resultText?: string }).resultText ?? "",
    /could not store the post.*API down/i,
  );
});

test("signup_opened: Preview posts in bot-dev and stores that post", async () => {
  const deps = fakeDeps();
  await run(deps, opened(), { state: "preview" });

  assert.equal(deps.posts[0]?.channelId, BOT_DEV_CHANNEL_ID);
  assert.equal(deps.stored[0]?.post.channel_id, BOT_DEV_CHANNEL_ID);
});

test("challenge_created: a new Secret Santa's post opens its first Edition", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, {
    event: "challenge_created",
    challenge: santaChallenge(),
    pool_games: [],
    feature_key: "challenges",
  });

  assert.equal(acks[0]?.status, "done");
  const { post } = deps.posts[0]!;
  assert.ok(textOf(post.components).includes(
    "\n**2026 Edition** sign-up closes 1 December · Santas pick by 15 December · " +
      "reveal 25 December",
  ));
  assert.deepEqual(
    buttonsOf(post.components).map((b) => [b.label, b.customId]),
    [["Sign up", "challenge-santa-v1:join:12"]],
  );
  assert.deepEqual(deps.stored, [
    { editionId: 12, post: { channel_id: CHALLENGES_CHANNEL_ID, message_id: "901" } },
  ]);
});

test("challenge_created: no Edition in sign-up means no Sign up and nothing stored", async () => {
  const deps = fakeDeps();
  const challenge = santaChallenge();
  challenge.assignment!.edition = null;
  await run(deps, { event: "challenge_created", challenge, feature_key: "challenges" });

  assert.deepEqual(buttonsOf(deps.posts[0]!.post.components), []);
  assert.deepEqual(deps.stored, []);
});

const opening = { channel_id: CHALLENGES_CHANNEL_ID, message_id: "555" };

function later(event: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event,
    challenge: santaChallenge(),
    edition: santaEdition(),
    signup_post: opening,
    feature_key: "challenges",
    ...extra,
  };
}

test("signup_closing: replies to the opening post with the count and Sign up", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, later("signup_closing", { days_left: 3 }));

  assert.equal(acks[0]?.status, "done");
  const { channelId, post } = deps.posts[0]!;
  assert.equal(channelId, CHALLENGES_CHANNEL_ID);
  assert.equal(post.replyTo, "555");
  assert.equal(
    textOf(post.components),
    "Three days left: 14 members have signed up. Sign up before 1 December.",
  );
  assert.deepEqual(
    buttonsOf(post.components).map((b) => [b.label, b.customId]),
    [["Sign up", "challenge-santa-v1:join:12"]],
  );
  assert.deepEqual(deps.stored, []);
});

test("signup_closing: a late day and a lone member read naturally", async () => {
  const deps = fakeDeps();
  await run(deps, later("signup_closing", {
    days_left: 1,
    edition: santaEdition({ signed_up_count: 1 }),
  }));

  assert.equal(
    textOf(deps.posts[0]!.post.components),
    "One day left: 1 member has signed up. Sign up before 1 December.",
  );
});

test("signup_closing: without the opening post here, it posts with the Edition's name",
  async () => {
    for (const signupPost of [null, { channel_id: BOT_DEV_CHANNEL_ID, message_id: "555" }]) {
      const deps = fakeDeps();
      await run(deps, later("signup_closing", { days_left: 3, signup_post: signupPost }));

      const { post } = deps.posts[0]!;
      assert.equal(post.replyTo, undefined);
      assert.match(textOf(post.components), /^### Secret Santa 2026\nThree days left/);
    }
  });

test("signup_closed: replies with the members drawn and points Santas at their pick", async () => {
  const deps = fakeDeps();
  await run(deps, later("signup_closed", {
    edition: santaEdition({ phase: "picking", signed_up_count: 17 }),
    joined: 17,
    left_out: 0,
  }));

  const { post } = deps.posts[0]!;
  assert.equal(post.replyTo, "555");
  assert.equal(
    textOf(post.components),
    "Sign-up is closed with **17 members**. The draw is done: Santas, check " +
      "/challenge santa pick.",
  );
  assert.deepEqual(buttonsOf(post.components), []);
});

test("signup_closed: says how many sit this one out", async () => {
  const deps = fakeDeps();
  await run(deps, later("signup_closed", { joined: 12, left_out: 2, minimum: 5 }));

  // The payload's minimum names the bar they missed.
  assert.match(
    textOf(deps.posts[0]!.post.components),
    /\n-# 2 members sit this one out with fewer than 5 games in their backlog\.$/,
  );
});

test("edition_cancelled: replies that the circle was too small, and when the next opens",
  async () => {
    const deps = fakeDeps();
    const acks = await run(deps, later("edition_cancelled", {
      edition: santaEdition({ phase: "cancelled" }),
      joined: 1,
      left_out: 1,
      minimum: 5,
    }));

    assert.equal(acks[0]?.status, "done");
    const { post } = deps.posts[0]!;
    assert.equal(post.replyTo, "555");
    assert.equal(
      textOf(post.components),
      "Secret Santa 2026 is cancelled: the circle needs at least 2 Santas, and only 1 " +
        "member could be drawn. Sign-up for Secret Santa 2027 opens on 26 December.\n" +
        "-# 1 member sat this one out with fewer than 5 games in their backlog.",
    );
  });

test("edition_cancelled: nobody drawn", async () => {
  const deps = fakeDeps();
  await run(deps, later("edition_cancelled", { joined: 0, left_out: 0 }));

  assert.match(
    textOf(deps.posts[0]!.post.components),
    /needs at least 2 Santas, and nobody could be drawn\./,
  );
});

test("sign-up posts are held while Challenges is Off", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, later("signup_closing", { days_left: 3 }), { state: "off" });

  assert.equal(acks[0]?.status, "done");
  assert.deepEqual(deps.posts, []);
});

function leftOut(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "left_out_of_draw",
    user_id: "333",
    challenge: santaChallenge(),
    edition: santaEdition({ phase: "picking" }),
    backlog_count: 3,
    minimum: 5,
    feature_key: "challenges",
    ...extra,
  };
}

test("left_out_of_draw: DMs the member why the draw left them out", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, leftOut(), { kind: "challenge_dm" });

  assert.equal(acks[0]?.status, "done");
  assert.deepEqual(deps.posts, []);
  assert.equal(deps.dms.length, 1);
  const { userId, post } = deps.dms[0]!;
  assert.equal(userId, "333");
  assert.equal(
    textOf(post.components),
    "## Secret Santa 2026: sitting this one out\n" +
      "The draw needs at least 5 games in your backlog to pick from, and yours had 3 when " +
      "sign-up closed, so you weren't drawn this time. Add games with /backlog add, and " +
      "sign up for Secret Santa 2027 from 26 December.",
  );
});

test("left_out_of_draw: goes out in Preview too", async () => {
  const deps = fakeDeps();
  await run(deps, leftOut(), { kind: "challenge_dm", state: "preview" });

  assert.equal(deps.dms.length, 1);
});

test("left_out_of_draw: closed DMs are done with the reason, not retried", async () => {
  const closed = Object.assign(new Error("Cannot send messages to this user"), { code: 50007 });
  const deps = fakeDeps({ dmError: closed });
  const acks = await run(deps, leftOut(), { kind: "challenge_dm" });

  assert.equal(acks[0]?.status, "done");
  assert.match((acks[0] as { resultText?: string }).resultText ?? "", /DMs are closed/);
});

test("challenge_dm: an event this bot has no DM for fails, naming it", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, leftOut({ event: "mystery" }), { kind: "challenge_dm" });

  assert.equal(acks[0]?.status, "failed");
  assert.match((acks[0] as { error: string }).error, /mystery/);
});
