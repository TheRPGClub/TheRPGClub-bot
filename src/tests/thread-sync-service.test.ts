import test from "node:test";
import assert from "node:assert/strict";
import type { AnyThreadChannel } from "discord.js";
import {
  claimMessageUpsert,
  fetchAllArchivedThreads,
  resetMessageUpsertThrottle,
} from "../services/ThreadSyncService.js";

function fakeThread(id: string, archiveTimestamp: number): AnyThreadChannel {
  return { id, archiveTimestamp } as unknown as AnyThreadChannel;
}

function pageOf(threads: AnyThreadChannel[], hasMore: boolean) {
  return { threads: new Map(threads.map((thread) => [thread.id, thread])), hasMore };
}

test("fetchAllArchivedThreads walks every page using the oldest archive time", async () => {
  const pages = [
    pageOf([fakeThread("a", 300), fakeThread("b", 200)], true),
    pageOf([fakeThread("c", 100)], false),
  ];
  const cursors: (number | undefined)[] = [];
  const manager = {
    fetchActive: async () => ({ threads: new Map() }),
    fetchArchived: async (options: { before?: Date; limit: number }) => {
      cursors.push(options.before?.getTime());
      return pages[cursors.length - 1];
    },
  };

  const threads = await fetchAllArchivedThreads(manager);
  assert.deepEqual(threads.map((thread) => thread.id), ["a", "b", "c"]);
  assert.deepEqual(cursors, [undefined, 200]);
});

test("fetchAllArchivedThreads stops when the cursor does not move back", async () => {
  let calls = 0;
  const manager = {
    fetchActive: async () => ({ threads: new Map() }),
    fetchArchived: async () => {
      calls++;
      return pageOf([fakeThread(`t${calls}`, 500)], true);
    },
  };

  const threads = await fetchAllArchivedThreads(manager);
  assert.equal(calls, 2);
  assert.equal(threads.length, 2);
});

test("claimMessageUpsert allows one upsert per thread per window", () => {
  resetMessageUpsertThrottle();
  const start = 1_000_000;
  assert.equal(claimMessageUpsert("t1", start), true);
  assert.equal(claimMessageUpsert("t1", start + 60_000), false);
  assert.equal(claimMessageUpsert("t2", start + 60_000), true);
  assert.equal(claimMessageUpsert("t1", start + 5 * 60 * 1000), true);
  resetMessageUpsertThrottle();
});
