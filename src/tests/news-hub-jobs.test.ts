import assert from "node:assert/strict";
import test from "node:test";
import { SnowflakeUtil } from "discord.js";
import type { NewsCategoryKey, NewsCategoryThreads, NewsPlaces } from "../config/newsHub.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import type { INewsCopyMessage } from "../functions/NewsCopy.js";
import {
  BOT_JOB_HANDLERS,
  handleNewsCatchUp,
  handleNewsImagesRenew,
  type IBotJobContext,
  type IBotJobSurface,
} from "../services/BotJobHandlers.js";
import { NewsCopyLane } from "../services/NewsCopyLane.js";
import type { INewsPost } from "../services/NewsCopying.js";
import { NewsHistoryCopyRunner } from "../services/NewsHistoryCopy.js";
import type { INewsSyncDiscord } from "../services/NewsCopySync.js";
import type {
  INewsChannelReader,
  INewsHubApi,
  INewsHubJobDeps,
} from "../services/NewsHubJobs.js";
import type {
  INewsCopyLocation,
  IUncopiedNewsItem,
  NewsItemRecordBody,
} from "../services/NewsItemApi.js";

// News Hub bot jobs: image renewal (bot#1525) and the News Channel catch-up (bot#1540), with
// a fake API that keeps the recorded News Items and their News Copies, and a fake Discord
// that pages the News Channel like Discord and posts copies.

const START = Date.parse("2026-11-01T00:00:00.000Z");
const MINUTE = 60_000;

/** A snowflake made `minutes` after START, so IDs and posting times agree. */
function snowflake(minutes: number): string {
  return SnowflakeUtil.generate({ timestamp: START + minutes * MINUTE }).toString();
}

const RELEASES_THREAD = snowflake(0);
const NEWS_CHANNEL = snowflake(-100_000);
const OTHER_CHANNEL = snowflake(2);
const AUTHOR_ID = "710000000000000001";
/**
 * When live filing took over (the bot came back, or the News Hub left Off): after every
 * message the tests post, unless they say otherwise.
 */
const CATCH_UP_AT = START + 100_000 * MINUTE;

const THREADS: NewsPlaces = new Map<string, NewsCategoryKey>([[RELEASES_THREAD, "releases"]]);

const COPY_THREADS: NewsCategoryThreads = {
  announcements: { threadId: "520000000000000001", emoji: "📣" },
  releases: { threadId: "520000000000000002", emoji: "📦" },
  emulation: { threadId: "520000000000000003", emoji: "🕹️" },
  industry: { threadId: "520000000000000004", emoji: "🏢" },
  hardware: { threadId: "520000000000000005", emoji: "🖥️" },
  rumours: { threadId: "520000000000000006", emoji: "🤫" },
  general: { threadId: "520000000000000007", emoji: "📰" },
};

function imageUrl(name: string, expiresAt: string): string {
  const ex = Math.floor(Date.parse(expiresAt) / 1000).toString(16);
  return `https://cdn.discordapp.com/attachments/1/2/${name}?ex=${ex}&is=0&hm=sig`;
}

