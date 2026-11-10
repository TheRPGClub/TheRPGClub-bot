import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import type { INewsMessage } from "../functions/NewsItem.js";
import {
  NEWS_IMPORT_STAFF_ONLY_MESSAGE,
  newsImportStatusReply,
  startNewsImportScanReply,
  type INewsImportScanStart,
} from "../services/NewsImport.js";
import type { INewsImportApi, INewsImportStatus } from "../services/NewsImportApi.js";
import { NewsImportScanRunner, type IArchiveReader } from "../services/NewsImportScan.js";

const STAFF_ID = "730000000000000001";
const ARCHIVE = "530000000000000001";
const PROGRESS_URL = "https://discord.com/channels/1/2/3";

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

function fakeApi(options: {
  status?: INewsImportStatus;
  statusError?: unknown;
  batchError?: unknown;
} = {}): INewsImportApi & { statusFor: string[]; batches: number } {
  const api = {
    statusFor: [] as string[],
    batches: 0,
    async status(actingUserId: string): Promise<INewsImportStatus> {
      api.statusFor.push(actingUserId);
      if (options.statusError) throw options.statusError;
      return options.status ?? { sorted: 0, unsorted: 0, removed: 0 };
    },
    async recordBatch(items: readonly unknown[]) {
      api.batches += 1;
      if (options.batchError) throw options.batchError;
      return { created: items.length, updated: 0, previouslyRemoved: 0, rejected: [] };
    },
    async list() {
      throw new Error("the scan does not list");
    },
    async assign() {
      throw new Error("the scan does not assign");
    },
  };
  return api;
}

test("status shows the sorted, unsorted and removed counts for the acting member", async () => {
  const api = fakeApi({ status: { sorted: 12, unsorted: 340, removed: 5 } });

  const text = await newsImportStatusReply(STAFF_ID, { api, runner: new NewsImportScanRunner() });

  assert.deepEqual(api.statusFor, [STAFF_ID]);
  assert.match(text, /\*\*12\*\* sorted/);
  assert.match(text, /\*\*340\*\* unsorted/);
  assert.match(text, /\*\*5\*\* removed/);
});

test("status refuses a member who is not an Admin or Superadmin, showing the call", async () => {
  const api = fakeApi({ statusError: forbidden() });

  const text = await newsImportStatusReply(STAFF_ID, { api, runner: new NewsImportScanRunner() });

  assert.ok(text.startsWith(NEWS_IMPORT_STAFF_ONLY_MESSAGE));
  assert.match(text, /"status": 403/);
  assert.match(text, /news_import\/status\?acting_user_id=/);
});

function newsMessage(n: number, text = `News https://example.com/${n}`): INewsMessage {
  return {
    id: String(630000000000000000n + BigInt(n)),
    channelId: ARCHIVE,
    system: false,
    webhookId: null,
    author: { id: "740000000000000001", bot: false, username: "reporter", globalName: null },
    member: null,
    cleanContent: text,
    createdAt: new Date(Date.UTC(2019, 5, n)),
    editedAt: null,
    attachments: new Map(),
    embeds: [],
  };
}

/** An archive of `count` messages read as a single short page, newest first. */
function archiveOf(messages: INewsMessage[], gate?: Promise<void>): IArchiveReader {
  return {
    async page(before) {
      if (gate) await gate;
      return before === null ? [...messages].reverse() : [];
    },
  };
}

interface IFakeChannel {
  posts: string[];
  edits: string[];
  details: string[];
}

