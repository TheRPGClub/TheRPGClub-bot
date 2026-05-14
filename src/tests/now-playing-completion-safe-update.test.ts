import test from "node:test";
import assert from "node:assert/strict";
import { NowPlayingCommand } from "../commands/now-playing.command.js";
import Member from "../classes/Member.js";
import Game from "../classes/Game.js";

test("nowplaying edit menu add completion uses safe update fallback in DM flow", async () => {
  const command = new NowPlayingCommand() as any;
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

    command.buildNowPlayingAttachments = async () => ({
      files: [],
      thumbnailsByGameId: new Map<number, string>(),
      covers: [],
    });
    command.buildNowPlayingCompletionComponents = () => [{ kind: "completion-components" }];
    command.withPmNowPlayingList = async (
      _ownerId: string,
      _guildId: string | null,
      components: any[],
    ) => components;
    command.buildComponentPayload = (components: any[]) => ({ components });

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

test("nowplaying completion config renders in DM with no image accessory", async () => {
  const command = new NowPlayingCommand() as any;
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

    command.withPmNowPlayingList = async (
      _ownerId: string,
      _guildId: string | null,
      components: any[],
    ) => components;

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
