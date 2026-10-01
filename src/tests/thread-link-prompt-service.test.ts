import test from "node:test";
import assert from "node:assert/strict";
import type { ThreadChannel } from "discord.js";
import { promptThread } from "../services/ThreadLinkPromptService.js";

process.env.IGDB_CLIENT_ID ??= "test-client";
process.env.IGDB_CLIENT_SECRET ??= "test-secret";

type LinkInfo = { skipLinking: boolean; gamedbGameIds: number[] };

function fakeThread(id: string, sent: unknown[]): ThreadChannel {
  return {
    id,
    name: `Thread ${id}`,
    parentId: "other-forum",
    ownerId: "someone",
    appliedTags: [],
    client: { user: { id: "bot" } },
    send: async (payload: unknown) => {
      sent.push(payload);
    },
  } as unknown as ThreadChannel;
}

function countingLookup(info: LinkInfo) {
  const calls: string[] = [];
  const lookup = async (threadId: string): Promise<LinkInfo> => {
    calls.push(threadId);
    return info;
  };
  return { calls, lookup };
}

test("promptThread looks up a linked thread once, not on every message", async () => {
  const sent: unknown[] = [];
  const thread = fakeThread("linked-thread", sent);
  const { calls, lookup } = countingLookup({ skipLinking: false, gamedbGameIds: [42] });

  await promptThread(thread, lookup);
  await promptThread(thread, lookup);
  await promptThread(thread, lookup);

  assert.deepEqual(calls, ["linked-thread"]);
  assert.equal(sent.length, 0);
});

test("promptThread prompts an unlinked thread once and skips the API afterwards", async () => {
  const sent: unknown[] = [];
  const thread = fakeThread("unlinked-thread", sent);
  const { calls, lookup } = countingLookup({ skipLinking: false, gamedbGameIds: [] });

  await promptThread(thread, lookup);
  await promptThread(thread, lookup);

  assert.deepEqual(calls, ["unlinked-thread"]);
  assert.equal(sent.length, 1);
});
