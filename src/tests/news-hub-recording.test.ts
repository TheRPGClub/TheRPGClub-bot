import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { GatewayDispatchEvents } from "discord.js";
import type { Client } from "discord.js";
import type { NewsCategoryThreads, NewsPlaces } from "../config/newsHub.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import type { INewsCopyMessage } from "../functions/NewsCopy.js";
import type { INewsEmbed } from "../functions/NewsItem.js";
import type { INewsCopyDiscord, INewsPost } from "../services/NewsCopying.js";
import {
  onNewsMessageCreated,
  onNewsMessageEdited,
  onNewsMessagesDeleted,
  registerUncachedNewsListeners,
  type INewsRecordingDeps,
} from "../services/NewsHubRecording.js";
import type { INewsFilingApi } from "../services/NewsItemApi.js";

const NEWS_CHANNEL = "510000000000000001";
const OTHER_CHANNEL = "510000000000000002";
const DISCUSSION_THREAD = "510000000000000003";
const MESSAGE_ID = "610000000000000001";
const COPY_ID = "620000000000000001";
const AUTHOR_ID = "710000000000000001";
const LINK = "https://example.com/news/1";
const ORIGINAL_URL = `https://discord.com/channels/100/${NEWS_CHANNEL}/${MESSAGE_ID}`;

const PLACES: NewsPlaces = new Map([[NEWS_CHANNEL, null]]);

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
}

/** A Discord REST failure as discord.js throws it. */
function restError(method: string, url: string): Error {
  return Object.assign(new Error("Missing Access"), {
    method,
    url,
    status: 403,
    rawError: { message: "Missing Access", code: 50001 },
    requestBody: { json: { content: "copy" } },
  });
}

function fakes(fail: { api?: boolean; post?: boolean; react?: boolean } = {}): IFakes {
  const calls: Call[] = [];
  const api: INewsFilingApi = {
    record: async (messageId, body) => {
      calls.push(["record", messageId, body]);
      if (fail.api) throw new Error("API down");
    },
    remove: async (messageId) => {
      calls.push(["remove", messageId]);
      if (fail.api) throw new Error("API down");
    },
    reportCopy: async (messageId, copy) => {
      calls.push(["reportCopy", messageId, copy]);
      if (fail.api) throw new Error("API down");
    },
  };
  const discord: INewsCopyDiscord = {
    react: async (channelId, messageId, emoji) => {
      calls.push(["react", channelId, messageId, emoji]);
      if (fail.react) throw restError("PUT", "/channels/1/messages/2/reactions/x/@me");
    },
    postCopy: async (threadId, copy) => {
      calls.push(["post", threadId, copy]);
      if (fail.post) throw restError("POST", `/channels/${threadId}/messages`);
      return { messageId: COPY_ID };
    },
    deleteMessage: async (channelId, messageId) => {
      calls.push(["delete", channelId, messageId]);
    },
  };
  return { calls, api, discord };
}

function deps(
  { api, discord }: IFakes,
  options: {
    state?: FeatureState | null;
    testMode?: boolean;
    preview?: (message: INewsPost) => Promise<INewsPost>;
    copiesPaused?: () => boolean;
  } = {},
): INewsRecordingDeps {
  return {
    testMode: options.testMode ?? false,
    places: PLACES,
    threads: THREADS,
    featureState: async () => (options.state === undefined ? "live" : options.state),
    api,
    discord,
    waitForPreview: options.preview ?? (async (message) => message),
    filing: new Map(),
    ...(options.copiesPaused ? { copiesPaused: options.copiesPaused } : {}),
  };
}

