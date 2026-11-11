import assert from "node:assert/strict";
import test from "node:test";
import type { NewsCategoryKey, NewsCategoryThreads } from "../config/newsHub.js";
import type { INewsCopyMessage } from "../functions/NewsCopy.js";
import type { INewsCopyDiscord, INewsPost } from "../services/NewsCopying.js";
import {
  copyNewsHistory,
  NewsHistoryCopyRunner,
  type INewsHistoryCopyDeps,
} from "../services/NewsHistoryCopy.js";
import type {
  INewsCopyLocation,
  INewsFilingApi,
  IUncopiedNewsItem,
  IUncopiedNewsPage,
} from "../services/NewsItemApi.js";

const NEWS_CHANNEL = "511000000000000001";
const AUTHOR_ID = "711000000000000001";

const THREADS: NewsCategoryThreads = {
  announcements: { threadId: "521000000000000001", emoji: "📣" },
  releases: { threadId: "521000000000000002", emoji: "📦" },
  emulation: { threadId: "521000000000000003", emoji: "🕹️" },
  industry: { threadId: "521000000000000004", emoji: "🏢" },
  hardware: { threadId: "521000000000000005", emoji: "🖥️" },
  rumours: { threadId: "521000000000000006", emoji: "🤫" },
  general: { threadId: "521000000000000007", emoji: "📰" },
};

/** News Item n: a higher n is newer. */
function item(
  n: number,
  overrides: Partial<IUncopiedNewsItem> = {},
): IUncopiedNewsItem {
  return {
    message_id: String(611000000000000000n + BigInt(n)),
    category_key: "industry",
    origin: "import",
    comment: `Story ${n}`,
    posted_at: new Date(Date.UTC(2019, 0, n)).toISOString(),
    link: { url: `https://example.com/news/${n}` },
    author: { user_id: AUTHOR_ID },
    ...overrides,
  };
}

function urlOf(messageId: string): string {
  return `https://discord.com/channels/100/${NEWS_CHANNEL}/${messageId}`;
}

/** The original message as Discord gives it now, with a fresh image address. */
function original(messageId: string): INewsPost {
  return {
    id: messageId,
    channelId: NEWS_CHANNEL,
    url: urlOf(messageId),
    system: false,
    webhookId: null,
    author: { id: AUTHOR_ID, bot: false, username: "reporter", globalName: null },
    member: null,
    cleanContent: "ignored: the copy shows the recorded comment",
    createdAt: new Date(Date.UTC(2019, 0, 1)),
    editedAt: null,
    attachments: new Map(),
    embeds: [],
  };
}

type Call =
  | ["list", number, number]
  | ["fetch", string]
  | ["post", string, INewsCopyMessage]
  | ["reportCopy", string, INewsCopyLocation | null]
  | ["react", string]
  | ["delete", string, string]
  | ["sleep", number];

/**
 * The News Items in memory, as the API keeps them: the uncopied listing is the items with
 * no copy, oldest first; reporting a copy takes an item out of it.
 */
interface IWorld {
  items: IUncopiedNewsItem[];
  copied: Map<string, INewsCopyLocation>;
  calls: Call[];
  deps: INewsHistoryCopyDeps;
}

