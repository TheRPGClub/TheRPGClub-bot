import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import type { NewsCategoryKey, NewsCategoryThreads } from "../config/newsHub.js";
import type { INewsCopyMessage } from "../functions/NewsCopy.js";
import { NewsCopyLane } from "../services/NewsCopyLane.js";
import type { INewsPost } from "../services/NewsCopying.js";
import {
  changeNewsCategory,
  moveNewsCopies,
  type INewsCategoryApi,
  type INewsCategoryChangeDeps,
  type INewsCategoryMoveDiscord,
  type INewsItemRecord,
} from "../services/NewsCategoryChange.js";

const NEWS_CHANNEL = "510000000000000001";
const MESSAGE_ID = "610000000000000001";
const OLD_COPY_ID = "620000000000000001";
const NEW_COPY_ID = "620000000000000002";
const AUTHOR_ID = "710000000000000001";
const OTHER_ID = "710000000000000002";
const LINK = "https://example.com/news/1";
const ORIGINAL_URL = `https://discord.com/channels/100/${NEWS_CHANNEL}/${MESSAGE_ID}`;
const IMAGE_URL = "https://cdn.discordapp.com/attachments/1/2/shot.png?ex=fresh";

const THREADS: NewsCategoryThreads = {
  announcements: { threadId: "520000000000000001", emoji: "📣" },
  releases: { threadId: "520000000000000002", emoji: "📦" },
  emulation: { threadId: "520000000000000003", emoji: "🕹️" },
  industry: { threadId: "520000000000000004", emoji: "🏢" },
  hardware: { threadId: "520000000000000005", emoji: "🖥️" },
  rumours: { threadId: "520000000000000006", emoji: "🤫" },
  general: { threadId: "520000000000000007", emoji: "news:530000000000000001" },
};

type Call =
  | ["changeCategory", string, string, string]
  | ["reportCopy", string, unknown]
  | ["fetch", string, string]
  | ["react", string, string, string]
  | ["unreact", string, string, string]
  | ["post", string, INewsCopyMessage]
  | ["delete", string, string];

function record(overrides: Partial<INewsItemRecord> = {}): INewsItemRecord {
  return {
    message_id: MESSAGE_ID,
    origin: "live",
    category_key: "rumours",
    comment: "Big if true",
    posted_at: "2026-11-10T09:00:00.000Z",
    link: { url: LINK },
    author: { user_id: AUTHOR_ID },
    news_copy: { message_id: OLD_COPY_ID, thread_id: THREADS.releases.threadId },
    ...overrides,
  };
}

function post(imageSize?: number): INewsPost {
  return {
    id: MESSAGE_ID,
    channelId: NEWS_CHANNEL,
    url: ORIGINAL_URL,
    system: false,
    webhookId: null,
    author: { id: AUTHOR_ID, bot: false, username: "reporter", globalName: null },
    member: null,
    cleanContent: `Big if true ${LINK}`,
    createdAt: new Date("2026-11-10T09:00:00.000Z"),
    editedAt: null,
    attachments: new Map([["1", {
      url: IMAGE_URL,
      contentType: "image/png",
      name: "shot.png",
      size: imageSize,
    }]]),
    embeds: [],
  };
}

function apiError(status: number, error: string): AxiosError {
  const config = {
    method: "put",
    url: `/api/v1/news_items/${MESSAGE_ID}/category`,
    data: JSON.stringify({ data: { acting_user_id: OTHER_ID, category_key: "rumours" } }),
    headers: new AxiosHeaders(),
  };
  const response = {
    status,
    statusText: "",
    data: { error },
    headers: {},
    config,
  } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, response);
}

interface IOptions {
  /** What the API answers; an error is thrown. */
  answer?: { changed: boolean; previous: NewsCategoryKey | null; item?: INewsItemRecord } | Error;
  ownReactions?: string[];
  fetchFails?: boolean;
  postFails?: boolean;
  /** The original's image size in bytes. */
  imageSize?: number;
}

