import assert from "node:assert/strict";
import test from "node:test";
import axios, { type AxiosAdapter } from "axios";
import type { Client } from "discord.js";

process.env.RPGCLUB_API_BASE_URL = "https://api.example.test";
process.env.RPGCLUB_BOT_API_TOKEN = "token";

// No keys: the hub renders its empty state without any other API call.
const adapter: AxiosAdapter = async (config) => ({
  data: { data: [], meta: { count: 0 } },
  status: 200,
  statusText: "",
  headers: {},
  config,
});
axios.defaults.adapter = adapter;

const { BOT_DEV_CHANNEL_ID, GIVEAWAY_HUB_CHANNEL_ID } = await import("../config/channels.js");
const { refreshGiveawayHubMessage } = await import("../services/GiveawayHubService.js");

const BOT_ID = "bot-user";

type FakeMessage = {
  id: string;
  channelId: string;
  createdTimestamp: number;
  author: { id: string };
  components: Array<{ components: Array<{ customId: string }> }>;
  delete: () => Promise<void>;
};

type FakeChannel = {
  id: string;
  sent: number;
  store: Map<string, FakeMessage>;
};

/**
 * Discord with one text channel per id. Each channel is busy: a scan of its latest
 * messages never reaches the hub, which is only found by its id.
 */
function busyDiscord(): { client: Client; channels: Map<string, FakeChannel>; edits: string[] } {
  const channels = new Map<string, FakeChannel>();
  const edits: string[] = [];
  let nextId = 1;
  const channelFor = (id: string) => {
    let state = channels.get(id);
    if (!state) {
      state = { id, sent: 0, store: new Map() };
      channels.set(id, state);
    }
    const channel = state;
    return {
      id,
      isTextBased: () => true,
      send: async () => {
        channel.sent += 1;
        const message: FakeMessage = {
          id: `m${nextId++}`,
          channelId: id,
          createdTimestamp: nextId,
          author: { id: BOT_ID },
          components: [{ components: [{ customId: "giveaway-hub-claim" }] }],
          delete: async () => {
            channel.store.delete(message.id);
          },
        };
        channel.store.set(message.id, message);
        return message;
      },
      messages: {
        fetch: async (query: string | object) => {
          if (typeof query !== "string") return new Map();
          const found = channel.store.get(query);
          if (!found) throw new Error("Unknown Message");
          return found;
        },
      },
    };
  };
  const client = {
    user: { id: BOT_ID },
    channels: { fetch: async (id: string) => channelFor(id) },
    rest: {
      patch: async (route: string) => {
        edits.push(route);
      },
    },
  } as unknown as Client;
  return { client, channels, edits };
}

test("giveaway hub in Preview: a busy bot-dev keeps one hub, edited in place", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const { client, channels, edits } = busyDiscord();

  await refreshGiveawayHubMessage(client, 0, { featureState: "preview" });
  await refreshGiveawayHubMessage(client, 0, { featureState: "preview" });

  const botDev = channels.get(BOT_DEV_CHANNEL_ID);
  assert.equal(botDev?.sent, 1);
  assert.equal(botDev?.store.size, 1);
  assert.equal(edits.length, 1);
});

test("giveaway hub leaving Preview: the bot-dev hub is removed", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  t.mock.method(console, "log", () => undefined);
  const { client, channels } = busyDiscord();

  await refreshGiveawayHubMessage(client, 0, { featureState: "preview" });
  assert.equal(channels.get(BOT_DEV_CHANNEL_ID)?.store.size, 1);
  await refreshGiveawayHubMessage(client, 0, { featureState: "live" });

  assert.equal(channels.get(BOT_DEV_CHANNEL_ID)?.store.size, 0);
  assert.equal(channels.get(GIVEAWAY_HUB_CHANNEL_ID)?.store.size, 1);
});