function world(
  items: IUncopiedNewsItem[],
  options: {
    failFetch?: string[];
    failPost?: string[];
    failList?: boolean;
    per?: number;
    failureLimit?: number;
    onPost?: (world: IWorld) => void;
    originalOf?: (messageId: string) => INewsPost;
  } = {},
): IWorld {
  const w: IWorld = { items: [...items], copied: new Map(), calls: [], deps: null as never };
  let nextCopy = 900000000000000000n;
  const api: INewsFilingApi = {
    record: async () => {
      throw new Error("the history copy does not record");
    },
    remove: async () => {
      throw new Error("the history copy does not remove");
    },
    reportCopy: async (messageId, copy) => {
      w.calls.push(["reportCopy", messageId, copy]);
      if (copy) w.copied.set(messageId, copy);
    },
  };
  const discord: INewsCopyDiscord = {
    react: async (_channelId, messageId) => {
      w.calls.push(["react", messageId]);
    },
    postCopy: async (threadId, copy) => {
      w.calls.push(["post", threadId, copy]);
      const id = copy.content.match(/\/(\d+)$/)?.[1] ?? "";
      if (options.failPost?.includes(id)) throw new Error("Missing Access");
      options.onPost?.(w);
      nextCopy += 1n;
      return { messageId: String(nextCopy) };
    },
    deleteMessage: async (channelId, messageId) => {
      w.calls.push(["delete", channelId, messageId]);
    },
  };
  w.deps = {
    threads: THREADS,
    api,
    discord,
    listing: {
      async uncopied(page, per): Promise<IUncopiedNewsPage> {
        w.calls.push(["list", page, per]);
        if (options.failList) throw new Error("API down");
        const left = w.items
          .filter((i) => !w.copied.has(i.message_id))
          .sort((a, b) => a.posted_at.localeCompare(b.posted_at));
        const slice = left.slice((page - 1) * per, page * per);
        const next = page * per < left.length ? page + 1 : null;
        return { items: slice, count: left.length, next };
      },
    },
    originals: {
      async fetch(messageId) {
        w.calls.push(["fetch", messageId]);
        if (options.failFetch?.includes(messageId)) throw new Error("Unknown Message");
        return (options.originalOf ?? original)(messageId);
      },
    },
    sleep: async (ms) => {
      w.calls.push(["sleep", ms]);
    },
    ...(options.per ? { per: options.per } : {}),
    ...(options.failureLimit ? { failureLimit: options.failureLimit } : {}),
  };
  return w;
}

function posts(w: IWorld): [string, string][] {
  return w.calls
    .filter((call): call is ["post", string, INewsCopyMessage] => call[0] === "post")
    .map(([, threadId, copy]) => [threadId, copy.content]);
}

function threadOf(key: NewsCategoryKey): string {
  return THREADS[key].threadId;
}

test("copies oldest first into each category's thread, with an imported item's date", async () => {
  const older = item(1, { category_key: "rumours" });
  const newer = item(2);
  const w = world([newer, older]);

  const progress = await copyNewsHistory(w.deps);

  assert.deepEqual(posts(w), [
    [threadOf("rumours"), `<@${AUTHOR_ID}> shared on <t:1546300800:D>\nStory 1\n` +
      `https://example.com/news/1\n-# Discuss: ${urlOf(older.message_id)}`],
    [threadOf("industry"), `<@${AUTHOR_ID}> shared on <t:1546387200:D>\nStory 2\n` +
      `https://example.com/news/2\n-# Discuss: ${urlOf(newer.message_id)}`],
  ]);
  assert.deepEqual([...w.copied.keys()], [older.message_id, newer.message_id]);
  assert.equal(progress.copied, 2);
  assert.equal(progress.finished, true);
  assert.equal(progress.failure, null);
});

test("a live item's copy shows no date, and no copy is ever reacted to", async () => {
  const live = item(1, { origin: "live", comment: null });
  const w = world([live]);

  await copyNewsHistory(w.deps);

  assert.deepEqual(posts(w), [[threadOf("industry"), `<@${AUTHOR_ID}> shared\n` +
    `https://example.com/news/1\n-# Discuss: ${urlOf(live.message_id)}`]]);
  assert.equal(w.calls.some((call) => call[0] === "react"), false);
});

test("the copy uploads the images of the original as Discord gives them now", async () => {
  const shot = item(1, { link: null, comment: null });
  const fresh = "https://cdn.discordapp.com/attachments/1/2/shot.png?ex=fresh";
  const w = world([shot], {
    originalOf: (messageId) => ({
      ...original(messageId),
      attachments: new Map([["1", { url: fresh, contentType: "image/png", name: "shot.png" }]]),
    }),
  });

  await copyNewsHistory(w.deps);

  const [, , copy] = w.calls.find((call) => call[0] === "post") as
    ["post", string, INewsCopyMessage];
  assert.deepEqual(copy.files, [{ attachment: fresh, name: "shot.png" }]);
});

test("copies are paced about 1.5 seconds apart, the first at once", async () => {
  const w = world([item(1), item(2), item(3)]);

  await copyNewsHistory(w.deps);

  const order = w.calls
    .filter((call) => call[0] === "post" || call[0] === "sleep")
    .map((call) => (call[0] === "sleep" ? `sleep ${call[1]}` : "post"));
  assert.deepEqual(order, ["post", "sleep 1500", "post", "sleep 1500", "post"]);
});