function message(overrides: Partial<INewsPost> = {}): INewsPost {
  return {
    id: MESSAGE_ID,
    channelId: NEWS_CHANNEL,
    url: ORIGINAL_URL,
    system: false,
    webhookId: null,
    author: { id: AUTHOR_ID, bot: false, username: "reporter", globalName: null },
    member: null,
    cleanContent: `New patch ${LINK}`,
    createdAt: new Date("2026-11-10T09:00:00.000Z"),
    editedAt: null,
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
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

const BARE_LINK = { url: LINK, title: null, site_name: null, description: null, image_url: null };

/** The PUT body of a new post: "New patch" with no preview picks Releases & Updates. */
const RECORDED_BODY = {
  data: {
    channel_id: NEWS_CHANNEL,
    category_key: "releases",
    picked_category_key: "releases",
    author_id: AUTHOR_ID,
    author_name: "reporter",
    comment: "New patch",
    posted_at: "2026-11-10T09:00:00.000Z",
    edited_at: null,
    link: BARE_LINK,
    images: [],
  },
};

const COPY_TEXT = `<@${AUTHOR_ID}> shared\nNew patch\n${LINK}\n-# Discuss: ${ORIGINAL_URL}`;

test("a link post is recorded, reacted to, copied and its copy reported, in order", async () => {
  const fake = fakes();
  await onNewsMessageCreated(message(), deps(fake));

  assert.deepEqual(fake.calls, [
    ["record", MESSAGE_ID, RECORDED_BODY],
    ["react", NEWS_CHANNEL, MESSAGE_ID, "📦"],
    ["post", THREADS.releases.threadId, {
      content: COPY_TEXT,
      files: [],
      allowedMentions: { parse: [] },
    }],
    ["reportCopy", MESSAGE_ID, { message_id: COPY_ID, thread_id: THREADS.releases.threadId }],
  ]);
});

test("while a history copy runs, a post is recorded and reacted to but not copied", async () => {
  const fake = fakes();
  await onNewsMessageCreated(message(), deps(fake, { copiesPaused: () => true }));

  assert.deepEqual(fake.calls, [
    ["record", MESSAGE_ID, RECORDED_BODY],
    ["react", NEWS_CHANNEL, MESSAGE_ID, "📦"],
  ]);
});

test("once the history copy ends, a post is copied again", async () => {
  const fake = fakes();
  await onNewsMessageCreated(message(), deps(fake, { copiesPaused: () => false }));

  assert.deepEqual(fake.calls.map((call) => call[0]), ["record", "react", "post", "reportCopy"]);
});

test("a link with no preview yet waits for it, then picks from the preview", async () => {
  const fake = fakes();
  const waited: string[] = [];
  const withPreview = async (posted: INewsPost): Promise<INewsPost> => {
    waited.push(posted.id);
    return { ...posted, embeds: [preview("Official trailer")] };
  };
  const posted = message({ cleanContent: `Look at this ${LINK}` });
  await onNewsMessageCreated(posted, deps(fake, { preview: withPreview }));

  assert.deepEqual(waited, [MESSAGE_ID]);
  const [, , body] = fake.calls[0] as ["record", string, typeof RECORDED_BODY];
  assert.equal(body.data.category_key, "announcements");
  assert.equal(body.data.picked_category_key, "announcements");
  assert.equal(body.data.link.title, "Official trailer");
  assert.deepEqual(fake.calls[1], ["react", NEWS_CHANNEL, MESSAGE_ID, "📣"]);
  const [, threadId] = fake.calls[2] as ["post", string, INewsCopyMessage];
  assert.equal(threadId, THREADS.announcements.threadId);
});

test("a post that has its preview already, or no link, does not wait", async () => {
  const fake = fakes();
  const waited: string[] = [];
  const options = {
    preview: async (posted: INewsPost): Promise<INewsPost> => {
      waited.push(posted.id);
      return posted;
    },
  };
  const previewed = message({ embeds: [preview("Official trailer")] });
  await onNewsMessageCreated(previewed, deps(fake, options));
  const image = {
    url: "https://cdn.discordapp.com/a/1/shot.png",
    contentType: "image/png",
    name: "shot.png",
  };
  await onNewsMessageCreated(
    message({ cleanContent: "", attachments: new Map([["1", image]]) }),
    deps(fake, options),
  );

  assert.deepEqual(waited, []);
});

test("an image post is filed in General with its images uploaded again", async () => {
  const fake = fakes();
  const shot = {
    url: "https://cdn.discordapp.com/a/1/shot.png?ex=6a000000",
    contentType: "image/png",
    name: "shot.png",
  };
  const notes = {
    url: "https://cdn.discordapp.com/a/2/notes.txt",
    contentType: "text/plain",
    name: "notes.txt",
  };
  await onNewsMessageCreated(
    message({ cleanContent: "Look", attachments: new Map([["1", shot], ["2", notes]]) }),
    deps(fake),
  );

  assert.deepEqual(fake.calls[1], ["react", NEWS_CHANNEL, MESSAGE_ID, "📰"]);
  assert.deepEqual(fake.calls[2], ["post", THREADS.general.threadId, {
    content: `<@${AUTHOR_ID}> shared\nLook\n-# Discuss: ${ORIGINAL_URL}`,
    files: [{ attachment: shot.url, name: "shot.png" }],
    allowedMentions: { parse: [] },
  }]);
});

test("an image larger than the bot may upload is linked in the copy, which still posts", async () => {
  const fake = fakes();
  const huge = {
    url: "https://cdn.discordapp.com/a/1/huge.png?ex=6a000000",
    contentType: "image/png",
    name: "huge.png",
    size: 30 * 1024 * 1024,
  };
  await onNewsMessageCreated(
    message({ cleanContent: "Look", attachments: new Map([["1", huge]]) }),
    deps(fake),
  );

  assert.deepEqual(fake.calls[2], ["post", THREADS.general.threadId, {
    content: `<@${AUTHOR_ID}> shared\nLook\n${huge.url}\n-# Discuss: ${ORIGINAL_URL}`,
    files: [],
    allowedMentions: { parse: [] },
  }]);
});

test("thread messages, text-only messages and bots' messages are ignored", async () => {
  const fake = fakes();
  const bot = { id: "710000000000000002", bot: true, username: "bot", globalName: null };
  await onNewsMessageCreated(message({ channelId: DISCUSSION_THREAD }), deps(fake));
  await onNewsMessageCreated(message({ cleanContent: "just chatting" }), deps(fake));
  await onNewsMessageCreated(message({ author: bot }), deps(fake));
  await onNewsMessageCreated(message({ channelId: OTHER_CHANNEL }), deps(fake));

  assert.deepEqual(fake.calls, []);
});

test("a failed copy leaves the item uncopied and logs request and response", async (t) => {
  const errors = t.mock.method(console, "error", () => undefined);
  const fake = fakes({ post: true });
  await onNewsMessageCreated(message(), deps(fake));

  assert.deepEqual(fake.calls.map((call) => call[0]), ["record", "react", "post"]);
  const logged = errors.mock.calls.map((call) => String(call.arguments[0])).join("\n");
  assert.match(logged, /POST/);
  assert.match(logged, new RegExp(`/channels/${THREADS.releases.threadId}/messages`));
  assert.match(logged, /Missing Access/);
});

test("a failed reaction is logged and the copy still goes out", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const fake = fakes({ react: true });
  await onNewsMessageCreated(message(), deps(fake));

  assert.deepEqual(fake.calls.map((call) => call[0]), ["record", "react", "post", "reportCopy"]);
});

test("a post the API cannot record is neither reacted to nor copied", async (t) => {
  const errors = t.mock.method(console, "error", () => undefined);
  const fake = fakes({ api: true });
  await onNewsMessageCreated(message(), deps(fake));

  assert.deepEqual(fake.calls.map((call) => call[0]), ["record"]);
  assert.equal(errors.mock.callCount(), 1);
});

test("a copy whose location cannot be reported is deleted, so no retry doubles it", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const fake = fakes();
  const failingReport: INewsFilingApi = {
    ...fake.api,
    reportCopy: async (messageId, copy) => {
      fake.calls.push(["reportCopy", messageId, copy]);
      throw new Error("API down");
    },
  };
  await onNewsMessageCreated(message(), deps({ ...fake, api: failingReport }));

  assert.deepEqual(fake.calls.at(-1), ["delete", THREADS.releases.threadId, COPY_ID]);
});

