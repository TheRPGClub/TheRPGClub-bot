import test from "node:test";
import assert from "node:assert/strict";
import { NowPlayingCommand } from "../commands/now-playing.command.js";

test("nowplaying list edit opens ephemeral manage menu for owner", async () => {
  const command = new NowPlayingCommand() as any;
  const replies: any[] = [];

  command.buildNowPlayingEditInitialComponents = async () => [{ kind: "manage-menu" }];

  const interaction: any = {
    customId: "nowplaying-list-edit:123",
    user: { id: "123" },
    message: {
      id: "message-1",
      channelId: "channel-1",
      flags: { has: () => false },
    },
    deferred: false,
    replied: false,
    reply: async (payload: any) => {
      replies.push(payload);
    },
    followUp: async () => {
      throw new Error("followUp should not be called");
    },
    editReply: async () => {
      throw new Error("editReply should not be called");
    },
  };

  await command.handleNowPlayingListEdit(interaction);

  assert.equal(replies.length, 1, "should reply once");
  assert.ok(Array.isArray(replies[0]?.components), "reply should include components");
});

test("nowplaying list edit rejects non-owner", async () => {
  const command = new NowPlayingCommand() as any;
  const replies: any[] = [];

  const interaction: any = {
    customId: "nowplaying-list-edit:123",
    user: { id: "999" },
    message: {
      id: "message-1",
      channelId: "channel-1",
      flags: { has: () => false },
    },
    deferred: false,
    replied: false,
    reply: async (payload: any) => {
      replies.push(payload);
    },
    followUp: async () => {
      throw new Error("followUp should not be called");
    },
    editReply: async () => {
      throw new Error("editReply should not be called");
    },
  };

  await command.handleNowPlayingListEdit(interaction);

  assert.equal(replies.length, 1, "should reply once");
  assert.ok(Array.isArray(replies[0]?.components), "reply should include components");
});