function setup(options: IOptions = {}): { calls: Call[]; deps: INewsCategoryChangeDeps } {
  const calls: Call[] = [];
  const answer = options.answer ?? { changed: true, previous: "releases" };
  const api: INewsCategoryApi = {
    record: async () => undefined,
    remove: async () => ({ removed: false, newsCopy: null }),
    reportCopy: async (messageId, copy) => {
      calls.push(["reportCopy", messageId, copy]);
    },
    changeCategory: async (messageId, actingUserId, categoryKey) => {
      calls.push(["changeCategory", messageId, actingUserId, categoryKey]);
      if (answer instanceof Error) throw answer;
      return {
        item: answer.item ?? record({ category_key: categoryKey }),
        changed: answer.changed,
        previousCategoryKey: answer.previous,
      };
    },
  };
  const discord: INewsCategoryMoveDiscord = {
    fetchPost: async (channelId, messageId) => {
      calls.push(["fetch", channelId, messageId]);
      if (options.fetchFails) throw new Error("Unknown Message");
      return {
        post: post(options.imageSize),
        ownReactions: options.ownReactions ?? [THREADS.releases.emoji],
      };
    },
    react: async (channelId, messageId, emoji) => {
      calls.push(["react", channelId, messageId, emoji]);
    },
    removeOwnReaction: async (channelId, messageId, emoji) => {
      calls.push(["unreact", channelId, messageId, emoji]);
    },
    postCopy: async (threadId, copy) => {
      calls.push(["post", threadId, copy]);
      if (options.postFails) throw new Error("Missing Access");
      return { messageId: NEW_COPY_ID };
    },
    deleteMessage: async (channelId, messageId) => {
      calls.push(["delete", channelId, messageId]);
    },
  };
  return { calls, deps: { threads: THREADS, api, discord } };
}

const REQUEST = {
  actingUserId: AUTHOR_ID,
  channelId: NEWS_CHANNEL,
  messageId: MESSAGE_ID,
  categoryKey: "rumours" as NewsCategoryKey,
};

function silenceErrors(t: { mock: { method: typeof test.mock.method } }): void {
  t.mock.method(console, "error", () => undefined);
}

test("a change moves the News Copy to the new thread and swaps the reaction", async () => {
  const { calls, deps } = setup();
  const reply = await changeNewsCategory(REQUEST, deps);

  const kinds = calls.map((call) => call[0]);
  assert.deepEqual(kinds, [
    "changeCategory", "fetch", "unreact", "react", "delete", "post", "reportCopy",
  ]);
  assert.deepEqual(calls[0], ["changeCategory", MESSAGE_ID, AUTHOR_ID, "rumours"]);
  assert.deepEqual(calls[2], ["unreact", NEWS_CHANNEL, MESSAGE_ID, "📦"]);
  assert.deepEqual(calls[3], ["react", NEWS_CHANNEL, MESSAGE_ID, "🤫"]);
  assert.deepEqual(calls[4], ["delete", THREADS.releases.threadId, OLD_COPY_ID]);
  const posted = calls[5] as ["post", string, INewsCopyMessage];
  assert.equal(posted[1], THREADS.rumours.threadId);
  assert.match(posted[2].content, /Big if true/);
  assert.match(posted[2].content, new RegExp(ORIGINAL_URL));
  assert.deepEqual(posted[2].files, [{ attachment: IMAGE_URL, name: "shot.png" }]);
  assert.deepEqual(calls[6], [
    "reportCopy", MESSAGE_ID, { message_id: NEW_COPY_ID, thread_id: THREADS.rumours.threadId },
  ]);
  assert.equal(reply.failed, false);
  assert.match(reply.text, /Rumours & Leaks/);
  assert.match(reply.text, new RegExp(`<#${THREADS.rumours.threadId}>`));
});

test("while a history copy runs, a change is refused and nothing changes", async () => {
  const { calls, deps } = setup();
  const lane = new NewsCopyLane();
  await lane.holdForHistory();
  const reply = await changeNewsCategory(REQUEST, { ...deps, lane });

  assert.deepEqual(calls, []);
  assert.equal(reply.failed, false);
  assert.equal(reply.text, "A history copy is running; try again when it finishes.");
});

test("while catch-up copies, the change is recorded and its copy moves once it ends",
  async () => {
    const { calls, deps } = setup();
    const lane = new NewsCopyLane();
    const hold = lane.holdForCatchUp();
    const replying = changeNewsCategory(REQUEST, { ...deps, lane });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(calls.map((call) => call[0]), ["changeCategory", "fetch", "unreact", "react"]);
    hold?.release();
    const reply = await replying;
    assert.deepEqual(calls.slice(4).map((call) => call[0]), ["delete", "post", "reportCopy"]);
    assert.match(reply.text, /Its copy is now in/);
  });

