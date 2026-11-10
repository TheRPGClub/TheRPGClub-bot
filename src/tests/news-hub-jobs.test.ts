import assert from "node:assert/strict";
import test from "node:test";
import { SnowflakeUtil } from "discord.js";
import type { NewsCategoryKey, NewsPlaces } from "../config/newsHub.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import type { INewsMessage } from "../functions/NewsItem.js";
import {
  BOT_JOB_HANDLERS,
  handleNewsCatchUp,
  handleNewsImagesRenew,
  type IBotJobContext,
  type IBotJobSurface,
} from "../services/BotJobHandlers.js";
import type {
  INewsChannelReader,
  INewsHubApi,
  INewsHubJobDeps,
  IStoredNewsItem,
} from "../services/NewsHubJobs.js";
import type { NewsItemRecordBody } from "../services/NewsHubRecording.js";

// News Hub bot jobs (bot#1525): image renewal and the catch-up scan, with a fake API that
// keeps the recorded News Items and a fake Discord that pages the threads like Discord.

const START = Date.parse("2026-11-01T00:00:00.000Z");
const MINUTE = 60_000;

/** A snowflake made `minutes` after START, so IDs and posting times agree. */
function snowflake(minutes: number): string {
  return SnowflakeUtil.generate({ timestamp: START + minutes * MINUTE }).toString();
}

const RELEASES_THREAD = snowflake(0);
const INDUSTRY_THREAD = snowflake(1);
const ARCHIVE = snowflake(-100_000);
const OTHER_CHANNEL = snowflake(2);
const AUTHOR_ID = "710000000000000001";

const THREADS: NewsPlaces = new Map<string, NewsCategoryKey>([
  [RELEASES_THREAD, "releases"],
  [INDUSTRY_THREAD, "industry"],
]);

function imageUrl(name: string, expiresAt: string): string {
  const ex = Math.floor(Date.parse(expiresAt) / 1000).toString(16);
  return `https://cdn.discordapp.com/attachments/1/2/${name}?ex=${ex}&is=0&hm=sig`;
}