function scanStart(
  api: INewsImportApi,
  runner: NewsImportScanRunner,
  overrides: Partial<INewsImportScanStart> = {},
): { start: INewsImportScanStart; channel: IFakeChannel } {
  const channel: IFakeChannel = { posts: [], edits: [], details: [] };
  const start: INewsImportScanStart = {
    actingUserId: STAFF_ID,
    testMode: false,
    api,
    runner,
    archive: archiveOf([newsMessage(1), newsMessage(2, "just chatting")]),
    archiveId: ARCHIVE,
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

test("staff start a scan: the reply links the progress message, which ends with counts", async () => {
  const api = fakeApi();
  const { start, channel } = scanStart(api, new NewsImportScanRunner());

  const { reply, finished } = await startNewsImportScanReply(start);
  await finished;

  assert.match(reply, new RegExp(PROGRESS_URL));
  assert.equal(channel.posts.length, 1);
  assert.match(channel.posts[0], new RegExp(`<@${STAFF_ID}>`));
  const final = channel.edits.at(-1) ?? "";
  assert.match(final, /finished/);
  assert.match(final, /Scanned \*\*2\*\* messages/);
  assert.match(final, /Recorded \*\*1\*\*/);
  assert.match(final, /1 text only/);
  assert.deepEqual(channel.details, []);
});

test("a scan is refused in test mode before any call", async () => {
  const api = fakeApi();
  const { start, channel } = scanStart(api, new NewsImportScanRunner(), { testMode: true });

  const { reply, finished } = await startNewsImportScanReply(start);

  assert.equal(finished, null);
  assert.match(reply, /disabled in test mode/);
  assert.deepEqual(api.statusFor, []);
  assert.deepEqual(channel.posts, []);
});

test("a scan is refused for a member who is not an Admin or Superadmin", async () => {
  const api = fakeApi({ statusError: forbidden() });
  const { start, channel } = scanStart(api, new NewsImportScanRunner());

  const { reply, finished } = await startNewsImportScanReply(start);

  assert.equal(finished, null);
  assert.ok(reply.startsWith(NEWS_IMPORT_STAFF_ONLY_MESSAGE));
  assert.deepEqual(channel.posts, []);
  assert.equal(api.batches, 0);
});

test("a second start while a scan runs is refused with its progress", async () => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner = new NewsImportScanRunner();
  const api = fakeApi();
  const first = scanStart(api, runner, { archive: archiveOf([newsMessage(1)], gate) });
  const second = scanStart(api, runner);

  const started = await startNewsImportScanReply(first.start);
  const refused = await startNewsImportScanReply(second.start);

  assert.equal(refused.finished, null);
  assert.match(refused.reply, /already running/);
  assert.match(refused.reply, new RegExp(`<@${STAFF_ID}>`));
  assert.deepEqual(second.channel.posts, []);

  release();
  await started.finished;
  assert.equal(runner.current(), null);
  const again = await startNewsImportScanReply(second.start);
  await again.finished;
  assert.equal(second.channel.posts.length, 1);
});

test("a scan stopped by an error says so and posts the full error below", async () => {
  const api = fakeApi({ batchError: forbidden() });
  const runner = new NewsImportScanRunner();
  const { start, channel } = scanStart(api, runner);

  const { finished } = await startNewsImportScanReply(start);
  await finished;

  assert.match(channel.edits.at(-1) ?? "", /stopped/);
  assert.match(channel.edits.at(-1) ?? "", /again/);
  assert.equal(channel.details.length, 1);
  assert.match(channel.details[0], /Could not record 1 archive messages/);
  assert.match(channel.details[0], /"status": 403/);
  assert.equal(runner.current(), null);
});

test("status mentions a scan in progress", async () => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runner = new NewsImportScanRunner();
  const api = fakeApi();
  const { start } = scanStart(api, runner, { archive: archiveOf([newsMessage(1)], gate) });
  const started = await startNewsImportScanReply(start);

  const text = await newsImportStatusReply(STAFF_ID, { api, runner });

  assert.match(text, /scan is running/);
  release();
  await started.finished;
});

test("the progress message is edited at most once per interval, then with the counts", async () => {
  let clock = Date.UTC(2026, 10, 10);
  const messages = Array.from({ length: 301 }, (_, i) => newsMessage(i + 1));
  const newestFirst = [...messages].reverse();
  const archive: IArchiveReader = {
    async page(before, limit) {
      clock += 3_000;
      const start = before === null ? 0 : newestFirst.findIndex((m) => m.id === before) + 1;
      return newestFirst.slice(start, start + limit);
    },
  };
  const { start, channel } = scanStart(fakeApi(), new NewsImportScanRunner(), {
    archive,
    now: () => new Date(clock),
    editIntervalMs: 5_000,
  });

  const { finished } = await startNewsImportScanReply(start);
  await finished;

  assert.equal(channel.edits.length, 3);
  assert.match(channel.edits[0], /Scanned \*\*200\*\* messages/);
  assert.match(channel.edits[1], /Scanned \*\*301\*\* messages/);
  assert.match(channel.edits[2], /finished/);
});

test("/news-import belongs to the News Hub Feature", async () => {
  const { featureKeyFor } = await import("../functions/FeatureGate.js");
  const { NEWS_HUB_FEATURE_KEY } = await import("../config/featureGate.js");
  const { NEWS_IMPORT_COMMAND } = await import("../services/NewsImport.js");

  assert.equal(NEWS_IMPORT_COMMAND, "news-import");
  assert.equal(featureKeyFor({ type: "command", name: NEWS_IMPORT_COMMAND }), NEWS_HUB_FEATURE_KEY);
});
