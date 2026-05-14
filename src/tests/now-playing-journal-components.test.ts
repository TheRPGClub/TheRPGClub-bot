import assert from "node:assert/strict";
import test from "node:test";
import { NowPlayingCommand } from "../commands/now-playing.command.js";
import type { IMemberNowPlayingEntry } from "../classes/Member.js";
import Member from "../classes/Member.js";
import Game from "../classes/Game.js";

function collectBuilderField(value: unknown, key: "content" | "custom_id"): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const objectNode = node as {
      data?: Record<string, unknown>;
      components?: unknown[];
      custom_id?: unknown;
      customId?: unknown;
      content?: unknown;
    };
    const candidate = objectNode.data?.[key] ??
      (key === "custom_id" ? objectNode.data?.customId : undefined) ??
      (key === "custom_id" ? objectNode.custom_id ?? objectNode.customId : objectNode.content);
    if (typeof candidate === "string") {
      found.push(candidate);
    }
    if (Array.isArray(objectNode.components)) {
      for (const child of objectNode.components) {
        visit(child);
      }
    }
  };
  visit(value);
  return found;
}

test("now-playing list components serialize with mixed journal-enabled entries", () => {
  const command = new NowPlayingCommand() as any;
  const entries: IMemberNowPlayingEntry[] = [{
    gameId: 101,
    title: "Journal Enabled Game",
    platformId: null,
    platformName: "PC",
    platformAbbreviation: "PC",
    threadId: null,
    note: "Legacy note",
    addedAt: null,
    noteUpdatedAt: null,
    sortOrder: null,
    journalEnabled: true,
    hasPublicJournalEntry: true,
  }, {
    gameId: 102,
    title: "Notes Only Game",
    platformId: null,
    platformName: "Switch",
    platformAbbreviation: "NS",
    threadId: null,
    note: "Visible note",
    addedAt: null,
    noteUpdatedAt: null,
    sortOrder: null,
    journalEnabled: false,
    hasPublicJournalEntry: false,
  }];

  const components = command.buildNowPlayingEntryComponents(
    "Your Now Playing List",
    entries,
    "123456789012345678",
    null,
    null,
    true,
  );

  assert.equal(Array.isArray(components), true);
  assert.equal(components.length > 0, true);
  assert.doesNotThrow(() => {
    for (const component of components) {
      (component as any).toJSON();
    }
  });
});

test("owner list shows journal buttons for multiple journal-enabled entries", () => {
  const command = new NowPlayingCommand() as any;
  command.canUseJournalFeature = () => true;
  const entries: IMemberNowPlayingEntry[] = [{
    gameId: 201,
    title: "Journal Entry One",
    platformId: null,
    platformName: "PC",
    platformAbbreviation: "PC",
    threadId: null,
    note: null,
    addedAt: null,
    noteUpdatedAt: null,
    sortOrder: null,
    journalEnabled: true,
    hasPublicJournalEntry: false,
  }, {
    gameId: 202,
    title: "Journal Entry Two",
    platformId: null,
    platformName: "Switch",
    platformAbbreviation: "NS",
    threadId: null,
    note: null,
    addedAt: null,
    noteUpdatedAt: null,
    sortOrder: null,
    journalEnabled: true,
    hasPublicJournalEntry: true,
  }];

  const components = command.buildNowPlayingEntryComponents(
    "Your Now Playing List",
    entries,
    "123456789012345678",
    null,
    null,
    false,
    true,
  );
  const json = JSON.stringify(components.map((component: any) => component.toJSON()));
  const journalButtons = json.match(/nowplaying-journal-open:/g) ?? [];
  assert.equal(journalButtons.length, 2);
});

test("owner list with 10 entries stays serializable and keeps journal buttons", () => {
  const command = new NowPlayingCommand() as any;
  command.canUseJournalFeature = () => true;
  const entries: IMemberNowPlayingEntry[] = Array.from({ length: 10 }, (_, index) => ({
    gameId: 300 + index,
    title: `Journal Entry ${index + 1}`,
    platformId: null,
    platformName: "PC",
    platformAbbreviation: "PC",
    threadId: null,
    note: null,
    addedAt: null,
    noteUpdatedAt: null,
    sortOrder: null,
    journalEnabled: true,
    hasPublicJournalEntry: false,
  }));

  const components = command.buildNowPlayingEntryComponents(
    "Your Now Playing List",
    entries,
    "123456789012345678",
    null,
    null,
    false,
    true,
  );
  assert.doesNotThrow(() => {
    for (const component of components) {
      (component as any).toJSON();
    }
  });
  const json = JSON.stringify(components.map((component: any) => component.toJSON()));
  const journalButtons = json.match(/nowplaying-journal-open:/g) ?? [];
  assert.equal(journalButtons.length, 10);
});

