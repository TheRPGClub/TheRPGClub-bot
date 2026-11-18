import assert from "node:assert/strict";
import test from "node:test";
import { DiscordAPIError } from "discord.js";
import sharp from "sharp";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BIRTHDAY_CHANNEL_ID } from "../config/channels.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import {
  BANNER_AVATARS_MAX,
  bannerFaces,
  composeBirthdayBanner,
} from "../services/BirthdayBanner.js";
import {
  closingLine,
  type IBirthdayMember,
  type IBirthdayPost,
  type IBirthdayPostDeps,
} from "../services/BirthdayPost.js";

// The Birthday Post (spec api#396, bot#1559): the birthday_post job greets the members in
// the Birthday channel, design picks 1A + 1C.

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

const TODAY = "2026-11-18";

const NAMES: Record<string, string> = {
  "101": "Lufia",
  "102": "Kaiserkaze",
  "103": "Marle",
  "104": "tenpenny",
  "105": "Ondine",
};

interface IFakeDeps extends IBirthdayPostDeps {
  posts: { channelId: string; post: IBirthdayPost }[];
}

async function avatarPng(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 63, g: 159, b: 184 } },
  }).png().toBuffer();
}

function fakeDeps(options: { departed?: string[]; today?: string } = {}): IFakeDeps {
  const deps: IFakeDeps = {
    posts: [],
    clubToday: () => options.today ?? TODAY,
    fetchMember: async (userId): Promise<IBirthdayMember | null> => {
      if (options.departed?.includes(userId)) return null;
      return { userId, name: NAMES[userId] ?? userId, avatar: await avatarPng() };
    },
    postMessage: async (channelId, post) => {
      deps.posts.push({ channelId, post });
    },
    // As Discord would answer: the bot's own posts in the channel carrying that day's banner.
    greetedOn: async (channelId, clubDate) => new Set(deps.posts
      .filter((p) => p.channelId === channelId && p.post.files[0]?.name.includes(clubDate))
      .flatMap((p) => p.post.pingUserIds)),
  };
  return deps;
}

async function run(deps: IBirthdayPostDeps, payload: Record<string, unknown>): Promise<Ack[]> {
  const api = fakeApi();
  const job: IBotJob = { id: 7, kind: "birthday_post", payload, attempts: 1, requestedByUserId: null };
  const surface = { birthdays: deps } as unknown as IBotJobSurface;
  await processBotJobs([job], BOT_JOB_HANDLERS, surface, api);
  return api.acks;
}

async function bannerOf(post: IBirthdayPost): Promise<{ width: number; height: number }> {
  const file = post.files[0];
  assert.ok(file, "the post carries no banner");
  assert.match(file.name, /\.png$/);
  const meta = await sharp(file.data).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

test("birthday_post: one member is greeted and pinged in the Birthday channel", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, { club_date: TODAY, user_ids: ["101"] });

  assert.equal(acks[0]?.status, "done");
  assert.equal(deps.posts.length, 1);
  const [{ channelId, post }] = deps.posts;
  assert.equal(channelId, BIRTHDAY_CHANNEL_ID);
  assert.equal(
    post.content,
    "## 🎂 Happy Birthday, <@101>!\nHave a great day, from everyone at the club.",
  );
  assert.deepEqual(post.pingUserIds, ["101"]);
  assert.equal(post.files.length, 1);
  assert.deepEqual(await bannerOf(post), { width: 1200, height: 600 });
  assert.equal(post.files[0]?.description, "Happy Birthday banner for Lufia");
});

test("birthday_post: several members share one post, in the payload's order", async () => {
  const deps = fakeDeps();
  const acks = await run(deps, { club_date: TODAY, user_ids: ["102", "103", "104"] });

  assert.deepEqual(acks, [
    { id: 7, status: "done", resultText: "Greeted 3 members for 2026-11-18." },
  ]);
  const [{ post }] = deps.posts;
  assert.equal(
    post.content,
    "## 🎂 Happy Birthday, <@102>, <@103> and <@104>!\n" +
      "Have a great day, all three of you, from everyone at the club.",
  );
  assert.deepEqual(post.pingUserIds, ["102", "103", "104"]);
  assert.equal(post.files[0]?.description,
    "Happy Birthday banner for Kaiserkaze, Marle and tenpenny");
});

