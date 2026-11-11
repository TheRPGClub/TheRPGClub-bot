import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import type { NewsCategoryThreads } from "../config/newsHub.js";
import type { INewsPost } from "../services/NewsCopying.js";
import {
  NEWS_IMPORT_STAFF_ONLY_MESSAGE,
  newsImportStatusReply,
  startNewsHistoryCopyReply,
  type INewsHistoryCopyStart,
} from "../services/NewsImport.js";
import type { INewsImportApi, INewsImportStatus } from "../services/NewsImportApi.js";
import {
  NewsHistoryCopyRunner,
  type INewsHistoryCopyDeps,
} from "../services/NewsHistoryCopy.js";
import type { IUncopiedNewsItem, IUncopiedNewsPage } from "../services/NewsItemApi.js";

const STAFF_ID = "730000000000000001";
const NEWS_CHANNEL = "530000000000000001";
const PROGRESS_URL = "https://discord.com/channels/1/2/3";

const THREAD = "531000000000000001";
const THREADS: NewsCategoryThreads = {
  announcements: { threadId: THREAD, emoji: "a" },
  releases: { threadId: THREAD, emoji: "b" },
  emulation: { threadId: THREAD, emoji: "c" },
  industry: { threadId: THREAD, emoji: "d" },
  hardware: { threadId: THREAD, emoji: "e" },
  rumours: { threadId: THREAD, emoji: "f" },
  general: { threadId: THREAD, emoji: "g" },
};

function forbidden(): AxiosError {
  const config = {
    method: "get",
    url: `/api/v1/news_import/status?acting_user_id=${STAFF_ID}`,
    headers: new AxiosHeaders(),
  };
  const response = {
    status: 403,
    statusText: "",
    data: { error: "forbidden" },
    headers: {},
    config,
  } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, response);
}

const NO_STATUS: INewsImportStatus = {
  sorted: 0,
  unsorted: 0,
  removed: 0,
  copied: 0,
  uncopied: 0,
};

function fakeApi(options: {
  status?: INewsImportStatus;
  statusError?: unknown;
} = {}): INewsImportApi & { statusFor: string[] } {
  const api = {
    statusFor: [] as string[],
    async status(actingUserId: string): Promise<INewsImportStatus> {
      api.statusFor.push(actingUserId);
      if (options.statusError) throw options.statusError;
      return options.status ?? NO_STATUS;
    },
    async list() {
      throw new Error("the history copy does not list unsorted items");
    },
    async assign() {
      throw new Error("the history copy does not assign");
    },
  };
  return api;
}

/** News Item n, imported, posted on 2019-06-n. */
function newsItem(n: number): IUncopiedNewsItem {
  return {
    message_id: String(630000000000000000n + BigInt(n)),
    category_key: "industry",
    origin: "import",
    comment: `Story ${n}`,
    posted_at: new Date(Date.UTC(2019, 5, n)).toISOString(),
    link: { url: `https://example.com/${n}` },
    author: { user_id: "740000000000000001" },
  };
}

function original(messageId: string): INewsPost {
  return {
    id: messageId,
    channelId: NEWS_CHANNEL,
    url: `https://discord.com/channels/1/${NEWS_CHANNEL}/${messageId}`,
    system: false,
    webhookId: null,
    author: { id: "740000000000000001", bot: false, username: "reporter", globalName: null },
    member: null,
    cleanContent: "",
    createdAt: new Date(Date.UTC(2019, 5, 1)),
    editedAt: null,
    attachments: new Map(),
    embeds: [],
  };
}

/**
 * The copy's fakes: `items` without a copy, listed oldest first until reported. `gate`
 * holds every listing read until it settles; `listError` fails them.
 */