test("journal pager uses unique custom ids when only one page exists", async () => {
  const command = new NowPlayingCommand() as any;
  const originalGetGameById = Game.getGameById;
  const originalGetByUserId = Member.getByUserId;
  const originalGetMeta = Member.getNowPlayingEntryMeta;
  const originalGetCompletions = Member.getCompletionsForGame;
  const originalGetPref = Member.getGameJournalPreference;
  const originalCount = Member.countGameJournalEntries;
  const originalEntries = Member.getGameJournalEntries;

  try {
    Game.getGameById = (async () => ({ id: 1, title: "Test Game" })) as any;
    Member.getByUserId = (async () => ({ globalName: "owner", username: "owner" })) as any;
    Member.getNowPlayingEntryMeta = (async () => null) as any;
    Member.getCompletionsForGame = (async () => []) as any;
    Member.getGameJournalPreference = (async () => ({
      userId: "123",
      gameId: 1,
      isEnabled: true,
      defaultIsPublic: false,
    })) as any;
    Member.countGameJournalEntries = (async () => 1) as any;
    Member.getGameJournalEntries = (async () => ([{
      entryId: 10,
      userId: "123",
      gameId: 1,
      title: "Entry",
      body: "Body",
      isPublic: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }])) as any;

    const payload = await command.buildJournalComponents("123", "123", 1, 1);
    const customIds = collectBuilderField(payload.components, "custom_id");
    const unique = new Set(customIds);
    assert.equal(customIds.length, unique.size);
  } finally {
    Game.getGameById = originalGetGameById;
    Member.getByUserId = originalGetByUserId;
    Member.getNowPlayingEntryMeta = originalGetMeta;
    Member.getCompletionsForGame = originalGetCompletions;
    Member.getGameJournalPreference = originalGetPref;
    Member.countGameJournalEntries = originalCount;
    Member.getGameJournalEntries = originalEntries;
  }
});

test("journal public view redacts private entry content and count", async () => {
  const command = new NowPlayingCommand() as any;
  const originalGetGameById = Game.getGameById;
  const originalGetByUserId = Member.getByUserId;
  const originalGetMeta = Member.getNowPlayingEntryMeta;
  const originalGetCompletions = Member.getCompletionsForGame;
  const originalGetPref = Member.getGameJournalPreference;
  const originalCount = Member.countGameJournalEntries;
  const originalEntries = Member.getGameJournalEntries;
  let countViewerArg: string | null | undefined;
  let entriesViewerArg: string | null | undefined;

  try {
    Game.getGameById = (async () => ({ id: 1, title: "Pragmata" })) as any;
    Member.getByUserId = (async () => ({ globalName: "merph518", username: "merph518" })) as any;
    Member.getNowPlayingEntryMeta = (async () => ({ addedAt: new Date("2026-05-07T00:00:00.000Z") })) as any;
    Member.getCompletionsForGame = (async () => []) as any;
    Member.getGameJournalPreference = (async () => ({
      userId: "123",
      gameId: 1,
      isEnabled: true,
      defaultIsPublic: false,
    })) as any;
    Member.countGameJournalEntries = (async (_userId: string, _gameId: number, viewerUserId?: string | null) => {
      countViewerArg = viewerUserId;
      return 1;
    }) as any;
    Member.getGameJournalEntries = (async (_userId: string, _gameId: number, params?: {
      viewerUserId?: string | null;
    }) => {
      entriesViewerArg = params?.viewerUserId;
      return [{
      entryId: 10,
      userId: "123",
      gameId: 1,
      title: "Testing a Private Entry",
      body: "This text should not render.",
      isPublic: false,
      createdAt: new Date("2026-05-11T00:00:00.000Z"),
      updatedAt: new Date("2026-05-11T00:00:00.000Z"),
    }, {
      entryId: 11,
      userId: "123",
      gameId: 1,
      title: "Finally",
      body: "5 hours played.",
      isPublic: true,
      createdAt: new Date("2026-05-11T00:00:00.000Z"),
      updatedAt: new Date("2026-05-11T00:00:00.000Z"),
    }];
    }) as any;

    const payload = await command.buildJournalComponents("123", "__public__", 1, 1);
    assert.ok(payload.components.length > 0);
    assert.equal(countViewerArg, "__public__");
    assert.equal(entriesViewerArg, "__public__");
  } finally {
    Game.getGameById = originalGetGameById;
    Member.getByUserId = originalGetByUserId;
    Member.getNowPlayingEntryMeta = originalGetMeta;
    Member.getCompletionsForGame = originalGetCompletions;
    Member.getGameJournalPreference = originalGetPref;
    Member.countGameJournalEntries = originalCount;
    Member.getGameJournalEntries = originalEntries;
  }
});