function message(
  id: string,
  channelId: string,
  overrides: Partial<INewsPost> = {},
): INewsPost {
  return {
    id,
    channelId,
    url: `https://discord.com/channels/100/${channelId}/${id}`,
    system: false,
    webhookId: null,
    author: { id: AUTHOR_ID, bot: false, username: "reporter", globalName: null },
    member: null,
    cleanContent: `New patch ${id} https://example.com/news/${id}`,
    createdAt: new Date(SnowflakeUtil.timestampFrom(id)),
    editedAt: null,
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
}

interface IStored {
  message_id: string;
  origin: "live" | "import";
  category_key: NewsCategoryKey | null;
  posted_at: string;
  news_copy: INewsCopyLocation | null;
  body: Partial<NewsItemRecordBody["data"]>;
}

interface IFakeNewsApi extends INewsHubApi {
  store: Map<string, IStored>;
  writes: string[];
  /** The `origin` each uncopied listing read asked for (null: both). */
  listedOrigins: (string | null)[];
}

const byPostedAt = (a: IStored, b: IStored): number =>
  Date.parse(a.posted_at) - Date.parse(b.posted_at);

/**
 * Keeps News Items like the API: PUT upserts (an imported item keeps origin and category;
 * a missing category keeps the stored one); the copy-only PUT stores the copy.
 */
function fakeApi(seed: readonly IStored[] = []): IFakeNewsApi {
  const store = new Map(seed.map((item) => [item.message_id, item]));
  const writes: string[] = [];
  const api: IFakeNewsApi = {
    store,
    writes,
    listedOrigins: [],
    record: async (messageId, body) => {
      writes.push(`record ${messageId}`);
      const existing = store.get(messageId);
      store.set(messageId, {
        message_id: messageId,
        origin: existing?.origin ?? "live",
        category_key: existing?.origin === "import"
          ? existing.category_key
          : body.data.category_key ?? existing?.category_key ?? null,
        posted_at: body.data.posted_at,
        news_copy: existing?.news_copy ?? null,
        body: body.data,
      });
    },
    remove: async (messageId) => {
      writes.push(`remove ${messageId}`);
      const known = store.get(messageId);
      store.delete(messageId);
      return { removed: known !== undefined, newsCopy: known?.news_copy ?? null };
    },
    reportCopy: async (messageId, copy) => {
      writes.push(`reportCopy ${messageId}`);
      const existing = store.get(messageId);
      if (!existing) throw new Error(`404 PUT /api/v1/news_items/${messageId}`);
      existing.news_copy = copy;
    },
    find: async (messageId) => {
      const found = store.get(messageId);
      if (!found || found.category_key === null) return null;
      const { message_id, origin, posted_at, news_copy } = found;
      return { message_id, origin, posted_at, news_copy };
    },
    listRecent: async (page, per) => {
      const listed = [...store.values()]
        .filter((item) => item.category_key !== null)
        .sort((a, b) => byPostedAt(b, a));
      const items = listed.slice((page - 1) * per, page * per)
        .map(({ message_id, origin, posted_at }) => ({ message_id, origin, posted_at }));
      return { items, nextPage: page * per < listed.length ? page + 1 : null };
    },
    uncopied: async (page, per, origin) => {
      if (!api.listedOrigins.includes(origin ?? null)) api.listedOrigins.push(origin ?? null);
      const listed = [...store.values()]
        .filter((item) => item.category_key !== null && item.news_copy === null)
        .filter((item) => !origin || item.origin === origin)
        .sort(byPostedAt);
      const items: IUncopiedNewsItem[] = listed.slice((page - 1) * per, page * per)
        .map(({ message_id, origin, posted_at, category_key, body }) => ({
          message_id,
          origin,
          posted_at,
          category_key: category_key as NewsCategoryKey,
          comment: body.comment ?? null,
          link: body.link ? { url: body.link.url } : null,
          author: { user_id: AUTHOR_ID },
        }));
      const next = page * per < listed.length ? page + 1 : null;
      return { items, count: listed.length, next };
    },
  };
  return api;
}

interface IFakeDiscord extends INewsChannelReader, INewsSyncDiscord {
  channels: Map<string, INewsPost[]>;
  fetches: number;
  /** Writes, in order: reactions, posted copies and deletes. */
  calls: string[];
  posted: { threadId: string; copy: INewsCopyMessage }[];
}

/** Pages like Discord: newest `limit`, or the `limit` right after `after`; newest first. */
function fakeDiscord(channels: Record<string, INewsPost[]> = {}): IFakeDiscord {
  const map = new Map(Object.entries(channels));
  const byId = (a: INewsPost, b: INewsPost): number =>
    a.id === b.id ? 0 : BigInt(a.id) < BigInt(b.id) ? -1 : 1;
  let nextCopy = 0;
  const discord: IFakeDiscord = {
    channels: map,
    fetches: 0,
    calls: [],
    posted: [],
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
    react: async (_channelId, messageId, emoji) => {
      discord.calls.push(`react ${messageId} ${emoji}`);
    },
    postCopy: async (threadId, copy) => {
      nextCopy += 1;
      discord.posted.push({ threadId, copy });
      discord.calls.push(`post ${threadId}`);
      return { messageId: `9${String(nextCopy).padStart(17, "0")}` };
    },
    deleteMessage: async (_channelId, messageId) => {
      discord.calls.push(`delete ${messageId}`);
    },
    editCopy: async (_threadId, messageId) => {
      discord.calls.push(`edit ${messageId}`);
    },
  };
  return discord;
}

interface IDepOptions {
  state?: FeatureState | null;
  /** The cached flag state, read before each item (defaults to `state`). */
  cachedState?: () => FeatureState | null;
  lane?: NewsCopyLane;
  liveSince?: number;
  filing?: Map<string, null>;
  paced?: string[];
}

function deps(
  api: INewsHubApi,
  discord: IFakeDiscord,
  options: IDepOptions = {},
): INewsHubJobDeps {
  const state = options.state === undefined ? "live" : options.state;
  return {
    categoryThreads: THREADS,
    archiveChannelId: NEWS_CHANNEL,
    api,
    discord,
    freshFeatureState: async () => state,
    recording: {
      testMode: false,
      places: new Map([[NEWS_CHANNEL, null]]),
      threads: COPY_THREADS,
      featureState: async () => options.cachedState?.() ?? state,
      api,
      discord,
      // A live post's wait; catch-up must not use it for old messages.
      waitForPreview: () => new Promise<INewsPost>(() => undefined),
      filing: options.filing ?? new Map(),
    },
    lane: options.lane ?? new NewsCopyLane(),
    liveSince: () => options.liveSince ?? CATCH_UP_AT,
    pace: async () => {
      options.paced?.push("pace");
    },
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

test("renewal: a News Channel message is recorded with no category, keeping its own", async () => {
  const id = snowflake(-50_000);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: [message(id, NEWS_CHANNEL)] });
  const api = fakeApi();

  await handleNewsImagesRenew(
    renewPayload(id, NEWS_CHANNEL),
    surface(deps(api, discord)),
    context("live"),
  );

  assert.deepEqual(api.writes, [`record ${id}`]);
  assert.equal("category_key" in (api.store.get(id)?.body ?? {}), false);
  assert.equal(api.store.get(id)?.body.channel_id, NEWS_CHANNEL);
});

test("renewal: removes the News Item when its message is gone", async () => {
  const id = snowflake(10);
  const api = fakeApi([{
    message_id: id,
    origin: "live",
    category_key: "releases",
    posted_at: new Date(SnowflakeUtil.timestampFrom(id)).toISOString(),
    news_copy: null,
    body: {},
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

test("renewal: a removed item's News Copy is deleted where the removal says it lived", async () => {
  const id = snowflake(10);
  const copy = { message_id: "990000000000000001", thread_id: COPY_THREADS.releases.threadId };
  const api = fakeApi([{
    message_id: id,
    origin: "live",
    category_key: "releases",
    posted_at: new Date(SnowflakeUtil.timestampFrom(id)).toISOString(),
    news_copy: copy,
    body: {},
  }]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: [] });

  const text = await handleNewsImagesRenew(
    renewPayload(id, NEWS_CHANNEL),
    surface(deps(api, discord)),
    context("live"),
  );

  assert.deepEqual(api.writes, [`remove ${id}`]);
  assert.deepEqual(discord.calls, [`delete ${copy.message_id}`]);
  assert.match(String(text), /News Copy/);
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

// Catch-up.

/** A News Item recorded from `msg` with a category, copied or not. */
function recorded(
  msg: INewsPost,
  category: NewsCategoryKey,
  copy: INewsCopyLocation | null = { message_id: "800000000000000001", thread_id: "1" },
  origin: "live" | "import" = "live",
): IStored {
  return {
    message_id: msg.id,
    origin,
    category_key: category,
    posted_at: msg.createdAt.toISOString(),
    news_copy: copy,
    body: { comment: msg.cleanContent },
  };
}

/** `count` news messages in the News Channel, a minute apart from `fromMinute`. */
function posts(fromMinute: number, count: number): INewsPost[] {
  return Array.from({ length: count }, (_, i) => message(snowflake(fromMinute + i), NEWS_CHANNEL));
}

function catchUpPayload(): Record<string, unknown> {
  return { from_state: "off", to_state: "preview", feature_key: "news_hub" };
}

async function catchUp(
  api: INewsHubApi,
  discord: IFakeDiscord,
  options: IDepOptions = {},
): Promise<string> {
  const state = options.state === undefined ? "live" : options.state;
  return String(await handleNewsCatchUp(
    catchUpPayload(),
    surface(deps(api, discord, options)),
    context(state),
  ));
}

function ids(messages: readonly INewsPost[]): string[] {
  return messages.map((m) => m.id);
}

/** The original message each posted copy links back to, in posting order. */
function copiedIds(discord: IFakeDiscord): string[] {
  return discord.posted.map(({ copy }) => /\/(\d+)$/.exec(copy.content)?.[1] ?? "?");
}

test("catch-up: posts missed while the bot was away are recorded, reacted to and copied", async () => {
  const channel = posts(10, 5);
  const api = fakeApi(channel.slice(0, 2).map((m) => recorded(m, "releases")));
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  const text = await catchUp(api, discord);

  const missed = channel.slice(2);
  for (const m of missed) {
    assert.equal(api.store.get(m.id)?.category_key, "releases");
    assert.equal(api.store.get(m.id)?.body.picked_category_key, "releases");
    assert.equal(api.store.get(m.id)?.news_copy?.thread_id, COPY_THREADS.releases.threadId);
  }
  assert.deepEqual(
    discord.calls.filter((call) => call.startsWith("react")),
    missed.map((m) => `react ${m.id} 📦`),
  );
  assert.deepEqual(copiedIds(discord), ids(missed));
  assert.match(text, /3 missed/);
  assert.match(text, /3 News Copies posted/);
});

test("catch-up: does not wait for link previews on old messages", async () => {
  // The fake recording's preview wait never ends; a waiting catch-up would hang here.
  const channel = posts(10, 2);
  const api = fakeApi([recorded(channel[0], "releases")]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  await catchUp(api, discord);

  assert.equal(api.store.has(channel[1].id), true);
});

test("catch-up: pages a long gap forward past Discord's 100-message pages", async () => {
  const channel = posts(10, 260);
  const api = fakeApi([recorded(channel[0], "releases")]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  await catchUp(api, discord);

  assert.deepEqual([...api.store.keys()].sort(), ids(channel));
});

test("catch-up: chat and messages before the newest recorded item are left alone", async () => {
  const channel = posts(10, 4);
  channel.push(message(snowflake(20), NEWS_CHANNEL, { cleanContent: "just chatting" }));
  const api = fakeApi([recorded(channel[2], "releases")]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  await catchUp(api, discord);

  assert.deepEqual([...api.store.keys()].sort(), [channel[2].id, channel[3].id]);
  assert.deepEqual(discord.calls.filter((call) => call.startsWith("react")), [
    `react ${channel[3].id} 📦`,
  ]);
});

test("catch-up: with nothing recorded yet, the News Channel's history is not filed", async () => {
  const channel = posts(10, 3);
  const api = fakeApi();
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  await catchUp(api, discord);

  assert.deepEqual(api.writes, []);
  assert.deepEqual(discord.calls, []);
});

test("catch-up: items without a News Copy are copied oldest first", async () => {
  const channel = posts(10, 4);
  const api = fakeApi([
    recorded(channel[3], "industry", null),
    recorded(channel[1], "releases", null),
    recorded(channel[0], "releases"),
    recorded(channel[2], "general", null),
  ]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  const text = await catchUp(api, discord);

  assert.deepEqual(copiedIds(discord), [channel[1].id, channel[2].id, channel[3].id]);
  assert.deepEqual(discord.posted.map(({ threadId }) => threadId), [
    COPY_THREADS.releases.threadId,
    COPY_THREADS.general.threadId,
    COPY_THREADS.industry.threadId,
  ]);
  for (const m of channel) assert.notEqual(api.store.get(m.id)?.news_copy, null);
  assert.equal(discord.calls.some((call) => call.startsWith("react")), false);
  assert.match(text, /3 News Copies posted/);
});

test("catch-up: copies live items only, leaving imported ones to the history copy", async () => {
  const old = message(snowflake(-90_000), NEWS_CHANNEL);
  const live = message(snowflake(10), NEWS_CHANNEL);
  const api = fakeApi([
    recorded(old, "emulation", null, "import"),
    recorded(live, "releases", null),
  ]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: [old, live] });

  const text = await catchUp(api, discord);

  assert.deepEqual(copiedIds(discord), [live.id]);
  assert.deepEqual(api.listedOrigins, ["live"]);
  assert.equal(api.store.get(old.id)?.news_copy, null);
  assert.match(text, /1 News Copy posted/);
});

test("catch-up: copies are paced, one wait after each", async () => {
  const channel = posts(10, 3);
  const api = fakeApi(channel.map((m) => recorded(m, "releases", null)));
  const paced: string[] = [];

  await catchUp(api, fakeDiscord({ [NEWS_CHANNEL]: channel }), { paced });

  assert.equal(paced.length, 3);
});

test("catch-up: a copy that fails is tried once and the others still go", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const channel = posts(10, 3);
  const api = fakeApi(channel.map((m) => recorded(m, "releases", null)));
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });
  const post = discord.postCopy;
  let failed = 0;
  discord.postCopy = async (threadId, copy) => {
    if (copy.content.endsWith(channel[0].id)) {
      failed += 1;
      throw new Error("Request entity too large");
    }
    return post(threadId, copy);
  };

  const text = await catchUp(api, discord);

  assert.equal(failed, 1);
  assert.deepEqual(copiedIds(discord), [channel[1].id, channel[2].id]);
  assert.equal(api.store.get(channel[0].id)?.news_copy, null);
  assert.match(text, /2 News Copies posted, 1 could not be/);
});

test("catch-up: many failing copies do not stop the ones after them", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const channel = posts(10, 120);
  const api = fakeApi(channel.map((m) => recorded(m, "releases", null)));
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });
  const post = discord.postCopy;
  const failing = new Set(ids(channel.slice(0, 110)));
  discord.postCopy = async (threadId, copy) => {
    if (failing.has(/\/(\d+)$/.exec(copy.content)?.[1] ?? "")) throw new Error("Missing Access");
    return post(threadId, copy);
  };

  await catchUp(api, discord);

  assert.deepEqual(copiedIds(discord), ids(channel.slice(110)));
});

test("catch-up: an item whose message is gone or no longer news is skipped", async () => {
  const channel = posts(10, 3);
  const api = fakeApi(channel.map((m) => recorded(m, "releases", null)));
  const [gone] = channel.splice(0, 1);
  channel[0] = { ...channel[0], cleanContent: "never mind" };
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  const text = await catchUp(api, discord);

  assert.deepEqual(copiedIds(discord), [channel[1].id]);
  assert.equal(api.store.get(gone.id)?.news_copy, null);
  assert.match(text, /2 skipped/);
});

test("catch-up: posts no copies while a history copy runs", async () => {
  const channel = posts(10, 4);
  const api = fakeApi([recorded(channel[0], "releases"), recorded(channel[1], "releases", null)]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  const lane = new NewsCopyLane();
  await lane.holdForHistory();
  const text = await catchUp(api, discord, { lane });

  assert.deepEqual(discord.posted, []);
  // Missed posts are still recorded and reacted to; the history copy copies them later.
  assert.equal(api.store.get(channel[3].id)?.news_copy, null);
  assert.deepEqual(discord.calls, [`react ${channel[2].id} 📦`, `react ${channel[3].id} 📦`]);
  assert.match(text, /history copy/);
});

test("catch-up: a history copy started meanwhile takes over after the current item", async () => {
  const channel = posts(10, 4);
  const imported = message(snowflake(-90_000), NEWS_CHANNEL);
  const api = fakeApi([
    recorded(imported, "emulation", null, "import"),
    ...channel.map((m) => recorded(m, "releases", null)),
  ]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: [imported, ...channel] });
  const lane = new NewsCopyLane();
  const runner = new NewsHistoryCopyRunner(lane);
  const catchUpDeps = deps(api, discord, { lane });
  let history: Promise<unknown> | null = null;
  const startsHistory: INewsHubJobDeps = {
    ...catchUpDeps,
    pace: async () => {
      history ??= runner.start("staff", new Date(), {
        threads: COPY_THREADS,
        api,
        discord,
        listing: api,
        originals: {
          fetch: async (id) => (await discord.fetchMessage(NEWS_CHANNEL, id)) as INewsPost,
        },
        sleep: async () => undefined,
      });
    },
  };

  const text = String(await handleNewsCatchUp(
    catchUpPayload(),
    surface(startsHistory),
    context("live"),
  ));
  await history;

  // Catch-up posted one copy; the history copy posted the rest, the import first.
  assert.deepEqual(copiedIds(discord), [channel[0].id, imported.id, ...ids(channel.slice(1))]);
  assert.match(text, /1 News Copy posted/);
  assert.match(text, /history copy/);
});

test("catch-up: a second catch-up while one runs does nothing", async () => {
  const channel = posts(10, 2);
  const api = fakeApi(channel.map((m) => recorded(m, "releases", null)));
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });
  const lane = new NewsCopyLane();
  let second: string | null = null;
  const nested: INewsHubJobDeps = {
    ...deps(api, discord, { lane }),
    pace: async () => {
      second ??= String(await handleNewsCatchUp(
        catchUpPayload(),
        surface(deps(api, discord, { lane })),
        context("live"),
      ));
    },
  };

  await handleNewsCatchUp(catchUpPayload(), surface(nested), context("live"));

  assert.deepEqual(copiedIds(discord), ids(channel));
  assert.match(second ?? "", /already running/);
});

test("catch-up: posts from when live filing took over are left to it", async () => {
  const channel = posts(10, 4);
  const api = fakeApi([recorded(channel[0], "releases"), recorded(channel[3], "releases", null)]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  // Live filing took over between the second and third post.
  await catchUp(api, discord, { liveSince: START + 11.5 * MINUTE });

  assert.deepEqual([...api.store.keys()].sort(), ids(channel).filter((_, i) => i !== 2));
  assert.deepEqual(copiedIds(discord), [channel[1].id]);
});

test("catch-up: a post filed live since the bot came back does not hide missed ones", async () => {
  const channel = posts(10, 4);
  const api = fakeApi([recorded(channel[0], "releases"), recorded(channel[3], "releases")]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  await catchUp(api, discord, { liveSince: START + 12.5 * MINUTE });

  assert.deepEqual(copiedIds(discord), [channel[1].id, channel[2].id]);
});

test("catch-up: a message the live listener is filing is left to it", async () => {
  const channel = posts(10, 3);
  const api = fakeApi([recorded(channel[0], "releases"), recorded(channel[1], "releases", null)]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });
  const filing = new Map<string, null>([[channel[1].id, null], [channel[2].id, null]]);

  await catchUp(api, discord, { filing });

  assert.equal(api.store.has(channel[2].id), false);
  assert.deepEqual(discord.posted, []);
});

test("catch-up: is safe to run twice in a row", async () => {
  const channel = posts(10, 6);
  const api = fakeApi(channel.slice(0, 2).map((m) => recorded(m, "releases", null)));
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  await catchUp(api, discord);
  const text = await catchUp(api, discord);

  assert.deepEqual(copiedIds(discord), ids(channel));
  assert.match(text, /0 missed/);
  assert.match(text, /0 News Copies posted/);
});

test("catch-up: does nothing while the News Hub is Off", async () => {
  const channel = posts(10, 4);
  const api = fakeApi([recorded(channel[0], "releases", null)]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  const text = await catchUp(api, discord, { state: "off" });

  assert.deepEqual(api.writes, []);
  assert.equal(discord.fetches, 0);
  assert.deepEqual(discord.calls, []);
  assert.match(text, /Off/);
});

test("catch-up: switching the News Hub Off stops the copies before the next item", async () => {
  const channel = posts(10, 3);
  const api = fakeApi(channel.map((m) => recorded(m, "releases", null)));
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });
  let state: FeatureState = "live";
  const paced: string[] = [];
  const pacing = deps(api, discord, { cachedState: () => state, paced });
  const switchingOff: INewsHubJobDeps = {
    ...pacing,
    pace: async () => {
      state = "off";
    },
  };

  const text = String(await handleNewsCatchUp(
    catchUpPayload(),
    surface(switchingOff),
    context("live"),
  ));

  assert.deepEqual(copiedIds(discord), [channel[0].id]);
  assert.match(text, /switched Off/);
});

test("catch-up: switching the News Hub Off stops filing missed posts", async () => {
  const channel = posts(10, 4);
  const api = fakeApi([recorded(channel[0], "releases")]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });
  let state: FeatureState = "live";
  const recordOnce: INewsHubApi = {
    ...api,
    record: async (messageId, body) => {
      await api.record(messageId, body);
      state = "off";
    },
  };

  await catchUp(recordOnce, discord, { cachedState: () => state });

  assert.equal(api.store.has(channel[1].id), true);
  assert.equal(api.store.has(channel[2].id), false);
  assert.equal(api.store.has(channel[3].id), false);
});

test("catch-up: reads the News Hub's state afresh, not the job's cached state", async () => {
  const channel = posts(10, 2);
  const api = fakeApi([recorded(channel[0], "releases")]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });

  // The flag cache still said Off when the job was dispatched; the API says Preview.
  await handleNewsCatchUp(
    catchUpPayload(),
    surface(deps(api, discord, { state: "preview" })),
    context("off"),
  );

  assert.equal(api.store.has(channel[1].id), true);
});

test("catch-up: a News Channel that cannot be read fails the job after the copies", async () => {
  const channel = posts(10, 2);
  const api = fakeApi([recorded(channel[0], "releases", null)]);
  const discord = fakeDiscord({ [NEWS_CHANNEL]: channel });
  discord.fetchMessages = async () => {
    throw new Error("Missing Access");
  };

  await assert.rejects(
    handleNewsCatchUp(catchUpPayload(), surface(deps(api, discord)), context("live")),
    /News Channel.*Missing Access/s,
  );
  assert.deepEqual(copiedIds(discord), [channel[0].id]);
});
