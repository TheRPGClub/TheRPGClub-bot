import test from "node:test";
import assert from "node:assert/strict";
import { Collection, GatewayRateLimitError, type Guild, type GuildMember } from "discord.js";
import {
  FULL_MEMBER_FETCH_MAX_WAIT_MS,
  fetchAllGuildMembers,
} from "../functions/GuildMemberFetch.js";

const MEMBERS = new Collection<string, GuildMember>([["1", { id: "1" } as GuildMember]]);

function rateLimitError(retryAfterSeconds: number): GatewayRateLimitError {
  return new GatewayRateLimitError(
    {
      opcode: 8,
      retry_after: retryAfterSeconds,
      meta: { guild_id: "1", nonce: "n" },
    } as ConstructorParameters<typeof GatewayRateLimitError>[0],
    {},
  );
}

function buildGuild(failures: unknown[]): { guild: Guild; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const guild = {
    members: {
      fetch: async (...args: unknown[]) => {
        calls.push(args);
        const failure = failures.shift();
        if (failure) throw failure;
        return MEMBERS;
      },
    },
  } as unknown as Guild;
  return { guild, calls };
}

test("fetchAllGuildMembers requests the full list once when not rate limited", async () => {
  const { guild, calls } = buildGuild([]);
  const waits: number[] = [];
  const result = await fetchAllGuildMembers(guild, async (ms) => {
    waits.push(ms);
  });
  assert.equal(result, MEMBERS);
  assert.deepEqual(calls, [[]]);
  assert.deepEqual(waits, []);
});

test("fetchAllGuildMembers waits out retry_after and retries once", async () => {
  const { guild, calls } = buildGuild([rateLimitError(2.5)]);
  const waits: number[] = [];
  const result = await fetchAllGuildMembers(guild, async (ms) => {
    waits.push(ms);
  });
  assert.equal(result, MEMBERS);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [2500]);
});

test("fetchAllGuildMembers gives up when the wait exceeds the cap", async () => {
  const error = rateLimitError(FULL_MEMBER_FETCH_MAX_WAIT_MS / 1000 + 1);
  const { guild, calls } = buildGuild([error]);
  await assert.rejects(fetchAllGuildMembers(guild, async () => {}), (err) => err === error);
  assert.equal(calls.length, 1);
});

test("fetchAllGuildMembers rethrows errors that are not rate limits", async () => {
  const error = new Error("GuildMembersTimeout");
  const { guild, calls } = buildGuild([error]);
  await assert.rejects(fetchAllGuildMembers(guild, async () => {}), (err) => err === error);
  assert.equal(calls.length, 1);
});
