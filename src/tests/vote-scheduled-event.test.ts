import test from "node:test";
import assert from "node:assert/strict";
import type { Guild } from "discord.js";
import { ensureVoteScheduledEvent } from "../functions/VoteScheduledEvent.js";

const startsAt = new Date("2026-10-30T16:00:00.000Z");

function fakeGuild(existing: Array<{ name: string; scheduledStartTimestamp: number }>) {
  const created: Array<{ name: string }> = [];
  const guild = {
    id: "1",
    scheduledEvents: {
      fetch: async () => existing,
      create: async (options: { name: string }) => {
        created.push(options);
        return { id: "new", ...options };
      },
    },
  } as unknown as Guild;
  return { guild, created };
}

const params = { roundNumber: 144, monthYear: "November 2026", startsAt };

test("ensureVoteScheduledEvent creates the round's vote event", async () => {
  const { guild, created } = fakeGuild([]);
  const result = await ensureVoteScheduledEvent(guild, params);

  assert.equal(result.created, true);
  assert.deepEqual(created.map((e) => e.name), ["Round 144 Vote (November 2026)"]);
});

test("ensureVoteScheduledEvent reuses an event with the same name", async () => {
  const { guild, created } = fakeGuild([
    { name: "Round 144 Vote (November 2026)", scheduledStartTimestamp: 0 },
  ]);
  const result = await ensureVoteScheduledEvent(guild, params);

  assert.equal(result.created, false);
  assert.equal(created.length, 0);
});

test("ensureVoteScheduledEvent reuses an older-named vote event at the same time", async () => {
  const { guild, created } = fakeGuild([
    { name: "Round 143 Vote (October 2026)", scheduledStartTimestamp: startsAt.getTime() },
  ]);
  const result = await ensureVoteScheduledEvent(guild, params);

  assert.equal(result.created, false);
  assert.equal(created.length, 0);
});