function message(
  id: string,
  channelId: string,
  overrides: Partial<INewsMessage> = {},
): INewsMessage {
  return {
    id,
    channelId,
    system: false,
    webhookId: null,
    author: { id: AUTHOR_ID, bot: false, username: "reporter", globalName: null },
    member: null,
    cleanContent: `News ${id} https://example.com/news/${id}`,
    createdAt: new Date(SnowflakeUtil.timestampFrom(id)),
    editedAt: null,
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
}

interface IStored extends IStoredNewsItem {
  category_key: NewsCategoryKey | null;
  body: NewsItemRecordBody["data"];
}

interface IFakeNewsApi extends INewsHubApi {
  store: Map<string, IStored>;
  writes: string[];
}

/** Keeps News Items like the API: PUT upserts (an imported item keeps origin and category). */
function fakeApi(seed: readonly IStored[] = []): IFakeNewsApi {
  const store = new Map(seed.map((item) => [item.message_id, item]));
  const writes: string[] = [];
  return {
    store,
    writes,
    record: async (messageId, body) => {
      writes.push(`record ${messageId}`);
      const existing = store.get(messageId);
      store.set(messageId, {
        message_id: messageId,
        origin: existing?.origin ?? "live",
        category_key: existing?.origin === "import"
          ? existing.category_key
          : body.data.category_key,
        posted_at: body.data.posted_at,
        body: body.data,
      });
    },
    remove: async (messageId) => {
      writes.push(`remove ${messageId}`);
      store.delete(messageId);
    },
    listCategory: async (categoryKey, page, per) => {
      const listed = [...store.values()]
        .filter((item) => item.category_key === categoryKey)
        .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
      const items = listed.slice((page - 1) * per, page * per)
        .map(({ message_id, origin, posted_at }) => ({ message_id, origin, posted_at }));
      return { items, nextPage: page * per < listed.length ? page + 1 : null };
    },
  };
}

interface IFakeDiscord extends INewsChannelReader {
  channels: Map<string, INewsMessage[]>;
  fetches: number;
}

/** Pages like Discord: newest `limit`, or the `limit` right after `after`; newest first. */
function fakeDiscord(channels: Record<string, INewsMessage[]> = {}): IFakeDiscord {
  const map = new Map(Object.entries(channels));
  const byId = (a: INewsMessage, b: INewsMessage): number =>
    a.id === b.id ? 0 : BigInt(a.id) < BigInt(b.id) ? -1 : 1;
  const discord: IFakeDiscord = {
    channels: map,
    fetches: 0,
    fetchMessage: async (channelId, messageId) => {
      discord.fetches += 1;
      return map.get(channelId)?.find((m) => m.id === messageId) ?? null;
    },
    fetchMessages: async (channelId, { limit, after }) => {
      discord.fetches += 1;
      const ascending = [...(map.get(channelId) ?? [])].sort(byId);
      const page = after === undefined
        ? ascending.slice(-limit)
        : ascending.filter((m) => BigInt(m.id) > BigInt(after)).slice(0, limit);
      return page.reverse();
    },
  };
  return discord;
}

function deps(
  api: INewsHubApi,
  discord: INewsChannelReader,
  state: FeatureState | null = "live",
): INewsHubJobDeps {
  return {
    categoryThreads: THREADS,
    archiveChannelId: ARCHIVE,
    api,
    discord,
    freshFeatureState: async () => state,
    recentWindow: 5,
  };
}

function surface(newsHub: INewsHubJobDeps): IBotJobSurface {
  return { newsHub, featureState: async () => "live" } as unknown as IBotJobSurface;
}

function context(state: FeatureState | null): IBotJobContext {
  return { feature: { key: "news_hub", state } };
}

function renewPayload(messageId: string, channelId: string): Record<string, unknown> {
  return { message_id: messageId, channel_id: channelId, feature_key: "news_hub" };
}

const FRESH_EXPIRY = "2026-11-12T08:00:00.000Z";

test("renewal: records the message again with fresh image addresses", async () => {
  const id = snowflake(10);
  const fresh = imageUrl("shot.png", FRESH_EXPIRY);
  const discord = fakeDiscord({
    [RELEASES_THREAD]: [message(id, RELEASES_THREAD, {
      cleanContent: "Look at this",
      attachments: new Map([["a", { url: fresh, contentType: "image/png", name: "shot.png" }]]),
    })],
  });
  const api = fakeApi();

  const text = await handleNewsImagesRenew(
    renewPayload(id, RELEASES_THREAD),
    surface(deps(api, discord)),
    context("live"),
  );

  const stored = api.store.get(id);
  assert.deepEqual(stored?.body.images, [{ url: fresh, expires_at: FRESH_EXPIRY }]);
  assert.equal(stored?.body.category_key, "releases");
  assert.match(String(text), /fresh/);
});

test("renewal: a message in the Game News Archive is recorded with no category", async () => {
  const id = snowflake(-50_000);
  const discord = fakeDiscord({ [ARCHIVE]: [message(id, ARCHIVE)] });
  const api = fakeApi();

  await handleNewsImagesRenew(
    renewPayload(id, ARCHIVE),
    surface(deps(api, discord)),
    context("live"),
  );

  assert.deepEqual(api.writes, [`record ${id}`]);
  assert.equal(api.store.get(id)?.body.category_key, null);
  assert.equal(api.store.get(id)?.body.channel_id, ARCHIVE);
});

test("renewal: removes the News Item when its message is gone", async () => {
  const id = snowflake(10);
  const api = fakeApi([{
    message_id: id,
    origin: "live",
    category_key: "releases",
    posted_at: new Date(SnowflakeUtil.timestampFrom(id)).toISOString(),
    body: {} as NewsItemRecordBody["data"],
  }]);

  const text = await handleNewsImagesRenew(
    renewPayload(id, RELEASES_THREAD),
    surface(deps(api, fakeDiscord({ [RELEASES_THREAD]: [] }))),
    context("live"),
  );

  assert.deepEqual(api.writes, [`remove ${id}`]);
  assert.equal(api.store.has(id), false);
  assert.match(String(text), /no longer exists/);
});

test("renewal: removes the News Item when its message no longer qualifies", async () => {
  const id = snowflake(10);
  const discord = fakeDiscord({
    [RELEASES_THREAD]: [message(id, RELEASES_THREAD, { cleanContent: "just words now" })],
  });
  const api = fakeApi();

  await handleNewsImagesRenew(
    renewPayload(id, RELEASES_THREAD),
    surface(deps(api, discord)),
    context("live"),
  );

  assert.deepEqual(api.writes, [`remove ${id}`]);
});

test("renewal: does nothing while the News Hub is Off", async () => {
  const id = snowflake(10);
  const discord = fakeDiscord({ [RELEASES_THREAD]: [message(id, RELEASES_THREAD)] });
  const api = fakeApi();

  const text = await handleNewsImagesRenew(
    renewPayload(id, RELEASES_THREAD),
    surface(deps(api, discord)),
    context("off"),
  );

  assert.deepEqual(api.writes, []);
  assert.equal(discord.fetches, 0);
  assert.match(String(text), /Off/);
});

test("renewal: a channel that is no News place fails and changes nothing", async () => {
  const id = snowflake(10);
  const discord = fakeDiscord({ [OTHER_CHANNEL]: [message(id, OTHER_CHANNEL)] });
  const api = fakeApi();

  await assert.rejects(
    handleNewsImagesRenew(
      renewPayload(id, OTHER_CHANNEL),
      surface(deps(api, discord)),
      context("live"),
    ),
    /neither a News Category thread nor the Game News Archive/,
  );
  assert.deepEqual(api.writes, []);
});

test("both News Hub job kinds are registered", () => {
  assert.equal(typeof BOT_JOB_HANDLERS.news_images_renew, "function");
  assert.equal(typeof BOT_JOB_HANDLERS.news_catch_up, "function");
});

// Catch-up scan.

/** A stored live News Item recorded from `msg`, as the bot would have recorded it. */
function recorded(msg: INewsMessage, category: NewsCategoryKey): IStored {
  return {
    message_id: msg.id,
    origin: "live",
    category_key: category,
    posted_at: msg.createdAt.toISOString(),
    body: { comment: msg.cleanContent } as NewsItemRecordBody["data"],
  };
}

/** `count` news messages in `threadId`, a minute apart from `fromMinute`. */
function thread(threadId: string, fromMinute: number, count: number): INewsMessage[] {
  return Array.from({ length: count }, (_, i) => message(snowflake(fromMinute + i), threadId));
}

function catchUpPayload(): Record<string, unknown> {
  return { from_state: "off", to_state: "preview", feature_key: "news_hub" };
}

async function catchUp(
  api: INewsHubApi,
  discord: INewsChannelReader,
  state: FeatureState | null = "live",
): Promise<string> {
  return String(await handleNewsCatchUp(
    catchUpPayload(),
    surface(deps(api, discord, state)),
    context(state),
  ));
}

function storedIds(api: IFakeNewsApi): string[] {
  return [...api.store.keys()].sort();
}

function ids(messages: readonly INewsMessage[]): string[] {
  return messages.map((m) => m.id).sort();
}

test("catch-up: records the messages a thread gained while the bot was down", async () => {
  const releases = thread(RELEASES_THREAD, 10, 12);
  const api = fakeApi(releases.slice(0, 3).map((m) => recorded(m, "releases")));
  const discord = fakeDiscord({ [RELEASES_THREAD]: releases, [INDUSTRY_THREAD]: [] });

  const text = await catchUp(api, discord);

  assert.deepEqual(storedIds(api), ids(releases));
  assert.equal(api.store.get(releases[5].id)?.category_key, "releases");
  assert.match(text, /9 missed/);
});

test("catch-up: pages a long gap forward past Discord's 100-message pages", async () => {
  const releases = thread(RELEASES_THREAD, 10, 260);
  const api = fakeApi([recorded(releases[0], "releases")]);
  const discord = fakeDiscord({ [RELEASES_THREAD]: releases });

  await catchUp(api, discord);

  assert.deepEqual(storedIds(api), ids(releases));
});

test("catch-up: a thread nobody recorded yet is scanned from its start", async () => {
  const releases = thread(RELEASES_THREAD, 10, 8);
  const api = fakeApi();

  await catchUp(api, fakeDiscord({ [RELEASES_THREAD]: releases }));

  assert.deepEqual(storedIds(api), ids(releases));
});

test("catch-up: a thread with nothing new keeps what it has and removes nothing", async () => {
  const releases = thread(RELEASES_THREAD, 10, 8);
  const api = fakeApi(releases.map((m) => recorded(m, "releases")));

  const text = await catchUp(api, fakeDiscord({ [RELEASES_THREAD]: releases }));

  assert.deepEqual(storedIds(api), ids(releases));
  assert.equal(api.writes.some((write) => write.startsWith("remove")), false);
  assert.match(text, /0 missed/);
});

test("catch-up: a message edited while the bot was down is recorded as it is now", async () => {
  const releases = thread(RELEASES_THREAD, 10, 8);
  const api = fakeApi(releases.map((m) => recorded(m, "releases")));
  const edited = releases[6];
  releases[6] = {
    ...edited,
    cleanContent: "Corrected https://example.com/fixed",
    editedAt: new Date(START + 999 * MINUTE),
  };

  await catchUp(api, fakeDiscord({ [RELEASES_THREAD]: releases }));

  const stored = api.store.get(edited.id)?.body;
  assert.equal(stored?.comment, "Corrected");
  assert.equal(stored?.link?.url, "https://example.com/fixed");
  assert.equal(stored?.edited_at, new Date(START + 999 * MINUTE).toISOString());
});

test("catch-up: a message deleted while the bot was down loses its News Item", async () => {
  const releases = thread(RELEASES_THREAD, 10, 8);
  const api = fakeApi(releases.map((m) => recorded(m, "releases")));
  const [deleted] = releases.splice(5, 1);

  const text = await catchUp(api, fakeDiscord({ [RELEASES_THREAD]: releases }));

  assert.equal(api.store.has(deleted.id), false);
  assert.deepEqual(storedIds(api), ids(releases));
  assert.match(text, /1 removed/);
});

test("catch-up: a message whose link was edited away loses its News Item", async () => {
  const releases = thread(RELEASES_THREAD, 10, 8);
  const api = fakeApi(releases.map((m) => recorded(m, "releases")));
  releases[7] = { ...releases[7], cleanContent: "never mind" };

  await catchUp(api, fakeDiscord({ [RELEASES_THREAD]: releases }));

  assert.equal(api.store.has(releases[7].id), false);
});

test("catch-up: a short thread is checked whole, so an old deletion is applied", async () => {
  const releases = thread(RELEASES_THREAD, 10, 4);
  const api = fakeApi(releases.map((m) => recorded(m, "releases")));
  const [deleted] = releases.splice(0, 1);

  await catchUp(api, fakeDiscord({ [RELEASES_THREAD]: releases }));

  assert.equal(api.store.has(deleted.id), false);
});

test("catch-up: imported items sorted into the category are left alone", async () => {
  const releases = thread(RELEASES_THREAD, 10, 12);
  const imported: IStored = {
    message_id: snowflake(-50_000),
    origin: "import",
    category_key: "releases",
    // Posted in the archive after the thread's newest recorded message.
    posted_at: new Date(START + 15 * MINUTE).toISOString(),
    body: {} as NewsItemRecordBody["data"],
  };
  const api = fakeApi([...releases.slice(0, 3).map((m) => recorded(m, "releases")), imported]);

  await catchUp(api, fakeDiscord({ [RELEASES_THREAD]: releases }));

  assert.deepEqual(storedIds(api), [...ids(releases), imported.message_id].sort());
});

test("catch-up: covers every category thread", async () => {
  const releases = thread(RELEASES_THREAD, 10, 3);
  const industry = thread(INDUSTRY_THREAD, 20, 3);
  const api = fakeApi();

  await catchUp(api, fakeDiscord({ [RELEASES_THREAD]: releases, [INDUSTRY_THREAD]: industry }));

  assert.deepEqual(storedIds(api), ids([...releases, ...industry]));
  assert.equal(api.store.get(industry[0].id)?.category_key, "industry");
});

test("catch-up: is safe to run twice in a row", async () => {
  const releases = thread(RELEASES_THREAD, 10, 12);
  const api = fakeApi(releases.slice(0, 2).map((m) => recorded(m, "releases")));
  releases.splice(9, 1);
  const discord = fakeDiscord({ [RELEASES_THREAD]: releases });

  await catchUp(api, discord);
  const afterFirst = [...api.store.values()];
  const text = await catchUp(api, discord);

  assert.deepEqual([...api.store.values()], afterFirst);
  assert.deepEqual(storedIds(api), ids(releases));
  assert.match(text, /0 missed/);
  assert.match(text, /0 removed/);
});

test("catch-up: does nothing while the News Hub is Off", async () => {
  const releases = thread(RELEASES_THREAD, 10, 4);
  const api = fakeApi();
  const discord = fakeDiscord({ [RELEASES_THREAD]: releases });

  const text = await catchUp(api, discord, "off");

  assert.deepEqual(api.writes, []);
  assert.equal(discord.fetches, 0);
  assert.match(text, /Off/);
});

test("catch-up: reads the News Hub's state afresh, not the job's cached state", async () => {
  const releases = thread(RELEASES_THREAD, 10, 2);
  const api = fakeApi();
  const discord = fakeDiscord({ [RELEASES_THREAD]: releases });

  // The flag cache still said Off when the job was dispatched; the API says Preview.
  await handleNewsCatchUp(catchUpPayload(), surface(deps(api, discord, "preview")), context("off"));

  assert.deepEqual(storedIds(api), ids(releases));
});

test("catch-up: a thread that cannot be read fails the job after the others", async () => {
  const industry = thread(INDUSTRY_THREAD, 20, 2);
  const api = fakeApi();
  const discord = fakeDiscord({ [INDUSTRY_THREAD]: industry });
  const fetchMessages = discord.fetchMessages;
  discord.fetchMessages = async (channelId, options) => {
    if (channelId === RELEASES_THREAD) throw new Error("Missing Access");
    return fetchMessages(channelId, options);
  };

  await assert.rejects(
    handleNewsCatchUp(catchUpPayload(), surface(deps(api, discord)), context("live")),
    /releases thread .*Missing Access/s,
  );
  assert.deepEqual(storedIds(api), ids(industry));
});
