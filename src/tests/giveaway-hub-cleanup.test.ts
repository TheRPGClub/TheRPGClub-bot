import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import { deleteGiveawayHubMessages } from "../services/GiveawayHubService.js";

const BOT_ID = "bot-1";
const client = { user: { id: BOT_ID } } as unknown as Client;

type FakeMessage = {
  id: string;
  channelId: string;
  createdTimestamp: number;
  author: { id: string };
  components: Array<{ components: Array<{ customId?: string }> }>;
  delete: () => Promise<unknown>;
};

function makeFakeMessage(
  index: number,
  options: { hub: boolean; deleted: string[]; failDelete?: boolean },
): FakeMessage {
  const id = `m${index}`;
  return {
    id,
    channelId: "channel-1",
    createdTimestamp: index,
    author: { id: options.hub ? BOT_ID : "user-1" },
    components: options.hub
      ? [{ components: [{ customId: "giveaway-hub-donate" }] }]
      : [],
    delete: async () => {
      if (options.failDelete) {
        throw new Error("Missing Permissions");
      }
      options.deleted.push(id);
    },
  };
}

// Messages are ordered newest first, like Discord returns them.
function buildChannel(messages: FakeMessage[], fetchCalls: Array<string | undefined>): any {
  return {
    messages: {
      fetch: async ({ limit, before }: { limit: number; before?: string }) => {
        fetchCalls.push(before);
        const start = before ? messages.findIndex((m) => m.id === before) + 1 : 0;
        const page = messages.slice(start, start + limit);
        return new Map(page.map((m) => [m.id, m]));
      },
    },
  };
}

test("deletes only the bot's hub messages", async () => {
  const deleted: string[] = [];
  const messages = [
    makeFakeMessage(3, { hub: true, deleted }),
    makeFakeMessage(2, { hub: false, deleted }),
    makeFakeMessage(1, { hub: true, deleted }),
  ];
  const fetchCalls: Array<string | undefined> = [];

  await deleteGiveawayHubMessages(client, buildChannel(messages, fetchCalls));

  assert.deepEqual(deleted, ["m3", "m1"]);
  assert.deepEqual(fetchCalls, [undefined]);
});

test("stops when an undeletable hub message is the only one left", async () => {
  const deleted: string[] = [];
  const messages = [makeFakeMessage(1, { hub: true, deleted, failDelete: true })];
  const fetchCalls: Array<string | undefined> = [];

  await deleteGiveawayHubMessages(client, buildChannel(messages, fetchCalls));

  assert.deepEqual(deleted, []);
  assert.equal(fetchCalls.length, 1);
});

test("pages backwards with before and stops at a page with no hub message", async () => {
  const deleted: string[] = [];
  const messages: FakeMessage[] = [];
  for (let index = 150; index > 0; index--) {
    const hub = index > 100 || index === 20;
    messages.push(makeFakeMessage(index, { hub, deleted, failDelete: index === 150 }));
  }
  const fetchCalls: Array<string | undefined> = [];

  await deleteGiveawayHubMessages(client, buildChannel(messages, fetchCalls));

  assert.equal(deleted.length, 49);
  assert.ok(!deleted.includes("m150"));
  assert.ok(!deleted.includes("m20"));
  assert.deepEqual(fetchCalls, [undefined, "m101"]);
});
