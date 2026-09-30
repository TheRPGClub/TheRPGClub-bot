import test from "node:test";
import assert from "node:assert/strict";

// Test mode is read once at module load, so every module that reaches
// src/config/ must be imported dynamically below this assignment.
process.env.TEST_GUILD_ID = "1547802424301854770";

const {
  ensureUserEmojiForMember,
  syncUserEmojiFromDisplayNameChange,
} = await import("../services/UserEmojiService.js");

import type { Client, GuildMember } from "discord.js";

// Application emojis are shared with production, so a test mode bot must never write them.
function buildRecordingClient(calls: string[]): Client {
  return {
    application: {
      emojis: {
        create: async () => {
          calls.push("create");
          return { id: "1" };
        },
        delete: async () => {
          calls.push("delete");
        },
      },
    },
  } as unknown as Client;
}

// Every write path reads the avatar URL before uploading, so reading it counts as a write.
function buildRecordingMember(calls: string[]): GuildMember {
  return {
    id: "191938640413327360",
    displayName: "merph518",
    displayAvatarURL: () => {
      calls.push("avatar");
      return "https://cdn.discordapp.com/embed/avatars/0.png";
    },
  } as unknown as GuildMember;
}

test("test mode never creates an emoji for a member", async () => {
  const calls: string[] = [];
  await ensureUserEmojiForMember(buildRecordingClient(calls), buildRecordingMember(calls));
  assert.deepEqual(calls, []);
});

test("test mode never recreates an emoji on a display name change", async () => {
  const calls: string[] = [];
  await syncUserEmojiFromDisplayNameChange(
    buildRecordingClient(calls),
    buildRecordingMember(calls),
  );
  assert.deepEqual(calls, []);
});
