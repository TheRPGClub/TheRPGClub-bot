import assert from "node:assert/strict";
import test from "node:test";
import type { INewsMessage } from "../functions/NewsItem.js";
import type {
  INewsImportApi,
  INewsImportBatchResult,
  NewsImportBatchItem,
} from "../services/NewsImportApi.js";
import { scanNewsArchive, type IArchiveReader } from "../services/NewsImportScan.js";

const ARCHIVE = "520000000000000001";
const AUTHOR_ID = "720000000000000001";

/** Archive message n: ids rise with n, so a higher n is newer. */
function message(n: number, overrides: Partial<INewsMessage> = {}): INewsMessage {
  return {
    id: String(620000000000000000n + BigInt(n)),
    channelId: ARCHIVE,
    system: false,
    webhookId: null,
    author: { id: AUTHOR_ID, bot: false, username: "reporter", globalName: "Reporter" },
    member: null,
    cleanContent: `News ${n} https://example.com/news/${n}`,
    createdAt: new Date(Date.UTC(2020, 0, 1) + n * 60_000),
    editedAt: null,
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
}

/** A channel's history read like discord.js: newest first, `before` an exclusive cursor. */
function fakeArchive(messages: INewsMessage[]): IArchiveReader & { cursors: (string | null)[] } {
  const newestFirst = [...messages].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
  const archive = {
    cursors: [] as (string | null)[],
    async page(before: string | null, limit: number): Promise<INewsMessage[]> {
      archive.cursors.push(before);
      const older = before === null
        ? newestFirst
        : newestFirst.filter((m) => BigInt(m.id) < BigInt(before));
      return older.slice(0, limit);
    },
  };
  return archive;
}

/**
 * The batch endpoint's rules in memory: a new message is created, a known one updated,
 * a removed one left out, and a live one rejected. `failOnCall` throws on that call.
 */
function fakeApi(options: {
  removed?: string[];
  live?: string[];
  failOnCall?: number;
} = {}): INewsImportApi & { stored: Map<string, NewsImportBatchItem>; batches: number[] } {
  const api = {
    stored: new Map<string, NewsImportBatchItem>(),
    batches: [] as number[],
    async recordBatch(items: readonly NewsImportBatchItem[]): Promise<INewsImportBatchResult> {
      api.batches.push(items.length);
      if (api.batches.length === options.failOnCall) throw new Error("API down");
      const result: INewsImportBatchResult = {
        created: 0,
        updated: 0,
        previouslyRemoved: 0,
        rejected: [],
      };
      items.forEach((item, index) => {
        if (options.removed?.includes(item.message_id)) {
          result.previouslyRemoved += 1;
        } else if (options.live?.includes(item.message_id)) {
          const reason = "already recorded as a live News Item";
          result.rejected.push({ index, messageId: item.message_id, reason });
        } else {
          result[api.stored.has(item.message_id) ? "updated" : "created"] += 1;
          api.stored.set(item.message_id, item);
        }
      });
      return result;
    },
    async status() {
      return { sorted: 0, unsorted: api.stored.size, removed: 0 };
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

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

test("the scan pages back through the whole archive and imports every News Item", async () => {
  const archive = fakeArchive(range(1, 25).map((n) => message(n)));
  const api = fakeApi();

  const progress = await scanNewsArchive({ archive, api, archiveId: ARCHIVE, pageSize: 10 });

  assert.equal(progress.scanned, 25);
  assert.equal(progress.created, 25);
  assert.deepEqual([...api.stored.keys()].sort(), range(1, 25).map((n) => message(n).id).sort());
  assert.deepEqual(archive.cursors, [null, message(16).id, message(6).id]);
  assert.equal(progress.finished, true);
});

test("text-only, bot, webhook and system messages are skipped and counted by reason", async () => {
  const bot = { id: "720000000000000002", bot: true, username: "newsbot", globalName: null };
  const archive = fakeArchive([
    message(1),
    message(2, { cleanContent: "What a week for news" }),
    message(3, { author: bot }),
    message(4, { webhookId: "820000000000000001" }),
    message(5, { system: true }),
    message(6, { cleanContent: "Look", attachments: new Map([["a", {
      url: "https://cdn.discordapp.com/attachments/1/2/shot.png?ex=6a000000",
      contentType: "image/png",
      name: "shot.png",
    }]]) }),
  ]);
  const api = fakeApi();

  const progress = await scanNewsArchive({ archive, api, archiveId: ARCHIVE });

  assert.equal(progress.scanned, 6);
  assert.equal(progress.created, 2);
  assert.deepEqual(progress.skipped, { textOnly: 1, bot: 2, system: 1 });
});

test("an imported item keeps its original author and posted date, with no category", async () => {
  const original = message(7, {
    member: { displayName: "Old Reporter" },
    editedAt: new Date("2021-03-04T05:06:07.000Z"),
  });
  const api = fakeApi();

  await scanNewsArchive({ archive: fakeArchive([original]), api, archiveId: ARCHIVE });

  const stored = api.stored.get(original.id);
  assert.ok(stored);
  assert.equal(stored.author_id, AUTHOR_ID);
  assert.equal(stored.author_name, "Old Reporter");
  assert.equal(stored.posted_at, "2020-01-01T00:07:00.000Z");
  assert.equal(stored.edited_at, "2021-03-04T05:06:07.000Z");
  assert.equal(stored.channel_id, ARCHIVE);
  assert.equal("category_key" in stored, false);
});

test("News Items are sent in full batches across pages, never over the API's limit", async () => {
  const textOnly = { cleanContent: "chatter" };
  const archive = fakeArchive(range(1, 12).map((n) => message(n, n % 3 === 0 ? textOnly : {})));
  const api = fakeApi();

  const progress = await scanNewsArchive({
    archive, api, archiveId: ARCHIVE, pageSize: 4, batchSize: 3,
  });

  assert.deepEqual(api.batches, [3, 3, 2]);
  assert.equal(progress.created, 8);
  assert.deepEqual(progress.skipped, { textOnly: 4 });
});

test("the default batch is the API's limit of 100", async () => {
  const api = fakeApi();

  await scanNewsArchive({
    archive: fakeArchive(range(1, 250).map((n) => message(n))), api, archiveId: ARCHIVE,
  });

  assert.deepEqual(api.batches, [100, 100, 50]);
});

test("removed and rejected messages are counted, with the API's reasons", async () => {
  const api = fakeApi({ removed: [message(1).id], live: [message(2).id, message(3).id] });

  const progress = await scanNewsArchive({
    archive: fakeArchive(range(1, 4).map((n) => message(n))), api, archiveId: ARCHIVE,
  });

  assert.equal(progress.created, 1);
  assert.equal(progress.previouslyRemoved, 1);
  assert.deepEqual(progress.rejected, { "already recorded as a live News Item": 2 });
});

test("a scan stopped by an error reports it, and a re-run imports the rest once", async () => {
  const archive = fakeArchive(range(1, 9).map((n) => message(n)));
  const api = fakeApi({ failOnCall: 2 });
  const deps = { archive, api, archiveId: ARCHIVE, batchSize: 3 };

  const stopped = await scanNewsArchive(deps);

  assert.equal(stopped.finished, false);
  assert.equal(stopped.created, 3);
  assert.match(String(stopped.failure?.label), /Could not record 3 archive messages/);
  assert.equal(api.stored.size, 3);

  const rerun = await scanNewsArchive(deps);

  assert.equal(rerun.finished, true);
  assert.equal(rerun.failure, null);
  assert.equal(rerun.created, 6);
  assert.equal(rerun.updated, 3);
  assert.equal(api.stored.size, 9);
});

test("a failed archive read stops the scan with the error instead of throwing", async () => {
  const archive: IArchiveReader = {
    page: async () => {
      throw new Error("Missing Access");
    },
  };

  const progress = await scanNewsArchive({ archive, api: fakeApi(), archiveId: ARCHIVE });

  assert.equal(progress.finished, false);
  assert.ok(progress.failure);
  assert.match(progress.failure.label, /Could not read the Game News Archive/);
  assert.equal((progress.failure.error as Error).message, "Missing Access");
});

test("progress is reported after every page, with how far back the scan has read", async () => {
  const seen: [number, number, string | null][] = [];

  await scanNewsArchive({
    archive: fakeArchive(range(1, 25).map((n) => message(n))),
    api: fakeApi(),
    archiveId: ARCHIVE,
    pageSize: 10,
    onProgress: (p) => seen.push([p.scanned, p.created, p.oldestPostedAt]),
  });

  assert.deepEqual(seen, [
    [10, 0, "2020-01-01T00:16:00.000Z"],
    [20, 0, "2020-01-01T00:06:00.000Z"],
    [25, 25, "2020-01-01T00:01:00.000Z"],
  ]);
});