test("a run resumes from the API's state: copied items are not copied again", async () => {
  const w = world([item(1), item(2), item(3)]);
  w.copied.set(item(1).message_id, { message_id: "1", thread_id: threadOf("industry") });
  w.copied.set(item(2).message_id, { message_id: "2", thread_id: threadOf("industry") });

  const progress = await copyNewsHistory(w.deps);

  assert.deepEqual(posts(w).map(([, content]) => content.endsWith(item(3).message_id)), [true]);
  assert.equal(progress.copied, 1);
});

test("the listing is read from page 1 again after each page, as copies leave it", async () => {
  const w = world([item(1), item(2), item(3)], { per: 2 });

  const progress = await copyNewsHistory(w.deps);

  const lists = w.calls.filter((call) => call[0] === "list");
  assert.deepEqual(lists, [["list", 1, 2], ["list", 1, 2], ["list", 1, 2]]);
  assert.equal(progress.copied, 3);
  assert.equal(progress.left, 0);
});

test("an item whose copy fails is logged and skipped; the run goes on and ends", async () => {
  const gone = item(1);
  const refused = item(2);
  const w = world([gone, refused, item(3)], {
    failFetch: [gone.message_id],
    failPost: [refused.message_id],
  });

  const progress = await copyNewsHistory(w.deps);

  assert.deepEqual([...w.copied.keys()], [item(3).message_id]);
  assert.equal(progress.copied, 1);
  assert.equal(progress.failed, 2);
  assert.equal(progress.finished, true);
  assert.equal(w.calls.filter((call) => call[0] === "fetch").length, 3);
});

test("more failed items than a page: the run reads past them to the next page", async () => {
  const failing = [item(1), item(2), item(3)];
  const w = world([...failing, item(4), item(5)], {
    per: 2,
    failFetch: failing.map((i) => i.message_id),
  });

  const progress = await copyNewsHistory(w.deps);

  assert.deepEqual([...w.copied.keys()], [item(4).message_id, item(5).message_id]);
  assert.equal(progress.failed, 3);
  assert.equal(progress.finished, true);
  assert.equal(w.calls.filter((call) => call[0] === "fetch").length, 5);
});

test("too many failures in a row stop the run, saying why", async () => {
  const items = [item(1), item(2), item(3), item(4)];
  const w = world(items, { failureLimit: 3, failPost: items.map((i) => i.message_id) });

  const progress = await copyNewsHistory(w.deps);

  assert.equal(w.calls.filter((call) => call[0] === "post").length, 3);
  assert.equal(progress.finished, false);
  assert.match(progress.failure?.label ?? "", /3 News Copies in a row failed/);
});

test("a listing the API refuses stops the run, saying which step failed", async () => {
  const w = world([item(1)], { failList: true });

  const progress = await copyNewsHistory(w.deps);

  assert.equal(progress.finished, false);
  assert.match(progress.failure?.label ?? "", /Could not list the News Items without/);
  assert.equal(posts(w).length, 0);
});

test("a post recorded during the run is copied after the history", async () => {
  const live = item(30, { origin: "live" });
  let added = false;
  const w = world([item(1), item(2)], {
    onPost: (current) => {
      if (added) return;
      added = true;
      current.items.push(live);
    },
  });

  await copyNewsHistory(w.deps);

  assert.deepEqual([...w.copied.keys()],
    [item(1).message_id, item(2).message_id, live.message_id]);
});

test("one run at a time: a second start is refused, and copies wait while it runs", async () => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner = new NewsHistoryCopyRunner();
  const w = world([item(1)]);
  const listing = w.deps.listing;
  const gated = {
    ...w.deps,
    listing: {
      async uncopied(page: number, per: number): Promise<IUncopiedNewsPage> {
        await gate;
        return listing.uncopied(page, per);
      },
    },
  };
  assert.equal(runner.copiesPaused(), false);

  const first = runner.start("staff", new Date(), gated);
  const second = runner.start("staff", new Date(), w.deps);

  assert.ok(first);
  assert.equal(second, null);
  assert.equal(runner.copiesPaused(), true);
  assert.equal(runner.current()?.startedBy, "staff");
  release();
  await first;
  assert.equal(runner.copiesPaused(), false);
  assert.equal(runner.current(), null);
  const again = runner.start("staff", new Date(), w.deps);
  assert.ok(again);
  await again;
});
