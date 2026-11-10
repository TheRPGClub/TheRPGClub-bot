import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { GatewayDispatchEvents } from "discord.js";
import type { Client } from "discord.js";
import type { NewsPlaces } from "../config/newsHub.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import type { INewsMessage } from "../functions/NewsItem.js";
import {
  onNewsMessageCreated,
  onNewsMessageEdited,
  onNewsMessagesDeleted,
  registerUncachedNewsListeners,
  type INewsItemApi,
  type INewsRecordingDeps,
} from "../services/NewsHubRecording.js";

const NEWS_THREAD = "510000000000000001";
const OTHER_CHANNEL = "510000000000000002";
const MESSAGE_ID = "610000000000000001";
const AUTHOR_ID = "710000000000000001";
const LINK = "https://example.com/news/1";

const PLACES: NewsPlaces = new Map([[NEWS_THREAD, "industry"]]);

type ApiCall = ["record", string, unknown] | ["remove", string];

function fakeApi(fail = false): { api: INewsItemApi; calls: ApiCall[] } {
  const calls: ApiCall[] = [];
  const api: INewsItemApi = {
    record: async (messageId, body) => {
      calls.push(["record", messageId, body]);
      if (fail) throw new Error("API down");
    },
    remove: async (messageId) => {
      calls.push(["remove", messageId]);
      if (fail) throw new Error("API down");
    },
  };
  return { api, calls };
}

function deps(
  api: INewsItemApi,
  state: FeatureState | null = "live",
  testMode = false,
): INewsRecordingDeps {
  return { testMode, places: PLACES, featureState: async () => state, api };
}