test("journal edit modal submit from guild context re-renders redacted private entry", async () => {
  const command = new NowPlayingCommand() as any;
  command.canUseJournalFeature = () => true;

  const originalGetEntry = Member.getGameJournalEntryForUser;
  const originalUpdateEntry = Member.updateGameJournalEntry;
  const originalGetGameById = Game.getGameById;
  const originalGetByUserId = Member.getByUserId;
  const originalGetMeta = Member.getNowPlayingEntryMeta;
  const originalGetCompletions = Member.getCompletionsForGame;
  const originalGetPref = Member.getGameJournalPreference;
  const originalCount = Member.countGameJournalEntries;
  const originalEntries = Member.getGameJournalEntries;

  let replyPayload: any = null;
  let renderViewerId: string | null = null;

  try {
    Member.getGameJournalEntryForUser = (async () => ({
      entryId: 10,
      userId: "123",
      gameId: 1,
      title: "Private Edit",
      body: "Top secret body.",
      isPublic: false,
      createdAt: new Date("2026-05-11T00:00:00.000Z"),
      updatedAt: new Date("2026-05-11T00:00:00.000Z"),
    })) as any;
    Member.updateGameJournalEntry = (async () => {}) as any;
    Game.getGameById = (async () => ({ id: 1, title: "Pragmata" })) as any;
    Member.getByUserId = (async () => ({ globalName: "merph518", username: "merph518" })) as any;
    Member.getNowPlayingEntryMeta = (async () => null) as any;
    Member.getCompletionsForGame = (async () => []) as any;
    Member.getGameJournalPreference = (async () => ({
      userId: "123",
      gameId: 1,
      isEnabled: true,
      defaultIsPublic: false,
    })) as any;
    Member.countGameJournalEntries = (async () => 1) as any;
    Member.getGameJournalEntries = (async () => ([{
      entryId: 10,
      userId: "123",
      gameId: 1,
      title: "Private Edit",
      body: "Top secret body.",
      isPublic: false,
      createdAt: new Date("2026-05-11T00:00:00.000Z"),
      updatedAt: new Date("2026-05-11T00:00:00.000Z"),
    }])) as any;
    const originalBuildJournalComponents = command.buildJournalComponents;
    command.buildJournalComponents = async (
      ownerId: string,
      viewerId: string,
      gameId: number,
      page: number,
    ) => {
      renderViewerId = viewerId;
      return originalBuildJournalComponents.call(command, ownerId, viewerId, gameId, page);
    };

    const interaction: any = {
      customId: "nowplaying-journal-edit-modal:123:1:1:10",
      user: { id: "123" },
      guildId: "987654321",
      deferred: false,
      replied: false,
      fields: {
        getTextInputValue: (id: string) => {
          if (id === "nowplaying-journal-title") return "Private Edit";
          if (id === "nowplaying-journal-body") return "Top secret body.";
          return "";
        },
      },
      components: [{
        components: [{ customId: "nowplaying-journal-privacy", value: "private" }],
      }],
      reply: async (payload: any) => {
        replyPayload = payload;
      },
      followUp: async () => null,
      editReply: async () => null,
    };

    await command.handleNowPlayingJournalEditModal(interaction);

    assert.equal(renderViewerId, "__public__");
    assert.ok(replyPayload);
  } finally {
    Member.getGameJournalEntryForUser = originalGetEntry;
    Member.updateGameJournalEntry = originalUpdateEntry;
    Game.getGameById = originalGetGameById;
    Member.getByUserId = originalGetByUserId;
    Member.getNowPlayingEntryMeta = originalGetMeta;
    Member.getCompletionsForGame = originalGetCompletions;
    Member.getGameJournalPreference = originalGetPref;
    Member.countGameJournalEntries = originalCount;
    Member.getGameJournalEntries = originalEntries;
  }
});

