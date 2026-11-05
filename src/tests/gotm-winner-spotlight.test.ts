import test from "node:test";
import assert from "node:assert/strict";
import { ChannelFlags, ChannelType, type Client } from "discord.js";

import BotPresenceHistory from "../classes/BotPresenceHistory.js";
import { setAutomaticPresence } from "../functions/SetPresence.js";
import {
  buildGotmPresence,
  pinWinnerThread,
} from "../services/WinnerThreadService.js";

function presenceClient(seen: string[]): Client {
  return {
    user: {
      setPresence: (data: { activities: { name: string }[] }) => {
        seen.push(data.activities[0].name);
      },
    },
  } as unknown as Client;
}

test("buildGotmPresence names the game and its GOTM round", () => {
  assert.equal(
    buildGotmPresence("Fire Emblem: Fortune's Weave", 12),
    "Fire Emblem: Fortune's Weave [GOTM Round 12]",
  );
});

test("buildGotmPresence fits Discord's 128 character activity limit", () => {
  const presence = buildGotmPresence("A".repeat(200), 12);
  assert.ok(presence.length <= 128);
});

test("setAutomaticPresence sets and saves a new status with no member", async (t) => {
  t.mock.method(BotPresenceHistory, "getLatestPresenceActivity", async () => "Old");
  const save = t.mock.method(BotPresenceHistory, "savePresence", async () => undefined);
  const seen: string[] = [];
  await setAutomaticPresence(presenceClient(seen), "New [GOTM Round 3]");
  assert.deepEqual(seen, ["New [GOTM Round 3]"]);
  assert.deepEqual(save.mock.calls[0]?.arguments, ["New [GOTM Round 3]", null, null]);
});

test("setAutomaticPresence does not save the status again when it is current", async (t) => {
  t.mock.method(BotPresenceHistory, "getLatestPresenceActivity", async () => "Same");
  const save = t.mock.method(BotPresenceHistory, "savePresence", async () => undefined);
  const seen: string[] = [];
  await setAutomaticPresence(presenceClient(seen), "Same");
  assert.deepEqual(seen, ["Same"]);
  assert.equal(save.mock.callCount(), 0);
});

interface IFakeThread {
  id: string;
  archived: boolean;
  pinned: boolean;
  parent: unknown;
  flags: { has: (flag: ChannelFlags) => boolean };
  isThread: () => true;
  setArchived: (archived: boolean) => Promise<void>;
  pin: () => Promise<void>;
  unpin: () => Promise<void>;
}

function fakeForum(threads: IFakeThread[]): Client {
  const forum = {
    type: ChannelType.GuildForum,
    threads: {
      fetchActive: async () => ({
        threads: new Map(threads.map((thread) => [thread.id, thread])),
      }),
    },
  };
  for (const thread of threads) thread.parent = forum;
  return {
    channels: {
      fetch: async (id: string) => threads.find((thread) => thread.id === id) ?? null,
    },
  } as unknown as Client;
}

function fakeThread(id: string, pinned: boolean, archived = false): IFakeThread {
  const thread: IFakeThread = {
    id,
    archived,
    pinned,
    parent: null,
    flags: { has: (flag) => flag === ChannelFlags.Pinned && thread.pinned },
    isThread: () => true,
    setArchived: async (value) => { thread.archived = value; },
    pin: async () => { thread.pinned = true; },
    unpin: async () => { thread.pinned = false; },
  };
  return thread;
}

test("pinWinnerThread unpins the last winner and pins the new one", async () => {
  const previous = fakeThread("old", true);
  const winner = fakeThread("new", false, true);
  await pinWinnerThread(fakeForum([previous, winner]), "new");
  assert.equal(previous.pinned, false);
  assert.equal(winner.pinned, true);
  assert.equal(winner.archived, false);
});

test("pinWinnerThread leaves an already pinned winner alone", async () => {
  const winner = fakeThread("new", true);
  let unpinned = false;
  winner.unpin = async () => { unpinned = true; };
  await pinWinnerThread(fakeForum([winner]), "new");
  assert.equal(winner.pinned, true);
  assert.equal(unpinned, false);
});