function copyDeps(
  items: IUncopiedNewsItem[],
  options: { gate?: Promise<void>; listError?: unknown; onList?: () => void } = {},
): Omit<INewsHistoryCopyDeps, "onProgress"> & { reported: string[] } {
  const reported: string[] = [];
  let copyId = 0;
  return {
    reported,
    threads: THREADS,
    api: {
      record: async () => undefined,
      remove: async () => undefined,
      reportCopy: async (messageId) => {
        reported.push(messageId);
      },
    },
    discord: {
      react: async () => undefined,
      postCopy: async () => ({ messageId: String((copyId += 1)) }),
      deleteMessage: async () => undefined,
    },
    listing: {
      async uncopied(page, per): Promise<IUncopiedNewsPage> {
        if (options.gate) await options.gate;
        options.onList?.();
        if (options.listError) throw options.listError;
        const left = items.filter((i) => !reported.includes(i.message_id));
        const next = page * per < left.length ? page + 1 : null;
        return { items: left.slice((page - 1) * per, page * per), count: left.length, next };
      },
    },
    originals: { fetch: async (messageId) => original(messageId) },
    sleep: async () => undefined,
  };
}

interface IFakeChannel {
  posts: string[];
  edits: string[];
  details: string[];
}

function copyStart(
  api: INewsImportApi,
  runner: NewsHistoryCopyRunner,
  overrides: Partial<INewsHistoryCopyStart> = {},
): { start: INewsHistoryCopyStart; channel: IFakeChannel } {
  const channel: IFakeChannel = { posts: [], edits: [], details: [] };
  const start: INewsHistoryCopyStart = {
    actingUserId: STAFF_ID,
    testMode: false,
    api,
    runner,
    copy: copyDeps([newsItem(1), newsItem(2)]),
    post: async (text) => {
      channel.posts.push(text);
      return {
        url: PROGRESS_URL,
        edit: async (next) => {
          channel.edits.push(next);
        },
      };
    },
    postDetails: async (text) => {
      channel.details.push(text);
    },
    ...overrides,
  };
  return { start, channel };
}

test("staff start a history copy: the reply links the progress message, ending with counts",
  async () => {
    const api = fakeApi({ status: { ...NO_STATUS, copied: 3, uncopied: 2 } });
    const copy = copyDeps([newsItem(1), newsItem(2)]);
    const { start, channel } = copyStart(api, new NewsHistoryCopyRunner(), { copy });

    const { reply, finished } = await startNewsHistoryCopyReply(start);
    await finished;

    assert.deepEqual(api.statusFor, [STAFF_ID]);
    assert.match(reply, new RegExp(PROGRESS_URL));
    assert.match(reply, /2 News Items/);
    assert.equal(channel.posts.length, 1);
    assert.match(channel.posts[0], new RegExp(`<@${STAFF_ID}>`));
    assert.match(channel.posts[0], /run `\/news-import copy` again/);
    const final = channel.edits.at(-1) ?? "";
    assert.match(final, /finished/);
    assert.match(final, /Copied \*\*2\*\*/);
    assert.deepEqual(copy.reported, [newsItem(1).message_id, newsItem(2).message_id]);
    assert.deepEqual(channel.details, []);
  });

test("a history copy is refused in test mode before any call", async () => {
  const api = fakeApi();
  const { start, channel } = copyStart(api, new NewsHistoryCopyRunner(), { testMode: true });

  const { reply, finished } = await startNewsHistoryCopyReply(start);

  assert.equal(finished, null);
  assert.match(reply, /disabled in test mode/);
  assert.deepEqual(api.statusFor, []);
  assert.deepEqual(channel.posts, []);
});

test("a history copy is refused for a member who is not an Admin or Superadmin", async () => {
  const api = fakeApi({ statusError: forbidden() });
  const copy = copyDeps([newsItem(1)]);
  const { start, channel } = copyStart(api, new NewsHistoryCopyRunner(), { copy });

  const { reply, finished } = await startNewsHistoryCopyReply(start);

  assert.equal(finished, null);
  assert.ok(reply.startsWith(NEWS_IMPORT_STAFF_ONLY_MESSAGE));
  assert.deepEqual(channel.posts, []);
  assert.deepEqual(copy.reported, []);
});

