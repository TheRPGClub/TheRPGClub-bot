import test from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import {
  onGuildChannelCreate,
  onGuildChannelDelete,
  onGuildChannelUpdate,
  syncAllGuildChannels,
  toGuildChannelPayload,
  type IGuildChannelApi,
  type IGuildChannelSyncDeps,
} from "../services/GuildChannelSync.js";

const HOME = "home-guild";

interface IFakeChannelFields {
  id?: string;
  name?: string;
  type?: ChannelType;
  parentId?: string | null;
  rawPosition?: number;
  guildId?: string;
  thread?: boolean;
}

function fakeChannel(fields: IFakeChannelFields = {}): any {
  return {
    id: fields.id ?? "100",
    name: fields.name ?? "general",
    type: fields.type ?? ChannelType.GuildText,
    parentId: fields.parentId === undefined ? "900" : fields.parentId,
    rawPosition: fields.rawPosition ?? 3,
    guildId: fields.guildId ?? HOME,
    guild: { id: fields.guildId ?? HOME },
    isDMBased: () => false,
    isThread: () => fields.thread ?? false,
  };
}

test("toGuildChannelPayload sends the raw Discord type, parent and position", () => {
  const payload = toGuildChannelPayload(
    fakeChannel({ type: ChannelType.GuildAnnouncement, rawPosition: 7 }),
  );
  assert.deepEqual(payload, {
    channel_id: "100",
    name: "general",
    channel_type: 5,
    parent_id: "900",
    position: 7,
  });
});

test("toGuildChannelPayload sends a category with a null parent", () => {
  const payload = toGuildChannelPayload(
    fakeChannel({ id: "900", name: "Games", type: ChannelType.GuildCategory, parentId: null }),
  );
  assert.deepEqual(payload, {
    channel_id: "900",
    name: "Games",
    channel_type: 4,
    parent_id: null,
    position: 3,
  });
});

interface IApiCall {
  method: string;
  path: string;
  body?: unknown;
}

function fakeDeps(
  calls: IApiCall[],
  overrides: Partial<IGuildChannelSyncDeps> = {},
): IGuildChannelSyncDeps {
  const api: IGuildChannelApi = {
    sync: async (body) => { calls.push({ method: "POST", path: "/sync", body }); },
    upsert: async (id, body) => { calls.push({ method: "PUT", path: `/${id}`, body }); },
    remove: async (id) => { calls.push({ method: "DELETE", path: `/${id}` }); },
  };
  return { testMode: false, homeGuildId: HOME, api, ...overrides };
}

test("channelCreate PUTs the new channel without a body channel_id", async () => {
  const calls: IApiCall[] = [];
  await onGuildChannelCreate(fakeChannel({ id: "101", name: "lfg" }), fakeDeps(calls));
  assert.deepEqual(calls, [{
    method: "PUT",
    path: "/101",
    body: { data: { name: "lfg", channel_type: 0, parent_id: "900", position: 3 } },
  }]);
});

test("channelCreate sends nothing for another guild or in test mode", async () => {
  const calls: IApiCall[] = [];
  await onGuildChannelCreate(fakeChannel({ guildId: "other" }), fakeDeps(calls));
  await onGuildChannelCreate(fakeChannel(), fakeDeps(calls, { testMode: true }));
  assert.deepEqual(calls, []);
});

test("channelUpdate PUTs a rename, a move to another category and a reorder", async () => {
  const calls: IApiCall[] = [];
  const before = fakeChannel();
  await onGuildChannelUpdate(before, fakeChannel({ name: "chat" }), fakeDeps(calls));
  await onGuildChannelUpdate(before, fakeChannel({ parentId: "901" }), fakeDeps(calls));
  await onGuildChannelUpdate(before, fakeChannel({ rawPosition: 0 }), fakeDeps(calls));
  assert.deepEqual(calls.map((call) => call.body), [
    { data: { name: "chat", channel_type: 0, parent_id: "900", position: 3 } },
    { data: { name: "general", channel_type: 0, parent_id: "901", position: 3 } },
    { data: { name: "general", channel_type: 0, parent_id: "900", position: 0 } },
  ]);
  assert.ok(calls.every((call) => call.method === "PUT" && call.path === "/100"));
});

test("channelUpdate skips a change the API does not store, such as the topic", async () => {
  const calls: IApiCall[] = [];
  await onGuildChannelUpdate(fakeChannel(), fakeChannel(), fakeDeps(calls));
  assert.deepEqual(calls, []);
});

test("channelUpdate ignores threads", async () => {
  const calls: IApiCall[] = [];
  const thread = fakeChannel({ thread: true, type: ChannelType.PublicThread });
  await onGuildChannelUpdate(thread, { ...thread, name: "renamed" }, fakeDeps(calls));
  assert.deepEqual(calls, []);
});

test("channelDelete DELETEs the channel", async () => {
  const calls: IApiCall[] = [];
  await onGuildChannelDelete(fakeChannel({ id: "102" }), fakeDeps(calls));
  assert.deepEqual(calls, [{ method: "DELETE", path: "/102" }]);
});

test("a failed write is logged, not thrown, so the event handler never rejects", async () => {
  const deps = fakeDeps([]);
  deps.api.remove = async () => { throw new Error("API down"); };
  const originalError = console.error;
  const logged: unknown[] = [];
  console.error = (...args: unknown[]) => { logged.push(args.join(" ")); };
  try {
    await onGuildChannelDelete(fakeChannel({ id: "103" }), deps);
  } finally {
    console.error = originalError;
  }
  assert.match(String(logged[0]), /Could not remove deleted channel 103: API down/);
});

function fakeClient(channels: unknown[], fetchedGuilds: string[] = []): any {
  return {
    guilds: {
      fetch: async (guildId: string) => {
        fetchedGuilds.push(guildId);
        return {
          channels: {
            fetch: async () => new Map(channels.map((channel, i) => [String(i), channel])),
          },
        };
      },
    },
  };
}

test("startup POSTs every home guild channel, categories included, as one snapshot", async () => {
  const calls: IApiCall[] = [];
  const fetchedGuilds: string[] = [];
  const client = fakeClient([
    fakeChannel({ id: "900", name: "Games", type: ChannelType.GuildCategory, parentId: null }),
    fakeChannel({ id: "100", name: "general" }),
    null,
    fakeChannel({ id: "200", name: "Voice", type: ChannelType.GuildVoice }),
  ], fetchedGuilds);
  await syncAllGuildChannels(client, fakeDeps(calls));
  assert.deepEqual(fetchedGuilds, [HOME]);
  assert.deepEqual(calls, [{
    method: "POST",
    path: "/sync",
    body: {
      data: [
        { channel_id: "900", name: "Games", channel_type: 4, parent_id: null, position: 3 },
        { channel_id: "100", name: "general", channel_type: 0, parent_id: "900", position: 3 },
        { channel_id: "200", name: "Voice", channel_type: 2, parent_id: "900", position: 3 },
      ],
    },
  }]);
});

test("startup sends nothing in test mode", async () => {
  const calls: IApiCall[] = [];
  await syncAllGuildChannels(fakeClient([fakeChannel()]), fakeDeps(calls, { testMode: true }));
  assert.deepEqual(calls, []);
});

test("a failed startup sync throws so the startup sequence reports the step", async () => {
  const deps = fakeDeps([]);
  deps.api.sync = async () => { throw new Error("422"); };
  await assert.rejects(
    syncAllGuildChannels(fakeClient([fakeChannel()]), deps),
    /Could not sync the guild channel list: 422/,
  );
});
