import test from "node:test";
import assert from "node:assert/strict";
import { NowPlayingCompletionHandlers } from "../commands/now-playing/nowPlayingCompletion.handler.js";
import Member from "../classes/Member.js";
import Game from "../classes/Game.js";

test("nowplaying edit menu add completion uses safe update fallback", async () => {
  const command = new NowPlayingCompletionHandlers() as any;
  const originalGetNowPlaying = Member.getNowPlaying;
  const edits: any[] = [];
  let updateCalls = 0;

  try {
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
      {
        gameId: 22,
        title: "Beta",
        platformName: "PC",
        platformAbbreviation: "PC",
        note: null,
        threadId: null,
        addedAt: null,
        noteUpdatedAt: null,
        sortOrder: null,
      },
    ])) as any;

    const interaction: any = {
      customId: "nowplaying-edit-menu-complete:123",
      user: { id: "123" },
      guildId: null,
      deferred: true,
      replied: false,
      __rpgAcked: true,
      __rpgDeferred: true,
      update: async () => {
        updateCalls += 1;
        const error: any = new Error("already acknowledged");
        error.code = 40060;
        throw error;
      },
      editReply: async (payload: any) => {
        edits.push(payload);
      },
      reply: async () => {
        throw new Error("reply should not be called");
      },
      followUp: async () => {
        throw new Error("followUp should not be called");
      },
    };

    await command.handleNowPlayingEditMenuComplete(interaction);

    assert.equal(updateCalls, 1, "safeUpdate should first attempt update");
    assert.equal(edits.length, 1, "safeUpdate should fall back to editReply");
    assert.ok(Array.isArray(edits[0]?.components), "fallback editReply should include components");
  } finally {
    Member.getNowPlaying = originalGetNowPlaying;
  }
});

test("nowplaying completion config renders with no image accessory", async () => {
  const command = new NowPlayingCompletionHandlers() as any;
  const originalGetNowPlaying = Member.getNowPlaying;
  const originalGetGameById = Game.getGameById;
  const edits: any[] = [];

  try {
    Member.getNowPlaying = (async () => ([
      {
        gameId: 11,
        title: "Alpha",
        platformName: "Switch",
        platformAbbreviation: "NS",
        note: "Current note",
        threadId: null,
        addedAt: null,
        noteUpdatedAt: null,
        sortOrder: null,
      },
    ])) as any;

    Game.getGameById = (async () => ({
      id: 11,
      title: "Alpha",
      imageData: null,
    })) as any;

    const interaction: any = {
      customId: "nowplaying-edit-menu-complete:123",
      user: { id: "123" },
      guildId: null,
      deferred: true,
      replied: false,
      __rpgAcked: true,
      __rpgDeferred: true,
      update: async () => {
        const error: any = new Error("already acknowledged");
        error.code = 40060;
        throw error;
      },
      editReply: async (payload: any) => {
        edits.push(payload);
      },
      reply: async () => {
        throw new Error("reply should not be called");
      },
      followUp: async () => {
        throw new Error("followUp should not be called");
      },
    };

    await command.handleNowPlayingEditMenuComplete(interaction);

    assert.equal(edits.length, 1, "expected fallback editReply");
    assert.ok(Array.isArray(edits[0]?.components), "editReply should include components");
  } finally {
    Member.getNowPlaying = originalGetNowPlaying;
    Game.getGameById = originalGetGameById;
  }
});

test("nowplaying completion modal reuses existing now-playing platform and skips platform picker", async () => {
  const command = new NowPlayingCompletionHandlers() as any;
  const originalGetNowPlaying = Member.getNowPlaying;
  const originalGetRecentCompletionForGame = Member.getRecentCompletionForGame;
  const originalAddCompletion = Member.addCompletion;
  const originalRemoveNowPlaying = Member.removeNowPlaying;
  const originalGetGameById = Game.getGameById;
  const originalGetPlatformsForGameWithStandard = Game.getPlatformsForGameWithStandard;

  const addCompletionCalls: any[] = [];
  const listUpdatePayloads: any[] = [];
  const modalReplyPayloads: any[] = [];
  let platformLookupCalls = 0;

  try {

    Member.getNowPlaying = (async () => ([
      {
        gameId: 11,
        title: "Alpha",
        platformId: 77,
        platformName: "Nintendo Switch",
        platformAbbreviation: "NS",
        note: "Current note",
        threadId: null,
        addedAt: null,
        noteUpdatedAt: null,
        sortOrder: null,
      },
    ])) as any;
    Member.getRecentCompletionForGame = (async () => null) as any;
    Member.addCompletion = (async (payload: any) => {
      addCompletionCalls.push(payload);
      return 999;
    }) as any;
    Member.removeNowPlaying = (async () => true) as any;

    Game.getGameById = (async () => ({
      id: 11,
      title: "Alpha",
      imageData: null,
    })) as any;
    Game.getPlatformsForGameWithStandard = (async () => {
      platformLookupCalls += 1;
      return [];
    }) as any;

    const listInteraction: any = {
      customId: "nowplaying-list-complete:123",
      user: { id: "123" },
      guildId: "guild-1",
      message: {
        id: "message-1",
        channelId: "channel-1",
        flags: { has: () => false },
      },
      deferred: false,
      replied: false,
      update: async (payload: any) => {
        listUpdatePayloads.push(payload);
      },
      reply: async () => {
        throw new Error("reply should not be called");
      },
      editReply: async () => {
        throw new Error("editReply should not be called");
      },
      followUp: async () => {
        throw new Error("followUp should not be called");
      },
    };

    await command.handleNowPlayingListComplete(listInteraction);
    assert.equal(listUpdatePayloads.length, 1, "completion setup should update once");

    const modalInteraction: any = {
      customId: "nowplaying-complete-modal:np-comp-ui-123",
      user: { id: "123" },
      guildId: "guild-1",
      client: { channels: { cache: new Map(), fetch: async () => null } },
      deferred: false,
      replied: false,
      deferReply: async () => {
        modalInteraction.deferred = true;
      },
      fields: {
        getTextInputValue: (id: string) => {
          if (id === "nowplaying-complete-date") return "";
          if (id === "nowplaying-complete-hours") return "";
          if (id === "nowplaying-complete-note") return "";
          return "";
        },
      },
      editReply: async (payload: any) => {
        modalReplyPayloads.push(payload);
      },
      reply: async () => {
        throw new Error("reply should not be called");
      },
      followUp: async () => {
        throw new Error("followUp should not be called");
      },
    };

    await command.handleNowPlayingCompletionModal(modalInteraction);

    assert.equal(platformLookupCalls, 0, "should skip platform picker lookup when platform already exists");
    assert.equal(addCompletionCalls.length, 1, "should add one completion");
    assert.equal(addCompletionCalls[0]?.platformId, 77, "should reuse existing now-playing platform");
    assert.equal(modalReplyPayloads.length, 1, "should complete with a single final response");
  } finally {
    Member.getNowPlaying = originalGetNowPlaying;
    Member.getRecentCompletionForGame = originalGetRecentCompletionForGame;
    Member.addCompletion = originalAddCompletion;
    Member.removeNowPlaying = originalRemoveNowPlaying;
    Game.getGameById = originalGetGameById;
    Game.getPlatformsForGameWithStandard = originalGetPlatformsForGameWithStandard;
  }
});