test("a second copy while one runs is refused with its progress", async () => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner = new NewsHistoryCopyRunner();
  const api = fakeApi();
  const first = copyStart(api, runner, { copy: copyDeps([newsItem(1)], { gate }) });
  const second = copyStart(api, runner);

  const started = await startNewsHistoryCopyReply(first.start);
  const refused = await startNewsHistoryCopyReply(second.start);

  assert.equal(refused.finished, null);
  assert.match(refused.reply, /already running/);
  assert.match(refused.reply, new RegExp(`<@${STAFF_ID}>`));
  assert.deepEqual(second.channel.posts, []);

  release();
  await started.finished;
  assert.equal(runner.current(), null);
  const again = await startNewsHistoryCopyReply(second.start);
  await again.finished;
  assert.equal(second.channel.posts.length, 1);
});

test("a copy stopped by an error says so and posts the full error below", async () => {
  const runner = new NewsHistoryCopyRunner();
  const copy = copyDeps([newsItem(1)], { listError: forbidden() });
  const { start, channel } = copyStart(fakeApi(), runner, { copy });

  const { finished } = await startNewsHistoryCopyReply(start);
  await finished;

  const final = channel.edits.at(-1) ?? "";
  assert.match(final, /stopped/);
  assert.match(final, /Could not list the News Items without a News Copy/);
  assert.match(final, /403/);
  assert.match(final, /again/);
  assert.equal(channel.details.length, 1);
  assert.match(channel.details[0], /"status": 403/);
  assert.equal(runner.current(), null);
});

test("status shows the import's counts and how many News Items have a copy", async () => {
  const status = { sorted: 12, unsorted: 340, removed: 5, copied: 9000, uncopied: 1191 };
  const api = fakeApi({ status });

  const text = await newsImportStatusReply(STAFF_ID, { api, runner: new NewsHistoryCopyRunner() });

  assert.deepEqual(api.statusFor, [STAFF_ID]);
  assert.match(text, /\*\*12\*\* sorted/);
  assert.match(text, /\*\*340\*\* unsorted/);
  assert.match(text, /\*\*5\*\* removed/);
  assert.match(text, /\*\*9000\*\* copied/);
  assert.match(text, /\*\*1191\*\* waiting/);
});

test("status refuses a member who is not an Admin or Superadmin, showing the call", async () => {
  const api = fakeApi({ statusError: forbidden() });

  const text = await newsImportStatusReply(STAFF_ID, { api, runner: new NewsHistoryCopyRunner() });

  assert.ok(text.startsWith(NEWS_IMPORT_STAFF_ONLY_MESSAGE));
  assert.match(text, /"status": 403/);
  assert.match(text, /news_import\/status\?acting_user_id=/);
});

test("status shows a history copy in progress", async () => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner = new NewsHistoryCopyRunner();
  const api = fakeApi();
  const { start } = copyStart(api, runner, { copy: copyDeps([newsItem(1)], { gate }) });
  const started = await startNewsHistoryCopyReply(start);

  const text = await newsImportStatusReply(STAFF_ID, { api, runner });

  assert.match(text, /history copy is running/);
  release();
  await started.finished;
});

test("the progress message is edited at most once per interval, then with the counts",
  async () => {
    let clock = Date.UTC(2026, 10, 10);
    const items = Array.from({ length: 5 }, (_, i) => newsItem(i + 1));
    const copy = copyDeps(items);
    copy.sleep = async () => {
      clock += 1_500;
    };
    const { start, channel } = copyStart(fakeApi(), new NewsHistoryCopyRunner(), {
      copy,
      now: () => new Date(clock),
      editIntervalMs: 5_000,
    });

    const { finished } = await startNewsHistoryCopyReply(start);
    await finished;

    // Copies land at 0, 1.5, 3, 4.5 and 6 s: one edit at 6 s, then the final one.
    assert.equal(channel.edits.length, 2);
    assert.match(channel.edits[0], /Copied \*\*5\*\*/);
    assert.match(channel.edits[1], /finished/);
  });

test("/news-import belongs to the News Hub Feature", async () => {
  const { featureKeyFor } = await import("../functions/FeatureGate.js");
  const { NEWS_HUB_FEATURE_KEY } = await import("../config/featureGate.js");
  const { NEWS_IMPORT_COMMAND } = await import("../services/NewsImport.js");

  assert.equal(NEWS_IMPORT_COMMAND, "news-import");
  assert.equal(featureKeyFor({ type: "command", name: NEWS_IMPORT_COMMAND }), NEWS_HUB_FEATURE_KEY);
});