test("an image too large to upload is linked in the moved copy instead", async () => {
  const { calls, deps } = setup({ imageSize: 30 * 1024 * 1024 });
  await changeNewsCategory(REQUEST, deps);

  const [, , copy] = calls.find((call) => call[0] === "post") as
    ["post", string, INewsCopyMessage];
  assert.deepEqual(copy.files, []);
  assert.ok(copy.content.includes(`\n${IMAGE_URL}\n-# Discuss:`));
});

test("a message with no category reaction from the bot gets none (history)", async () => {
  const { calls, deps } = setup({ ownReactions: ["👍"] });
  await changeNewsCategory(REQUEST, deps);
  assert.equal(calls.some((call) => call[0] === "react" || call[0] === "unreact"), false);
  assert.equal(calls.some((call) => call[0] === "post"), true);
});

test("an imported item's new copy shows its original date", async () => {
  const item = record({ origin: "import", posted_at: "2019-06-01T10:00:00.000Z" });
  const { calls, deps } = setup({ answer: { changed: true, previous: "releases", item } });
  await changeNewsCategory(REQUEST, deps);
  const posted = calls.find((call) => call[0] === "post") as ["post", string, INewsCopyMessage];
  assert.match(posted[2].content, /<t:1559383200/);
});

test("choosing the current category does nothing", async () => {
  const { calls, deps } = setup({ answer: { changed: false, previous: "rumours" } });
  const reply = await changeNewsCategory(REQUEST, deps);
  assert.deepEqual(calls.map((call) => call[0]), ["changeCategory"]);
  assert.equal(reply.failed, false);
  assert.match(reply.text, /already/);
});

test("someone who is neither the author nor staff is refused and nothing changes", async () => {
  const { calls, deps } = setup({ answer: apiError(403, "forbidden") });
  const reply = await changeNewsCategory({ ...REQUEST, actingUserId: OTHER_ID }, deps);
  assert.deepEqual(calls.map((call) => call[0]), ["changeCategory"]);
  assert.match(reply.text, /Only the member who shared this news and staff/);
  assert.match(reply.text, /"status": 403/);
});

