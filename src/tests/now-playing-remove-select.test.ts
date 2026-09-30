import test from "node:test";
import assert from "node:assert/strict";
import { NowPlayingRemoveHandlers } from "../commands/now-playing/nowPlayingRemove.handler.js";
import Member from "../classes/Member.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

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
      // discord.js marks the interaction replied once update() resolves.
      update: async (payload: any) => {
        updates.push(payload);
        interaction.replied = true;
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
    assert.equal(edits[0]?.flags, COMPONENTS_V2_FLAG, "editReply should keep Components V2");
    assert.deepEqual(edits[0]?.attachments, [], "editReply should drop stale attachments");
  } finally {
    Member.removeNowPlaying = originalRemoveNowPlaying;
    Member.getNowPlaying = originalGetNowPlaying;
  }
});

test("nowplaying remove select acknowledges interaction and shows error on failed removal", async () => {
  const command = new NowPlayingRemoveHandlers() as any;

  const originalRemoveNowPlaying = Member.removeNowPlaying;
  const originalGetNowPlaying = Member.getNowPlaying;

  const updates: any[] = [];
  const edits: any[] = [];

  try {
    Member.removeNowPlaying = (async () => false) as any;
    Member.getNowPlaying = (async () => ([
      { gameId: 11, title: "Alpha", platformName: "Switch", platformAbbreviation: "NS" },
    ])) as any;

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
      // discord.js marks the interaction replied once update() resolves.
      update: async (payload: any) => {
        updates.push(payload);
        interaction.replied = true;
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
    assert.equal(edits.length, 1, "expected the redrawn remove screen via editReply");
    const rendered = JSON.stringify(edits[0]?.components);
    assert.match(rendered, /Failed to remove that game/, "error notice should show");
    assert.match(rendered, /nowplaying-remove-select:123/, "remove select should stay usable");
  } finally {
    Member.removeNowPlaying = originalRemoveNowPlaying;
    Member.getNowPlaying = originalGetNowPlaying;
  }
});

test("nowplaying remove select redraws in place and follows up with the error when the removal throws", async () => {
  const command = new NowPlayingRemoveHandlers() as any;

  const originalRemoveNowPlaying = Member.removeNowPlaying;
  const originalGetNowPlaying = Member.getNowPlaying;

  const edits: any[] = [];
  const followUps: any[] = [];

  try {
    Member.removeNowPlaying = (async () => {
      throw new Error("delete exploded");
    }) as any;
    Member.getNowPlaying = (async () => ([
      { gameId: 11, title: "Alpha", platformName: "Switch", platformAbbreviation: "NS" },
    ])) as any;

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
      update: async () => {
        interaction.replied = true;
      },
      editReply: async (payload: any) => {
        edits.push(payload);
      },
      reply: async () => {
        throw new Error("reply should not be called on the error path");
      },
      followUp: async (payload: any) => {
        followUps.push(payload);
      },
    };

    await command.handleNowPlayingRemoveSelect(interaction);

    assert.equal(edits.length, 1, "expected the redrawn remove screen via editReply");
    const rendered = JSON.stringify(edits[0]?.components);
    assert.match(rendered, /nowplaying-remove-select:123/, "remove select should stay usable");
    assert.equal(followUps.length, 1, "expected the API error as an ephemeral follow-up");
    const error = JSON.stringify(followUps[0]?.components);
    assert.match(error, /Could not remove from Now Playing/, "error label should show");
    assert.match(error, /delete exploded/, "error should carry the cause");
  } finally {
    Member.removeNowPlaying = originalRemoveNowPlaying;
    Member.getNowPlaying = originalGetNowPlaying;
  }
});

test("nowplaying remove select labels a redraw failure after a successful removal", async () => {
  const command = new NowPlayingRemoveHandlers() as any;

  const originalRemoveNowPlaying = Member.removeNowPlaying;
  const originalGetNowPlaying = Member.getNowPlaying;

  const edits: any[] = [];

  try {
    Member.removeNowPlaying = (async () => true) as any;
    Member.getNowPlaying = (async () => {
      throw new Error("list exploded");
    }) as any;
    command.refreshNowPlayingListFromContext = async () => true;

    const interaction: any = {
      customId: "nowplaying-remove-select:123",
      isMessageComponent: () => true,
      user: { id: "123" },
      values: ["11"],
      guildId: null,
      client: { channels: { fetch: async () => null } },
      message: {
        flags: { has: () => false },
      },
      deferred: false,
      replied: false,
      update: async () => {
        interaction.replied = true;
      },
      editReply: async (payload: any) => {
        edits.push(payload);
      },
    };

    await command.handleNowPlayingRemoveSelect(interaction);

    assert.equal(edits.length, 1, "expected the redraw error via editReply");
    const rendered = JSON.stringify(edits[0]?.components);
    assert.match(rendered, /Could not reload the remove screen/, "redraw error should show");
    assert.doesNotMatch(rendered, /Could not remove from Now Playing/, "removal succeeded");
  } finally {
    Member.removeNowPlaying = originalRemoveNowPlaying;
    Member.getNowPlaying = originalGetNowPlaying;
  }
});
