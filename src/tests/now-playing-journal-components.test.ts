import assert from "node:assert/strict";
import test from "node:test";
import { NowPlayingCommand } from "../commands/now-playing.command.js";
import type { IMemberNowPlayingEntry } from "../classes/Member.js";
import Member from "../classes/Member.js";
import Game from "../classes/Game.js";

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
  const originalGetPref = Member.getGameJournalPreference;
  const originalCount = Member.countGameJournalEntries;
  const originalEntries = Member.getGameJournalEntries;

  try {
    Game.getGameById = (async () => ({ id: 1, title: "Test Game" })) as any;
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

    const components = await command.buildJournalComponents("123", "123", 1, 1);
    const json = components.map((component: any) => component.toJSON());
    const customIds = JSON.stringify(json).match(/"custom_id":"([^"]+)"/g) ?? [];
    const unique = new Set(customIds);
    assert.equal(customIds.length, unique.size);
  } finally {
    Game.getGameById = originalGetGameById;
    Member.getGameJournalPreference = originalGetPref;
    Member.countGameJournalEntries = originalCount;
    Member.getGameJournalEntries = originalEntries;
  }
});
