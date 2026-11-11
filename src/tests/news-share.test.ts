import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import type { NewsCategoryThreads } from "../config/newsHub.js";
import type { INewsCopyMessage } from "../functions/NewsCopy.js";
import type { INewsEmbed } from "../functions/NewsItem.js";
import type { INewsCopyDiscord, INewsPost } from "../services/NewsCopying.js";
import {
  onNewsMessageCreated,
  onNewsMessageEdited,
  type INewsRecordingDeps,
} from "../services/NewsHubRecording.js";
import type { INewsFilingApi } from "../services/NewsItemApi.js";
import {
  shareNewsReply,
  type INewsShare,
  type INewsShareDeps,
  type INewsShareMessage,
} from "../services/NewsShare.js";

const NEWS_CHANNEL = "510000000000000001";
const SHARE_ID = "610000000000000009";
const COPY_ID = "620000000000000001";
const MEMBER_ID = "710000000000000001";
const BOT_ID = "710000000000000099";
const LINK = "https://example.com/news/1";
const SHARE_URL = `https://discord.com/channels/100/${NEWS_CHANNEL}/${SHARE_ID}`;
const POSTED_AT = new Date("2026-11-11T09:00:00.000Z");

const THREADS: NewsCategoryThreads = {
  announcements: { threadId: "520000000000000001", emoji: "📣" },
  releases: { threadId: "520000000000000002", emoji: "📦" },
  emulation: { threadId: "520000000000000003", emoji: "🕹️" },
  industry: { threadId: "520000000000000004", emoji: "🏢" },
  hardware: { threadId: "520000000000000005", emoji: "🖥️" },
  rumours: { threadId: "520000000000000006", emoji: "🤫" },
  general: { threadId: "520000000000000007", emoji: "📰" },
};

type Call =
  | ["share", string, INewsShareMessage]
  | ["record", string, unknown]
  | ["remove", string]
  | ["reportCopy", string, unknown]
  | ["react", string, string, string]
  | ["post", string, INewsCopyMessage]
  | ["delete", string, string];

interface IFakes {
  calls: Call[];
  api: INewsFilingApi;
  discord: INewsCopyDiscord;
  postShare: INewsShareDeps["postShare"];
}

/** The bot's posted message, as discord.js would give it back for what was sent. */
function postedFrom(channelId: string, sent: INewsShareMessage): INewsPost {
  return {
    id: SHARE_ID,
    channelId,
    url: SHARE_URL,
    system: false,
    webhookId: null,
    author: { id: BOT_ID, bot: true, username: "RPGClubBot", globalName: null },
    member: null,
    cleanContent: sent.content.replace(`<@${MEMBER_ID}>`, "@Reporter"),
    createdAt: POSTED_AT,
    editedAt: null,
    attachments: new Map(sent.files.map((file, index) => [String(index), {
      url: `https://cdn.discordapp.com/attachments/${NEWS_CHANNEL}/${index}/${file.name}`,
      contentType: "image/png",
      name: file.name,
    }])),
    embeds: [],
  };
}

/** A Discord REST failure as discord.js throws it. */
function restError(method: string, url: string): Error {
  return Object.assign(new Error("Missing Access"), {
    method,
    url,
    status: 403,
    rawError: { message: "Missing Access", code: 50001 },
    requestBody: { json: { content: "share" } },
  });
}