test("a refusal by the Feature Flag says the feature isn't available", async () => {
  const { calls, deps } = setup({ answer: apiError(403, "feature_unavailable") });
  const reply = await changeNewsCategory(REQUEST, deps);
  assert.equal(calls.length, 1);
  assert.match(reply.text, /isn't available yet/);
});

test("a message that is not a News Item says so", async () => {
  const { calls, deps } = setup({ answer: apiError(404, "not_found") });
  const reply = await changeNewsCategory(REQUEST, deps);
  assert.equal(calls.length, 1);
  assert.match(reply.text, /isn't a News Item/);
});

test("another API failure shows the request and response", async () => {
  const { deps } = setup({ answer: apiError(500, "boom") });
  const reply = await changeNewsCategory(REQUEST, deps);
  assert.equal(reply.failed, true);
  assert.match(reply.text, /"status": 500/);
  assert.match(reply.text, /news_items\/610000000000000001\/category/);
});

test("an item with no News Copy yet is left for catch-up to copy", async (t) => {
  silenceErrors(t);
  const { calls, deps } = setup({
    answer: { changed: true, previous: "releases", item: record({ news_copy: null }) },
  });
  const reply = await changeNewsCategory(REQUEST, deps);
  assert.equal(calls.some((call) => call[0] === "post" || call[0] === "delete"), false);
  assert.match(reply.text, /later/);
});

test("a copy that fails to post is reported gone, for catch-up to post again", async (t) => {
  silenceErrors(t);
  const { calls, deps } = setup({ postFails: true });
  const reply = await changeNewsCategory(REQUEST, deps);
  assert.deepEqual(calls.at(-1), ["reportCopy", MESSAGE_ID, null]);
  assert.match(reply.text, /could not be moved/);
});

test("an original that cannot be read leaves the copy where it is", async (t) => {
  silenceErrors(t);
  const { calls, deps } = setup({ fetchFails: true });
  const reply = await changeNewsCategory(REQUEST, deps);
  assert.deepEqual(calls.map((call) => call[0]), ["changeCategory", "fetch"]);
  assert.match(reply.text, /could not be moved/);
});

test("upload moves read each original and move its copy, without adding reactions", async (t) => {
  silenceErrors(t);
  const { calls, deps } = setup({ ownReactions: [] });
  const oldCopy = { message_id: OLD_COPY_ID, thread_id: THREADS.releases.threadId };
  const moved = await moveNewsCopies([
    { messageId: MESSAGE_ID, categoryKey: "industry", previousCategoryKey: "releases",
      origin: "import", copy: oldCopy },
  ], { ...deps, channelId: NEWS_CHANNEL, places: new Map([[NEWS_CHANNEL, null]]) });

  assert.equal(moved, 1);
  assert.deepEqual(calls.map((call) => call[0]), ["fetch", "delete", "post", "reportCopy"]);
  assert.deepEqual(calls[0], ["fetch", NEWS_CHANNEL, MESSAGE_ID]);
  const posted = calls[2] as ["post", string, INewsCopyMessage];
  assert.equal(posted[1], THREADS.industry.threadId);
  assert.match(posted[2].content, /<@710000000000000001> shared on <t:1794301200:D>/);
  assert.match(posted[2].content, /Big if true/);
});

test("upload moves wait while a backfill copies, then go", async (t) => {
  silenceErrors(t);
  const { calls, deps } = setup({ ownReactions: [] });
  const lane = new NewsCopyLane();
  const history = await lane.holdForHistory();
  const oldCopy = { message_id: OLD_COPY_ID, thread_id: THREADS.releases.threadId };
  const moving = moveNewsCopies([
    { messageId: MESSAGE_ID, categoryKey: "industry", previousCategoryKey: "releases",
      origin: "import", copy: oldCopy },
  ], { ...deps, lane, channelId: NEWS_CHANNEL, places: new Map([[NEWS_CHANNEL, null]]) });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, []);
  history.release();
  assert.equal(await moving, 1);
  assert.deepEqual(calls.map((call) => call[0]), ["fetch", "delete", "post", "reportCopy"]);
});

test("a moved live item's copy shows no date", async (t) => {
  silenceErrors(t);
  const { calls, deps } = setup({ ownReactions: [] });
  const oldCopy = { message_id: OLD_COPY_ID, thread_id: THREADS.releases.threadId };
  await moveNewsCopies([
    { messageId: MESSAGE_ID, categoryKey: "industry", previousCategoryKey: "releases",
      origin: "live", copy: oldCopy },
  ], { ...deps, channelId: NEWS_CHANNEL, places: new Map([[NEWS_CHANNEL, null]]) });

  const posted = calls.find((call) => call[0] === "post") as ["post", string, INewsCopyMessage];
  assert.match(posted[2].content, /^<@710000000000000001> shared\n/);
});

test("an upload move of a /news share post moves its copy, credited to the member", async () => {
  const { calls, deps } = setup({ ownReactions: [] });
  const sharerId = "710000000000000009";
  const content = `<@${sharerId}> shared\nBig if true\n${LINK}`;
  const shared: INewsPost = {
    ...post(),
    author: { id: "710000000000000099", bot: true, username: "RPGClubBot", globalName: null },
    content,
    cleanContent: content.replace(`<@${sharerId}>`, "@Reporter"),
  };
  const oldCopy = { message_id: OLD_COPY_ID, thread_id: THREADS.releases.threadId };
  const moved = await moveNewsCopies([
    { messageId: MESSAGE_ID, categoryKey: "industry", previousCategoryKey: "releases",
      origin: "live", copy: oldCopy },
  ], {
    ...deps,
    discord: { ...deps.discord, fetchPost: async () => ({ post: shared, ownReactions: [] }) },
    channelId: NEWS_CHANNEL,
    places: new Map([[NEWS_CHANNEL, null]]),
  });

  assert.equal(moved, 1);
  const posted = calls.find((call) => call[0] === "post") as ["post", string, INewsCopyMessage];
  assert.match(posted[2].content, new RegExp(`^<@${sharerId}> shared\nBig if true\n`));
});

test("an upload move whose original is gone leaves that copy and moves the rest", async (t) => {
  silenceErrors(t);
  const { calls, deps } = setup({ fetchFails: true });
  const oldCopy = { message_id: OLD_COPY_ID, thread_id: THREADS.releases.threadId };
  const moved = await moveNewsCopies([
    { messageId: MESSAGE_ID, categoryKey: "industry", previousCategoryKey: "releases",
      origin: "import", copy: oldCopy },
  ], { ...deps, channelId: NEWS_CHANNEL, places: new Map([[NEWS_CHANNEL, null]]) });
  assert.equal(moved, 0);
  assert.deepEqual(calls.map((call) => call[0]), ["fetch"]);
});