function message(overrides: Partial<INewsMessage> = {}): INewsMessage {
  return {
    id: MESSAGE_ID,
    channelId: NEWS_THREAD,
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

const RECORDED_BODY = {
  data: {
    channel_id: NEWS_THREAD,
    category_key: "industry",
    author_id: AUTHOR_ID,
    author_name: "reporter",
    comment: "New patch",
    posted_at: "2026-11-10T09:00:00.000Z",
    edited_at: null,
    link: { url: LINK, title: null, site_name: null, description: null, image_url: null },
    images: [],
  },
};

test("a new News Item is recorded at once with its bare link", async () => {
  const { api, calls } = fakeApi();
  await onNewsMessageCreated(message(), deps(api));

  assert.deepEqual(calls, [["record", MESSAGE_ID, RECORDED_BODY]]);
});

test("Discord's preview arriving as an edit updates the News Item with it", async () => {
  const { api, calls } = fakeApi();
  const preview = {
    url: LINK,
    title: "Patch 2.0",
    description: "Notes",
    provider: { name: "Example" },
    thumbnail: { url: "https://example.com/t.jpg" },
    image: null,
  };
  await onNewsMessageEdited(message({ embeds: [preview] }), deps(api));

  assert.equal(calls.length, 1);
  const [kind, messageId, body] = calls[0] as ["record", string, typeof RECORDED_BODY];
  assert.equal(kind, "record");
  assert.equal(messageId, MESSAGE_ID);
  assert.deepEqual(body.data.link, {
    url: LINK,
    title: "Patch 2.0",
    site_name: "Example",
    description: "Notes",
    image_url: "https://example.com/t.jpg",
  });
});

test("an edit that removes the only link removes the News Item", async () => {
  const { api, calls } = fakeApi();
  await onNewsMessageEdited(message({ cleanContent: "never mind" }), deps(api));

  assert.deepEqual(calls, [["remove", MESSAGE_ID]]);
});

test("an edit that adds a link records the message", async () => {
  const { api, calls } = fakeApi();
  await onNewsMessageCreated(message({ cleanContent: "source coming" }), deps(api));
  await onNewsMessageEdited(message(), deps(api));

  assert.deepEqual(calls, [["record", MESSAGE_ID, RECORDED_BODY]]);
});

test("deleting a message, singly or in bulk, removes its News Item", async () => {
  const { api, calls } = fakeApi();
  await onNewsMessagesDeleted(NEWS_THREAD, [MESSAGE_ID], deps(api));
  await onNewsMessagesDeleted(NEWS_THREAD, ["610000000000000002", "610000000000000003"], deps(api));

  assert.deepEqual(calls, [
    ["remove", MESSAGE_ID],
    ["remove", "610000000000000002"],
    ["remove", "610000000000000003"],
  ]);
});

test("changes outside the category threads send nothing", async () => {
  const { api, calls } = fakeApi();
  const elsewhere = message({ channelId: OTHER_CHANNEL });
  await onNewsMessageCreated(elsewhere, deps(api));
  await onNewsMessageEdited(elsewhere, deps(api));
  await onNewsMessagesDeleted(OTHER_CHANNEL, [MESSAGE_ID], deps(api));

  assert.deepEqual(calls, []);
});

test("nothing is recorded while the News Hub is Off", async () => {
  const { api, calls } = fakeApi();
  await onNewsMessageCreated(message(), deps(api, "off"));
  await onNewsMessageEdited(message({ cleanContent: "gone" }), deps(api, "off"));
  await onNewsMessagesDeleted(NEWS_THREAD, [MESSAGE_ID], deps(api, "off"));

  assert.deepEqual(calls, []);
});

test("recording happens in Preview, in Live, and when the state cannot be read", async () => {
  for (const state of ["preview", "live", null] as const) {
    const { api, calls } = fakeApi();
    await onNewsMessageCreated(message(), deps(api, state));
    assert.deepEqual(calls, [["record", MESSAGE_ID, RECORDED_BODY]], String(state));
  }
});

test("test mode sends nothing, since a PR preview shares the production API", async () => {
  const { api, calls } = fakeApi();
  await onNewsMessageCreated(message(), deps(api, "live", true));
  await onNewsMessageEdited(message(), deps(api, "live", true));
  await onNewsMessagesDeleted(NEWS_THREAD, [MESSAGE_ID], deps(api, "live", true));

  assert.deepEqual(calls, []);
});

test("an API failure is logged, not thrown, and later removals still go out", async (t) => {
  const errors = t.mock.method(console, "error", () => undefined);
  const { api, calls } = fakeApi(true);
  await onNewsMessageCreated(message(), deps(api));
  await onNewsMessagesDeleted(NEWS_THREAD, [MESSAGE_ID, "610000000000000002"], deps(api));

  assert.equal(calls.length, 3);
  assert.ok(errors.mock.callCount() >= 1);
});

interface IFakeGateway {
  client: Client;
  ws: EventEmitter;
  fetched: string[];
}

/** A client whose channel cache holds `cachedIds`; fetching a message returns `fetchedMessage`. */
function fakeGateway(cachedIds: string[], fetchedMessage: INewsMessage = message()): IFakeGateway {
  const ws = new EventEmitter();
  const fetched: string[] = [];
  const thread = {
    isTextBased: () => true,
    messages: {
      fetch: async (messageId: string) => {
        fetched.push(messageId);
        return fetchedMessage;
      },
    },
  };
  const channels = {
    cache: new Map(cachedIds.map((id) => [id, thread])),
    fetch: async (channelId: string) => {
      fetched.push(channelId);
      return thread;
    },
  };
  return { client: { ws, channels } as unknown as Client, ws, fetched };
}

/** Lets the listeners' fire-and-forget writes settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("deletes in a category thread discord.js has not cached remove the News Items", async () => {
  const { api, calls } = fakeApi();
  const { client, ws } = fakeGateway([]);
  registerUncachedNewsListeners(client, deps(api));

  ws.emit(GatewayDispatchEvents.MessageDelete, { id: MESSAGE_ID, channel_id: NEWS_THREAD });
  ws.emit(GatewayDispatchEvents.MessageDeleteBulk, {
    ids: ["610000000000000002", "610000000000000003"],
    channel_id: NEWS_THREAD,
  });
  await settle();

  assert.deepEqual(calls, [
    ["remove", MESSAGE_ID],
    ["remove", "610000000000000002"],
    ["remove", "610000000000000003"],
  ]);
});

test("an edit in an uncached category thread is fetched and recorded", async () => {
  const { api, calls } = fakeApi();
  const { client, ws, fetched } = fakeGateway([]);
  registerUncachedNewsListeners(client, deps(api));

  ws.emit(GatewayDispatchEvents.MessageUpdate, { id: MESSAGE_ID, channel_id: NEWS_THREAD });
  await settle();

  assert.deepEqual(fetched, [NEWS_THREAD, MESSAGE_ID]);
  assert.deepEqual(calls, [["record", MESSAGE_ID, RECORDED_BODY]]);
});

test("gateway packets for a cached thread or another channel are left alone", async () => {
  const { api, calls } = fakeApi();
  const { client, ws, fetched } = fakeGateway([NEWS_THREAD]);
  registerUncachedNewsListeners(client, deps(api));

  for (const channelId of [NEWS_THREAD, OTHER_CHANNEL]) {
    ws.emit(GatewayDispatchEvents.MessageUpdate, { id: MESSAGE_ID, channel_id: channelId });
    ws.emit(GatewayDispatchEvents.MessageDelete, { id: MESSAGE_ID, channel_id: channelId });
    ws.emit(GatewayDispatchEvents.MessageDeleteBulk, { ids: [MESSAGE_ID], channel_id: channelId });
  }
  await settle();

  assert.deepEqual(fetched, []);
  assert.deepEqual(calls, []);
});