test("an edit is recorded without a category, so the stored one is kept", async () => {
  const fake = fakes();
  await onNewsMessageEdited(message({ embeds: [preview("Patch 2.0")] }), deps(fake));

  assert.equal(fake.calls.length, 1);
  const [kind, messageId, body] = fake.calls[0] as ["record", string, { data: object }];
  assert.equal(kind, "record");
  assert.equal(messageId, MESSAGE_ID);
  assert.equal("category_key" in body.data, false);
  assert.equal("picked_category_key" in body.data, false);
});

test("Discord's preview arriving while the post is filed is left to the filing", async () => {
  const fake = fakes();
  const recording = deps(fake, {
    preview: async (posted) => {
      const updated = { ...posted, embeds: [preview("Official trailer")] };
      await onNewsMessageEdited(updated, recording);
      return updated;
    },
  });
  await onNewsMessageCreated(message(), recording);
  await onNewsMessageEdited(message({ cleanContent: `Fixed ${LINK}` }), recording);

  assert.deepEqual(fake.calls.map((call) => call[0]), [
    "record",
    "react",
    "post",
    "reportCopy",
    "record",
  ]);
});

test("an edit made while the post is being copied is recorded once the filing ends", async () => {
  const fake = fakes();
  const fixed = message({ cleanContent: `Fixed typo ${LINK}`, embeds: [preview("Patch")] });
  const recording = deps(fake);
  const postCopy = fake.discord.postCopy;
  recording.discord = {
    ...fake.discord,
    postCopy: async (threadId, copy) => {
      await onNewsMessageEdited(fixed, recording);
      return postCopy(threadId, copy);
    },
  };
  await onNewsMessageCreated(message(), recording);

  assert.deepEqual(fake.calls.map((call) => call[0]), [
    "record",
    "react",
    "post",
    "reportCopy",
    "record",
  ]);
  const [, , body] = fake.calls[4] as ["record", string, { data: { comment: string } }];
  assert.equal(body.data.comment, "Fixed typo");
  assert.equal("category_key" in body.data, false);
});

