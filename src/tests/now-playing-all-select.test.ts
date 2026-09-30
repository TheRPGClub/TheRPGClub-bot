import test from "node:test";
import assert from "node:assert/strict";
import { NowPlayingNavHandlers } from "../commands/now-playing/nowPlayingNav.handler.js";
import Member from "../classes/Member.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

test("nowplaying everyone select replaces the loading panel in place", async () => {
  const command = new NowPlayingNavHandlers() as any;
  const originalGetNowPlaying = Member.getNowPlaying;

  const updates: any[] = [];
  const edits: any[] = [];

  try {
    Member.getNowPlaying = (async () => []) as any;

    const interaction: any = {
      customId: "nowplaying-all-select:v1",
      isMessageComponent: () => true,
      user: { id: "123", username: "owner" },
      values: ["456"],
      guildId: null,
      client: {
        users: {
          fetch: async () => ({ id: "456", username: "member", displayName: "Member" }),
        },
      },
      message: {
        flags: { has: () => false },
      },
      deferred: false,
      replied: false,
      // discord.js marks the interaction replied once update() resolves.
      update: async (payload: any) => {
        updates.push(payload);
        interaction.replied = true;
      },
      editReply: async (payload: any) => {
        edits.push(payload);
        return {
          id: "msg-1",
          channelId: "chan-1",
          flags: { has: () => true },
        };
      },
      reply: async () => {
        throw new Error("reply should not be called after the loading update");
      },
      followUp: async () => {
        throw new Error("followUp should not be called after the loading update");
      },
    };

    await command.handleNowPlayingAllSelect(interaction);

    assert.equal(updates.length, 1, "expected the loading panel via update");
    assert.equal(edits.length, 1, "expected the member list via editReply");
    assert.ok(Array.isArray(edits[0]?.components), "editReply should include components");
    assert.equal(edits[0]?.flags, COMPONENTS_V2_FLAG, "editReply should keep Components V2");
    assert.deepEqual(edits[0]?.attachments, [], "editReply should drop stale attachments");
  } finally {
    Member.getNowPlaying = originalGetNowPlaying;
  }
});