test("birthday_post: five members ping all five under one banner", async () => {
  const deps = fakeDeps();
  const ids = ["101", "102", "103", "104", "105"];
  await run(deps, { club_date: TODAY, user_ids: ids });

  const [{ post }] = deps.posts;
  assert.deepEqual(post.pingUserIds, ids);
  for (const id of ids) assert.ok(post.content.includes(`<@${id}>`), `no mention of ${id}`);
  assert.match(post.content, /all five of you/);
  assert.deepEqual(await bannerOf(post), { width: 1200, height: 600 });
});

test("birthday_post: a club day that has passed in New York is acked without posting",
  async () => {
    const deps = fakeDeps({ today: "2026-11-19" });
    const acks = await run(deps, { club_date: TODAY, user_ids: ["101"] });

    assert.deepEqual(deps.posts, []);
    assert.deepEqual(acks, [{
      id: 7,
      status: "done",
      resultText: "Not posted: the Birthday Post was for 2026-11-18, and today is " +
        "2026-11-19 in New York.",
    }]);
  });

test("birthday_post: a member who left the server since is left out", async () => {
  const deps = fakeDeps({ departed: ["102"] });
  const acks = await run(deps, { club_date: TODAY, user_ids: ["101", "102"] });

  const [{ post }] = deps.posts;
  assert.equal(
    post.content,
    "## 🎂 Happy Birthday, <@101>!\nHave a great day, from everyone at the club.",
  );
  assert.deepEqual(post.pingUserIds, ["101"]);
  assert.equal(acks[0]?.status, "done");
  assert.match(String(acks[0]?.status === "done" && acks[0].resultText), /1 no longer in/);
});

test("birthday_post: nothing is posted when every member has left", async () => {
  const deps = fakeDeps({ departed: ["101"] });
  const acks = await run(deps, { club_date: TODAY, user_ids: ["101"] });

  assert.deepEqual(deps.posts, []);
  assert.deepEqual(acks, [{
    id: 7,
    status: "done",
    resultText: "Not posted: none of the members are in the server any more.",
  }]);
});

test("birthday_post: a payload without members fails, naming the field", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const deps = fakeDeps();
  const acks = await run(deps, { club_date: TODAY, user_ids: [] });

  assert.deepEqual(deps.posts, []);
  assert.equal(acks[0]?.status, "failed");
  assert.match(acks[0]?.status === "failed" ? acks[0].error : "", /user_ids/);
});

test("birthday_post: a temporary Discord failure while posting is left for the lease",
  async (t) => {
    t.mock.method(console, "error", () => undefined);
    t.mock.method(console, "log", () => undefined);
    const deps = fakeDeps();
    deps.postMessage = async () => {
      throw new DiscordAPIError(
        { code: 0, message: "Service Unavailable" },
        0,
        503,
        "POST",
        "https://discord.com/api/v10/channels/1/messages",
        { body: {}, files: [] },
      );
    };
    const acks = await run(deps, { club_date: TODAY, user_ids: ["101"] });

    assert.deepEqual(acks, []);
  });

test("closingLine: one member, two, a handful and many", () => {
  assert.equal(closingLine(1), "Have a great day, from everyone at the club.");
  assert.equal(closingLine(2), "Have a great day, both of you, from everyone at the club.");
  assert.equal(closingLine(3), "Have a great day, all three of you, from everyone at the club.");
  assert.equal(closingLine(10), "Have a great day, all ten of you, from everyone at the club.");
  assert.equal(closingLine(12), "Have a great day, all 12 of you, from everyone at the club.");
});

