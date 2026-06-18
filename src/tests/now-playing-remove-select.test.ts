import test from "node:test";
import assert from "node:assert/strict";
import { NowPlayingRemoveHandlers } from "../commands/now-playing/nowPlayingRemove.handler.js";
import Member from "../classes/Member.js";

test("nowplaying remove select acknowledges interaction and refreshes same message", async () => {
  const command = new NowPlayingRemoveHandlers() as any;

  const originalRemoveNowPlaying = Member.removeNowPlaying;
  const originalGetNowPlaying = Member.getNowPlaying;

  const updates: any[] = [];
  const edits: any[] = [];

  try {
    Member.removeNowPlaying = (async () => true) as any;
    Member.getNowPlaying = (async () => ([
      {
        gameId: 11,
        title: "Alpha",
        platformName: "Switch",
        platformAbbreviation: "NS",
        note: null,
        threadId: null,
        addedAt: null,
        noteUpdatedAt: null,
        sortOrder: null,
      },
    ])) as any;

    command.refreshNowPlayingListFromContext = async () => true;
    command.buildNowPlayingAttachments = async () => ({
      files: [],
      thumbnailsByGameId: new Map<number, string>(),
      covers: [],
    });
    command.buildNowPlayingRemoveComponents = () => ([{ kind: "remove-components" }]);
    command.buildComponentPayload = (components: any[]) => ({ components });

    const interaction: any = {
      customId: "nowplaying-remove-select:123",
      isMessageComponent: () => true,
      user: { id: "123" },
      values: ["11"],
      guildId: null,
      message: {
        flags: { has: () => false },
      },
      deferred: false,
      replied: false,
      update: async (payload: any) => {
        updates.push(payload);
      },
      editReply: async (payload: any) => {
        edits.push(payload);
      },
      reply: async () => {
        throw new Error("reply should not be called on happy path");
      },
      followUp: async () => {
        throw new Error("followUp should not be called on happy path");
      },
    };

    await command.handleNowPlayingRemoveSelect(interaction);

    assert.equal(updates.length, 1, "expected immediate interaction acknowledgement via update");
    assert.ok(Array.isArray(updates[0]?.components), "ack update should include components");

    assert.equal(edits.length, 1, "expected refreshed remove list via editReply");
    assert.ok(Array.isArray(edits[0]?.components), "editReply should include refreshed components");
  } finally {
    Member.removeNowPlaying = originalRemoveNowPlaying;
    Member.getNowPlaying = originalGetNowPlaying;
  }
});

test("nowplaying remove select acknowledges interaction and shows error on failed removal", async () => {
  const command = new NowPlayingRemoveHandlers() as any;

  const originalRemoveNowPlaying = Member.removeNowPlaying;

  const updates: any[] = [];
  const edits: any[] = [];

  try {
    Member.removeNowPlaying = (async () => false) as any;

    const interaction: any = {
      customId: "nowplaying-remove-select:123",
      isMessageComponent: () => true,
      user: { id: "123" },
      values: ["11"],
      guildId: null,
      message: {
        flags: { has: () => false },
      },
      deferred: false,
      replied: false,
      update: async (payload: any) => {
        updates.push(payload);
      },
      editReply: async (payload: any) => {
        edits.push(payload);
      },
      reply: async () => {
        throw new Error("reply should not be called on failed-removal path");
      },
      followUp: async () => {
        throw new Error("followUp should not be called on failed-removal path");
      },
    };

    await command.handleNowPlayingRemoveSelect(interaction);

    assert.equal(updates.length, 1, "expected immediate interaction acknowledgement via update");
    assert.equal(edits.length, 1, "expected error render via editReply after ack");
    assert.ok(Array.isArray(edits[0]?.components), "error editReply should include components");
  } finally {
    Member.removeNowPlaying = originalRemoveNowPlaying;
  }
});
