import test from "node:test";
import assert from "node:assert/strict";
import { NowPlayingCommand } from "../commands/now-playing.command.js";
import Member from "../classes/Member.js";

test("nowplaying notes toggle show defers then edits reply", async () => {
  const command = new NowPlayingCommand() as any;
  const originalGetNowPlaying = Member.getNowPlaying;
  const callOrder: string[] = [];
  const withActionsArgs: boolean[] = [];

  try {
    Member.getNowPlaying = (async () => ([
      {
        gameId: 11,
        title: "Alpha",
        platformName: "Switch",
        platformAbbreviation: "NS",
        note: "Some note",
        threadId: null,
        addedAt: null,
        noteUpdatedAt: null,
        sortOrder: null,
      },
    ])) as any;

    command.buildNowPlayingListPayload = async () => ({
      components: [{ kind: "payload-components" }],
      files: [],
    });
    command.withNowPlayingActions = (
      _includeEdit: boolean,
      _ownerId: string,
      components: any[],
      showNotes: boolean,
    ) => {
      withActionsArgs.push(showNotes);
      return components;
    };

    const interaction: any = {
      customId: "nowplaying-list-notes:123:show",
      user: { id: "123", username: "Owner", displayName: "Owner" },
      message: { flags: { has: () => true } },
      guildId: null,
      deferred: false,
      replied: false,
      deferUpdate: async () => {
        callOrder.push("deferUpdate");
        interaction.deferred = true;
      },
      editReply: async (payload: any) => {
        callOrder.push("editReply");
        assert.ok(Array.isArray(payload.components), "editReply should include components");
      },
      update: async () => {
        throw new Error("update should not be called in defer+safeReply flow");
      },
      reply: async () => {
        throw new Error("reply should not be called in defer+safeReply flow");
      },
      followUp: async () => {
        throw new Error("followUp should not be called in defer+safeReply flow");
      },
      client: { users: { fetch: async () => null } },
    };

    await command.handleNowPlayingListNotesToggle(interaction);

    assert.deepEqual(callOrder, ["deferUpdate", "editReply"]);
    assert.deepEqual(withActionsArgs, [true]);
  } finally {
    Member.getNowPlaying = originalGetNowPlaying;
  }
});

test("nowplaying notes toggle hide defers then edits reply", async () => {
  const command = new NowPlayingCommand() as any;
  const originalGetNowPlaying = Member.getNowPlaying;
  const withActionsArgs: boolean[] = [];

  try {
    Member.getNowPlaying = (async () => ([
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

    command.buildNowPlayingListPayload = async () => ({
      components: [{ kind: "payload-components" }],
      files: [],
    });
    command.withNowPlayingActions = (
      _includeEdit: boolean,
      _ownerId: string,
      components: any[],
      showNotes: boolean,
    ) => {
      withActionsArgs.push(showNotes);
      return components;
    };

    const interaction: any = {
      customId: "nowplaying-list-notes:123:hide",
      user: { id: "123", username: "Owner", displayName: "Owner" },
      message: { flags: { has: () => true } },
      guildId: null,
      deferred: false,
      replied: false,
      deferUpdate: async () => {
        interaction.deferred = true;
      },
      editReply: async () => {},
      update: async () => {
        throw new Error("update should not be called in defer+safeReply flow");
      },
      reply: async () => {
        throw new Error("reply should not be called in defer+safeReply flow");
      },
      followUp: async () => {
        throw new Error("followUp should not be called in defer+safeReply flow");
      },
      client: { users: { fetch: async () => null } },
    };

    await command.handleNowPlayingListNotesToggle(interaction);

    assert.deepEqual(withActionsArgs, [false]);
  } finally {
    Member.getNowPlaying = originalGetNowPlaying;
  }
});
