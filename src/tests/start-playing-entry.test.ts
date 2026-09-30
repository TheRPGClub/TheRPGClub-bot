import test from "node:test";
import assert from "node:assert/strict";
import Member from "../classes/Member.js";
import GamePlatformRegionService from "../classes/GamePlatformRegionService.js";
import { startPlayingEntry } from "../commands/now-playing/nowPlayingStart.service.js";
import { buildStartPlayingSelectRow } from "../functions/StartPlayingSelect.js";
import { UserFacingError } from "../utilities/ApiErrorUtils.js";

function buildInteraction(replies: any[]): any {
  return {
    user: { id: "123" },
    guildId: null,
    channelId: null,
    deferred: false,
    replied: false,
    isMessageComponent: () => true,
    reply: async (payload: any) => {
      replies.push(payload);
    },
  };
}

function collectJson(payload: any): string {
  return JSON.stringify(payload.components.map((c: any) => c.toJSON()));
}

test("startPlayingEntry adds an entry with a platform to Now Playing", async () => {
  const originalAdd = Member.addNowPlaying;
  const calls: unknown[][] = [];
  const replies: any[] = [];
  try {
    Member.addNowPlaying = (async (...args: unknown[]) => {
      calls.push(args);
    }) as any;
    await startPlayingEntry(buildInteraction(replies), {
      gameId: 7,
      title: "Alpha",
      platformId: 4,
      platformName: "Switch",
      note: "from backlog",
    });
    assert.deepEqual(calls, [["123", 7, 4, "from backlog"]]);
    assert.equal(replies.length, 1);
    assert.match(collectJson(replies[0]), /Added \*\*Alpha\*\* \(Switch\)/);
  } finally {
    Member.addNowPlaying = originalAdd;
  }
});

test("startPlayingEntry without a platform opens the GameDB platform picker", async () => {
  const originalAdd = Member.addNowPlaying;
  const originalPlatforms = GamePlatformRegionService.getPlatformsForGameWithStandard;
  const replies: any[] = [];
  try {
    Member.addNowPlaying = (async () => {
      throw new Error("addNowPlaying should not be called");
    }) as any;
    GamePlatformRegionService.getPlatformsForGameWithStandard = (async () => ([
      { id: 4, name: "Switch" },
    ])) as any;
    await startPlayingEntry(buildInteraction(replies), {
      gameId: 7,
      title: "Alpha",
      platformId: null,
      platformName: null,
      note: null,
    });
    assert.equal(replies.length, 1);
    assert.match(collectJson(replies[0]), /"custom_id":"gamedb-nowplaying-platform-select:7"/);
  } finally {
    Member.addNowPlaying = originalAdd;
    GamePlatformRegionService.getPlatformsForGameWithStandard = originalPlatforms;
  }
});

test("buildStartPlayingSelectRow uses entry ids as option values", () => {
  const row = buildStartPlayingSelectRow("backlog-start-playing-v1:123", [
    { entryId: 41, label: "1. Alpha", platformName: "Switch" },
    { entryId: 42, label: "2. Beta", platformName: null },
  ]);
  const select: any = row.toJSON().components[0];
  assert.equal(select.custom_id, "backlog-start-playing-v1:123");
  assert.deepEqual(select.options.map((o: any) => o.value), ["41", "42"]);
  assert.equal(select.options[1].description, "No platform");
});

test("startPlayingEntry reports a duplicate without pinging the developers", async () => {
  const originalAdd = Member.addNowPlaying;
  const replies: any[] = [];
  try {
    Member.addNowPlaying = (async () => {
      throw new UserFacingError("That title is already in your Now Playing list.");
    }) as any;
    await startPlayingEntry(buildInteraction(replies), {
      gameId: 7,
      title: "Alpha",
      platformId: 4,
      platformName: "Switch",
      note: null,
    });
    const json = collectJson(replies[0]);
    assert.match(json, /already in your Now Playing list/);
    assert.doesNotMatch(json, /<@&/);
  } finally {
    Member.addNowPlaying = originalAdd;
  }
});