test("bannerFaces: up to 4 avatars, then +N", () => {
  assert.equal(BANNER_AVATARS_MAX, 4);
  assert.deepEqual(bannerFaces(["a"]), { shown: ["a"], more: 0 });
  assert.deepEqual(bannerFaces(["a", "b", "c", "d"]), { shown: ["a", "b", "c", "d"], more: 0 });
  assert.deepEqual(bannerFaces(["a", "b", "c", "d", "e", "f"]),
    { shown: ["a", "b", "c", "d"], more: 2 });
});

test("composeBirthdayBanner: draws an initial for a member without an avatar", async () => {
  const withAvatar = await composeBirthdayBanner({
    dateLabel: "18 November",
    members: [{ name: "Lufia", avatar: await avatarPng() }],
  });
  const without = await composeBirthdayBanner({
    dateLabel: "18 November",
    members: [{ name: "Lufia", avatar: null }],
  });
  const meta = await sharp(without).metadata();
  assert.deepEqual([meta.width, meta.height], [1200, 600]);
  assert.notDeepEqual(without, withAvatar);
});

test("composeBirthdayBanner: a very long name still fits", async () => {
  const png = await composeBirthdayBanner({
    dateLabel: "18 November",
    members: [{ name: "Supercalifragilistic Expialidocious The Third", avatar: null }],
  });
  const meta = await sharp(png).metadata();
  assert.deepEqual([meta.width, meta.height], [1200, 600]);
});

test("birthday_post: a same-day redelivery of a job that posted posts nothing more",
  async () => {
    const deps = fakeDeps();
    const payload = { club_date: TODAY, user_ids: ["101", "102"] };
    await run(deps, payload);
    const acks = await run(deps, payload);

    assert.equal(deps.posts.length, 1);
    assert.deepEqual(acks, [{
      id: 7,
      status: "done",
      resultText: "Not posted: every member was already greeted in the Birthday channel " +
        "for 2026-11-18 (a repeat of a job that posted).",
    }]);
  });

test("birthday_post: a later job the same day greets only members not yet greeted",
  async () => {
    const deps = fakeDeps();
    await run(deps, { club_date: TODAY, user_ids: ["101"] });
    await run(deps, { club_date: TODAY, user_ids: ["101", "103"] });

    assert.equal(deps.posts.length, 2);
    const later = deps.posts[1]!.post;
    assert.deepEqual(later.pingUserIds, ["103"]);
    assert.equal(
      later.content,
      "## 🎂 Happy Birthday, <@103>!\nHave a great day, from everyone at the club.",
    );
  });

test("birthday_post: a post for another day does not count as greeted", async () => {
  const deps = fakeDeps({ today: "2026-11-19" });
  await run(deps, { club_date: "2026-11-19", user_ids: ["101"] });
  deps.clubToday = () => "2026-11-20";
  await run(deps, { club_date: "2026-11-20", user_ids: ["101"] });

  assert.equal(deps.posts.length, 2);
});

test("birthday_post: when the channel's history can't be read the Birthday still goes out",
  async (t) => {
    t.mock.method(console, "error", () => undefined);
    const deps = fakeDeps();
    deps.greetedOn = async () => {
      throw new DiscordAPIError(
        { code: 50001, message: "Missing Access" },
        50001,
        403,
        "GET",
        "https://discord.com/api/v10/channels/1/messages",
        { body: undefined, files: undefined },
      );
    };
    const acks = await run(deps, { club_date: TODAY, user_ids: ["101"] });

    assert.equal(deps.posts.length, 1);
    assert.equal(acks[0]?.status, "done");
  });

test("birthday_post: the banner's file name carries the club day", async () => {
  const deps = fakeDeps();
  await run(deps, { club_date: TODAY, user_ids: ["101"] });

  assert.equal(deps.posts[0]?.post.files[0]?.name, "happy-birthday-2026-11-18.png");
});