test("a post deleted while waiting for its preview is not filed", async () => {
  const fake = fakes();
  const recording = deps(fake, {
    preview: async (posted) => {
      await onNewsMessagesDeleted(NEWS_CHANNEL, [posted.id], recording);
      return posted;
    },
  });
  await onNewsMessageCreated(message(), recording);

  assert.deepEqual(fake.calls, [["remove", MESSAGE_ID]]);
});

test("an edit that removes the only link removes the News Item", async () => {
  const fake = fakes();
  await onNewsMessageEdited(message({ cleanContent: "never mind" }), deps(fake));

  assert.deepEqual(fake.calls, [["remove", MESSAGE_ID]]);
});

test("deleting a message, singly or in bulk, removes its News Item", async () => {
  const fake = fakes();
  await onNewsMessagesDeleted(NEWS_CHANNEL, [MESSAGE_ID], deps(fake));
  await onNewsMessagesDeleted(
    NEWS_CHANNEL,
    ["610000000000000002", "610000000000000003"],
    deps(fake),
  );

  assert.deepEqual(fake.calls, [
    ["remove", MESSAGE_ID],
    ["remove", "610000000000000002"],
    ["remove", "610000000000000003"],
  ]);
});

test("posts in a category thread are no longer recorded", async () => {
  const fake = fakes();
  const inThread = message({ channelId: THREADS.industry.threadId });
  await onNewsMessageCreated(inThread, deps(fake));
  await onNewsMessageEdited(inThread, deps(fake));
  await onNewsMessagesDeleted(THREADS.industry.threadId, [MESSAGE_ID], deps(fake));

  assert.deepEqual(fake.calls, []);
});

test("nothing happens in the News Channel while the News Hub is Off", async () => {
  const fake = fakes();
  await onNewsMessageCreated(message(), deps(fake, { state: "off" }));
  await onNewsMessageEdited(message({ cleanContent: "gone" }), deps(fake, { state: "off" }));
  await onNewsMessagesDeleted(NEWS_CHANNEL, [MESSAGE_ID], deps(fake, { state: "off" }));

  assert.deepEqual(fake.calls, []);
});

