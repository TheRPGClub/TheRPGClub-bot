import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTick } from "node:timers/promises";
import { returnToNowPlayingEditMenu } from "../commands/now-playing/nowPlayingListRenderer.js";
import Member from "../classes/Member.js";

test("return to edit menu edits a message that was already edited", async () => {
  const edits: any[] = [];
  const originalGetNowPlaying = Member.getNowPlaying;

  try {
    Member.getNowPlaying = (async () => []) as any;

    // The sort save state: deferUpdate, then the loading panel edit set `replied`.
    const interaction: any = {
      user: { id: "123" },
      channelId: "channel-1",
      deferred: true,
      replied: true,
      __rpgAcked: true,
      isMessageComponent: () => true,
      isModalSubmit: () => false,
      editReply: async (payload: any) => {
        edits.push(payload);
      },
      followUp: async () => {
        throw new Error("followUp should not be called");
      },
      reply: async () => {
        throw new Error("reply should not be called");
      },
    };

    await returnToNowPlayingEditMenu(interaction, "123");
    await nextTick();

    assert.equal(edits.length, 1, "should edit the loading panel once");
    assert.ok(Array.isArray(edits[0]?.components), "edit should include components");
  } finally {
    Member.getNowPlaying = originalGetNowPlaying;
  }
});