test("journal edit modal submit from DM context keeps private body visible to owner", async () => {
  const command = new NowPlayingCommand() as any;
  command.canUseJournalFeature = () => true;

  const originalGetEntry = Member.getGameJournalEntryForUser;
  const originalUpdateEntry = Member.updateGameJournalEntry;
  const originalGetGameById = Game.getGameById;
  const originalGetByUserId = Member.getByUserId;
  const originalGetMeta = Member.getNowPlayingEntryMeta;
  const originalGetCompletions = Member.getCompletionsForGame;
  const originalGetPref = Member.getGameJournalPreference;
  const originalCount = Member.countGameJournalEntries;
  const originalEntries = Member.getGameJournalEntries;

  let replyPayload: any = null;
  let renderViewerId: string | null = null;

  try {
    Member.getGameJournalEntryForUser = (async () => ({
      entryId: 10,
      userId: "123",
      gameId: 1,
      title: "Private Edit",
      body: "Top secret body.",
      isPublic: false,
      createdAt: new Date("2026-05-11T00:00:00.000Z"),
      updatedAt: new Date("2026-05-11T00:00:00.000Z"),
    })) as any;
    Member.updateGameJournalEntry = (async () => {}) as any;
    Game.getGameById = (async () => ({ id: 1, title: "Pragmata" })) as any;
    Member.getByUserId = (async () => ({ globalName: "merph518", username: "merph518" })) as any;
    Member.getNowPlayingEntryMeta = (async () => null) as any;
    Member.getCompletionsForGame = (async () => []) as any;
    Member.getGameJournalPreference = (async () => ({
      userId: "123",
      gameId: 1,
      isEnabled: true,
      defaultIsPublic: false,
    })) as any;
    Member.countGameJournalEntries = (async () => 1) as any;
    Member.getGameJournalEntries = (async () => ([{
      entryId: 10,
      userId: "123",
      gameId: 1,
      title: "Private Edit",
      body: "Top secret body.",
      isPublic: false,
      createdAt: new Date("2026-05-11T00:00:00.000Z"),
      updatedAt: new Date("2026-05-11T00:00:00.000Z"),
    }])) as any;
    const originalBuildJournalComponents = command.buildJournalComponents;
    command.buildJournalComponents = async (
      ownerId: string,
      viewerId: string,
      gameId: number,
      page: number,
    ) => {
      renderViewerId = viewerId;
      return originalBuildJournalComponents.call(command, ownerId, viewerId, gameId, page);
    };

    const interaction: any = {
      customId: "nowplaying-journal-edit-modal:123:1:1:10",
      user: { id: "123" },
      guildId: null,
      deferred: false,
      replied: false,
      fields: {
        getTextInputValue: (id: string) => {
          if (id === "nowplaying-journal-title") return "Private Edit";
          if (id === "nowplaying-journal-body") return "Top secret body.";
          return "";
        },
      },
      components: [{
        components: [{ customId: "nowplaying-journal-privacy", value: "private" }],
      }],
      reply: async (payload: any) => {
        replyPayload = payload;
      },
      followUp: async () => null,
      editReply: async () => null,
    };

    await command.handleNowPlayingJournalEditModal(interaction);

    assert.equal(renderViewerId, "123");
    assert.ok(replyPayload);
  } finally {
    Member.getGameJournalEntryForUser = originalGetEntry;
    Member.updateGameJournalEntry = originalUpdateEntry;
    Game.getGameById = originalGetGameById;
    Member.getByUserId = originalGetByUserId;
    Member.getNowPlayingEntryMeta = originalGetMeta;
    Member.getCompletionsForGame = originalGetCompletions;
    Member.getGameJournalPreference = originalGetPref;
    Member.countGameJournalEntries = originalCount;
    Member.getGameJournalEntries = originalEntries;
  }
});

test("journal edit select in guild deletes prompt message after opening modal", async () => {
  const command = new NowPlayingCommand() as any;
  command.canUseJournalFeature = () => true;

  const originalGetEntry = Member.getGameJournalEntryForUser;
  let deleted = false;
  let showModalCalled = false;

  try {
    Member.getGameJournalEntryForUser = (async () => ({
      entryId: 10,
      userId: "123",
      gameId: 1,
      title: "Private Edit",
      body: "Top secret body.",
      isPublic: false,
      createdAt: new Date("2026-05-11T00:00:00.000Z"),
      updatedAt: new Date("2026-05-11T00:00:00.000Z"),
    })) as any;

    const interaction: any = {
      customId: "nowplaying-journal-edit-select:123:1:1",
      user: { id: "123" },
      guildId: "987654321",
      values: ["10"],
      showModal: async () => {
        showModalCalled = true;
      },
      message: {
        delete: async () => {
          deleted = true;
        },
      },
    };

    await command.handleNowPlayingJournalEditSelect(interaction);
    assert.equal(showModalCalled, true);
    assert.equal(deleted, true);
  } finally {
    Member.getGameJournalEntryForUser = originalGetEntry;
  }
});