test("posts are filed in Preview, in Live, and when the state cannot be read", async () => {
  for (const state of ["preview", "live", null] as const) {
    const fake = fakes();
    await onNewsMessageCreated(message(), deps(fake, { state }));
    assert.deepEqual(
      fake.calls.map((call) => call[0]),
      ["record", "react", "post", "reportCopy"],
      String(state),
    );
  }
});

test("test mode sends nothing, since a PR preview shares the production API", async () => {
  const fake = fakes();
  await onNewsMessageCreated(message(), deps(fake, { testMode: true }));
  await onNewsMessageEdited(message(), deps(fake, { testMode: true }));
  await onNewsMessagesDeleted(NEWS_CHANNEL, [MESSAGE_ID], deps(fake, { testMode: true }));

  assert.deepEqual(fake.calls, []);
});

test("an API failure on delete is logged, not thrown, and later removals go out", async (t) => {
  const errors = t.mock.method(console, "error", () => undefined);
  const fake = fakes({ api: true });
  await onNewsMessagesDeleted(NEWS_CHANNEL, [MESSAGE_ID, "610000000000000002"], deps(fake));

  assert.equal(fake.calls.length, 2);
  assert.equal(errors.mock.callCount(), 2);
});

interface IFakeGateway {
  client: Client;
  ws: EventEmitter;
  fetched: string[];
}

/** A client whose channel cache holds `cachedIds`; fetching a message returns `fetchedMessage`. */
function fakeGateway(cachedIds: string[], fetchedMessage: INewsPost = message()): IFakeGateway {
  const ws = new EventEmitter();
  const fetched: string[] = [];
  const channel = {
    isTextBased: () => true,
    messages: {
      fetch: async (messageId: string) => {
        fetched.push(messageId);
        return fetchedMessage;
      },
    },
  };
  const channels = {
    cache: new Map(cachedIds.map((id) => [id, channel])),
    fetch: async (channelId: string) => {
      fetched.push(channelId);
      return channel;
    },
  };
  return { client: { ws, channels } as unknown as Client, ws, fetched };
}

/** Lets the listeners' fire-and-forget writes settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("deletes in an uncached News Channel remove the News Items", async () => {
  const fake = fakes();
  const { client, ws } = fakeGateway([]);
  registerUncachedNewsListeners(client, deps(fake));

  ws.emit(GatewayDispatchEvents.MessageDelete, { id: MESSAGE_ID, channel_id: NEWS_CHANNEL });
  ws.emit(GatewayDispatchEvents.MessageDeleteBulk, {
    ids: ["610000000000000002", "610000000000000003"],
    channel_id: NEWS_CHANNEL,
  });
  await settle();

  assert.deepEqual(fake.calls, [
    ["remove", MESSAGE_ID],
    ["remove", "610000000000000002"],
    ["remove", "610000000000000003"],
  ]);
});

test("an edit in an uncached News Channel is fetched and recorded", async () => {
  const fake = fakes();
  const { client, ws, fetched } = fakeGateway([]);
  registerUncachedNewsListeners(client, deps(fake));

  ws.emit(GatewayDispatchEvents.MessageUpdate, { id: MESSAGE_ID, channel_id: NEWS_CHANNEL });
  await settle();

  assert.deepEqual(fetched, [NEWS_CHANNEL, MESSAGE_ID]);
  assert.deepEqual(fake.calls.map((call) => call[0]), ["record"]);
});

test("gateway packets for a cached channel or another channel are left alone", async () => {
  const fake = fakes();
  const { client, ws, fetched } = fakeGateway([NEWS_CHANNEL]);
  registerUncachedNewsListeners(client, deps(fake));

  for (const channelId of [NEWS_CHANNEL, OTHER_CHANNEL]) {
    ws.emit(GatewayDispatchEvents.MessageUpdate, { id: MESSAGE_ID, channel_id: channelId });
    ws.emit(GatewayDispatchEvents.MessageDelete, { id: MESSAGE_ID, channel_id: channelId });
    ws.emit(GatewayDispatchEvents.MessageDeleteBulk, { ids: [MESSAGE_ID], channel_id: channelId });
  }
  await settle();

  assert.deepEqual(fetched, []);
  assert.deepEqual(fake.calls, []);
});