/** An API failure as axios throws it. */
function apiError(): Error {
  return new AxiosError("Request failed with status code 422", "ERR_BAD_REQUEST", {
    method: "put",
    url: `/api/v1/news_items/${SHARE_ID}`,
    data: JSON.stringify({ data: { category_key: "industry" } }),
    headers: new AxiosHeaders(),
  }, null, {
    status: 422,
    statusText: "Unprocessable Entity",
    data: { error: "invalid" },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

function fakes(fail: { share?: boolean; record?: boolean; copy?: boolean } = {}): IFakes {
  const calls: Call[] = [];
  const api: INewsFilingApi = {
    record: async (messageId, body) => {
      calls.push(["record", messageId, body]);
      if (fail.record) throw apiError();
    },
    remove: async (messageId) => {
      calls.push(["remove", messageId]);
    },
    reportCopy: async (messageId, copy) => {
      calls.push(["reportCopy", messageId, copy]);
    },
  };
  const discord: INewsCopyDiscord = {
    react: async (channelId, messageId, emoji) => {
      calls.push(["react", channelId, messageId, emoji]);
    },
    postCopy: async (threadId, copy) => {
      calls.push(["post", threadId, copy]);
      if (fail.copy) throw restError("POST", `/channels/${threadId}/messages`);
      return { messageId: COPY_ID };
    },
    deleteMessage: async (channelId, messageId) => {
      calls.push(["delete", channelId, messageId]);
    },
  };
  const postShare: INewsShareDeps["postShare"] = async (channelId, message) => {
    calls.push(["share", channelId, message]);
    if (fail.share) throw restError("POST", `/channels/${channelId}/messages`);
    return postedFrom(channelId, message);
  };
  return { calls, api, discord, postShare };
}

function preview(title: string): INewsEmbed {
  return {
    url: LINK,
    title,
    description: null,
    provider: { name: "Example" },
    thumbnail: null,
    image: null,
  };
}

/** Discord adds the preview `title` while the bot waits. */
function previewArrives(title: string): INewsShareDeps["waitForPreview"] {
  return async (posted) => ({ ...posted, embeds: [preview(title)] });
}

function deps(
  fake: IFakes,
  options: Partial<Pick<INewsShareDeps, "testMode" | "waitForPreview" | "filing">> = {},
): INewsShareDeps {
  return {
    testMode: false,
    newsChannelId: NEWS_CHANNEL,
    threads: THREADS,
    api: fake.api,
    discord: fake.discord,
    postShare: fake.postShare,
    waitForPreview: previewArrives("Studio sold"),
    filing: new Map(),
    ...options,
  };
}

function share(overrides: Partial<INewsShare> = {}): INewsShare {
  return {
    sharer: { id: MEMBER_ID, name: "Reporter" },
    link: LINK,
    categoryKey: "industry",
    comment: null,
    image: null,
    ...overrides,
  };
}

test("a link with a category is posted, recorded as the member's and copied", async () => {
  const fake = fakes();
  const reply = await shareNewsReply(share({ comment: "Big news" }), deps(fake));

  assert.deepEqual(fake.calls, [
    ["share", NEWS_CHANNEL, {
      content: `<@${MEMBER_ID}> shared\nBig news\n${LINK}`,
      files: [],
      allowedMentions: { parse: [] },
    }],
    ["record", SHARE_ID, {
      data: {
        channel_id: NEWS_CHANNEL,
        category_key: "industry",
        picked_category_key: null,
        author_id: MEMBER_ID,
        author_name: "Reporter",
        comment: "Big news",
        posted_at: POSTED_AT.toISOString(),
        edited_at: null,
        link: {
          url: LINK,
          title: "Studio sold",
          site_name: "Example",
          description: null,
          image_url: null,
        },
        images: [],
      },
    }],
    ["react", NEWS_CHANNEL, SHARE_ID, "🏢"],
    ["post", THREADS.industry.threadId, {
      content: `<@${MEMBER_ID}> shared\nBig news\n${LINK}\n-# Discuss: ${SHARE_URL}`,
      files: [],
      allowedMentions: { parse: [] },
    }],
    ["reportCopy", SHARE_ID, { message_id: COPY_ID, thread_id: THREADS.industry.threadId }],
  ]);
  assert.equal(reply.failed, false);
  assert.match(reply.text, new RegExp(SHARE_URL));
  assert.match(reply.text, /Industry/);
});

/** The record call's body. */
function recorded(fake: IFakes): { data: Record<string, unknown> } {
  const call = fake.calls.find((entry) => entry[0] === "record");
  assert.ok(call, "nothing was recorded");
  return call[2] as { data: Record<string, unknown> };
}

test("without a category the bot waits for the preview on its post, then picks", async () => {
  const fake = fakes();
  const waited: string[] = [];
  const waitForPreview: INewsShareDeps["waitForPreview"] = async (posted) => {
    waited.push(posted.id);
    return { ...posted, embeds: [preview("Official trailer")] };
  };
  const reply = await shareNewsReply(
    share({ categoryKey: null }),
    deps(fake, { waitForPreview }),
  );

  assert.deepEqual(waited, [SHARE_ID]);
  assert.equal(recorded(fake).data.category_key, "announcements");
  assert.equal(recorded(fake).data.picked_category_key, "announcements");
  assert.deepEqual(fake.calls.find((call) => call[0] === "react"),
    ["react", NEWS_CHANNEL, SHARE_ID, "📣"]);
  assert.equal(fake.calls.find((call) => call[0] === "post")?.[1],
    THREADS.announcements.threadId);
  assert.equal(reply.failed, false);
  assert.match(reply.text, /The bot filed it under \*\*Announcements & Trailers\*\*/);
});

test("with no preview after the wait the bot picks from the link and comment", async () => {
  const fake = fakes();
  await shareNewsReply(
    share({ categoryKey: null, comment: "New patch" }),
    deps(fake, { waitForPreview: async (posted) => posted }),
  );

  assert.equal(recorded(fake).data.category_key, "releases");
  assert.equal(recorded(fake).data.picked_category_key, "releases");
});

const SHOT = {
  url: "https://cdn.discordapp.com/ephemeral-attachments/1/2/shot.png?ex=6a000000",
  name: "shot.png",
  contentType: "image/png",
};
const POSTED_SHOT_URL = `https://cdn.discordapp.com/attachments/${NEWS_CHANNEL}/0/shot.png`;

test("the comment and image are carried to the post and the copy", async () => {
  const fake = fakes();
  await shareNewsReply(share({ comment: "Look at this", image: SHOT }), deps(fake));

  assert.deepEqual(fake.calls[0], ["share", NEWS_CHANNEL, {
    content: `<@${MEMBER_ID}> shared\nLook at this\n${LINK}`,
    files: [{ attachment: SHOT.url, name: "shot.png" }],
    allowedMentions: { parse: [] },
  }]);
  assert.equal(recorded(fake).data.comment, "Look at this");
  assert.deepEqual(recorded(fake).data.images, [{ url: POSTED_SHOT_URL, expires_at: null }]);
  assert.deepEqual(fake.calls.find((call) => call[0] === "post"), [
    "post",
    THREADS.industry.threadId,
    {
      content: `<@${MEMBER_ID}> shared\nLook at this\n${LINK}\n-# Discuss: ${SHARE_URL}`,
      files: [{ attachment: POSTED_SHOT_URL, name: "shot.png" }],
      allowedMentions: { parse: [] },
    },
  ]);
});

test("an attachment that is not an image is refused privately and nothing is posted", async () => {
  const fake = fakes();
  const notes = { url: "https://cdn.discordapp.com/a/notes.pdf", name: "notes.pdf",
    contentType: "application/pdf" };
  const reply = await shareNewsReply(share({ image: notes }), deps(fake));

  assert.deepEqual(fake.calls, []);
  assert.equal(reply.failed, true);
  assert.match(reply.text, /image/);
});

test("a link that is not a web address is refused privately and nothing is posted", async () => {
  for (const link of ["ftp://example.com/file", "example.com/news", "javascript:alert(1)",
    "https://", "https://example.com/a b"]) {
    const fake = fakes();
    const reply = await shareNewsReply(share({ link }), deps(fake));

    assert.deepEqual(fake.calls, [], link);
    assert.equal(reply.failed, true);
    assert.match(reply.text, /http:\/\/ or https:\/\//);
  }
});

test("test mode refuses the command, since a PR preview shares the production API", async () => {
  const fake = fakes();
  const reply = await shareNewsReply(share(), deps(fake, { testMode: true }));

  assert.deepEqual(fake.calls, []);
  assert.equal(reply.failed, true);
  assert.match(reply.text, /test mode/);
});

test("a post the bot cannot make is answered with Discord's request and response", async () => {
  const fake = fakes({ share: true });
  const reply = await shareNewsReply(share(), deps(fake));

  assert.equal(fake.calls.length, 1);
  assert.equal(reply.failed, true);
  assert.match(reply.text, /Could not post your news in the News Channel/);
  assert.match(reply.text, new RegExp(`/channels/${NEWS_CHANNEL}/messages`));
  assert.match(reply.text, /Missing Access/);
});

test("a post the API cannot record is deleted again and the reply shows the API error",
  async (t) => {
    t.mock.method(console, "error", () => {});
    const fake = fakes({ record: true });
    const reply = await shareNewsReply(share(), deps(fake));

    assert.deepEqual(fake.calls.map((call) => call[0]), ["share", "record", "delete"]);
    assert.deepEqual(fake.calls[2], ["delete", NEWS_CHANNEL, SHARE_ID]);
    assert.equal(reply.failed, true);
    assert.match(reply.text, /Could not record your news/);
    assert.match(reply.text, new RegExp(`/api/v1/news_items/${SHARE_ID}`));
    assert.match(reply.text, /422/);
    assert.match(reply.text, /"error": "invalid"/);
  });

test("a copy that fails still confirms the share, saying the copy will be retried",
  async (t) => {
    t.mock.method(console, "error", () => {});
    const fake = fakes({ copy: true });
    const reply = await shareNewsReply(share(), deps(fake));

    assert.deepEqual(fake.calls.map((call) => call[0]), ["share", "record", "react", "post"]);
    assert.equal(reply.failed, false);
    assert.match(reply.text, new RegExp(SHARE_URL));
    assert.match(reply.text, /will be retried/);
  });

test("a post deleted while waiting for its preview is not recorded", async () => {
  const fake = fakes();
  const filing = new Map();
  const waitForPreview: INewsShareDeps["waitForPreview"] = async (posted) => {
    filing.delete(posted.id);
    return posted;
  };
  const reply = await shareNewsReply(share(), deps(fake, { waitForPreview, filing }));

  assert.deepEqual(fake.calls.map((call) => call[0]), ["share"]);
  assert.equal(reply.failed, true);
  assert.equal(filing.size, 0);
});

test("the News Channel listener records the bot's post neither on arrival nor on its preview",
  async () => {
    const fake = fakes();
    const filing = new Map();
    const posts: INewsPost[] = [];
    const postShare: INewsShareDeps["postShare"] = async (channelId, message) => {
      const posted = await fake.postShare(channelId, message);
      posts.push(posted);
      return posted;
    };
    const recording: INewsRecordingDeps = {
      testMode: false,
      places: new Map([[NEWS_CHANNEL, null]]),
      threads: THREADS,
      featureState: async () => "live",
      api: { ...fake.api, find: async () => assert.fail("no News Item lookup expected") },
      discord: { ...fake.discord, editCopy: async () => assert.fail("no copy edit expected") },
      waitForPreview: async (posted) => posted,
      filing,
    };
    const waitForPreview: INewsShareDeps["waitForPreview"] = async (posted) => {
      // Discord's messageCreate for the post, then its preview edit, arrive while it waits.
      await onNewsMessageCreated(posted, recording);
      const previewed = { ...posted, embeds: [preview("Studio sold")] };
      await onNewsMessageEdited(previewed, recording);
      return previewed;
    };
    await shareNewsReply(share(), { ...deps(fake, { waitForPreview, filing }), postShare });
    const filedCalls = fake.calls.length;
    await onNewsMessageCreated(posts[0], recording);
    await onNewsMessageEdited({ ...posts[0], embeds: [preview("Studio sold")] }, recording);

    assert.deepEqual(fake.calls.map((call) => call[0]),
      ["share", "record", "react", "post", "reportCopy"]);
    assert.equal(fake.calls.length, filedCalls);
  });

test("/news is gated by the News Hub: staff only in Preview, everyone when Live", async () => {
  const { resolveFeatureGate } = await import("../functions/FeatureGate.js");
  const { NEWS_HUB_FEATURE_KEY } = await import("../config/featureGate.js");
  const { NEWS_COMMAND } = await import("../services/NewsShare.js");
  const source = (state: "off" | "preview" | "live") => ({
    flags: async () => [{ key: NEWS_HUB_FEATURE_KEY, name: "News Hub", state }],
    isStaff: async (userId: string) => userId === "staff",
  });
  const target = { type: "command" as const, name: NEWS_COMMAND };

  assert.equal(await resolveFeatureGate(target, "member", source("preview")), "not_available");
  assert.equal(await resolveFeatureGate(target, "staff", source("preview")), "preview_note");
  assert.equal(await resolveFeatureGate(target, "member", source("live")), "run");
  assert.equal(await resolveFeatureGate(target, "staff", source("off")), "not_available");
});
