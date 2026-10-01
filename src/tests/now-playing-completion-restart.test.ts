import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Game from "../classes/Game.js";
import Member from "../classes/Member.js";
import { persistedSessionStore } from "../services/PersistedInteractionSessionStore.js";
import {
  NowPlayingCompletionHandlers,
} from "../commands/now-playing/nowPlayingCompletion.handler.js";
import {
  nowPlayingCompletionPlatformSessions,
  nowPlayingCompletionWizardSessions,
} from "../commands/now-playing/nowPlayingContexts.js";
import {
  platformSessionFromJson,
  platformSessionToJson,
  wizardSessionFromJson,
} from "../commands/now-playing/nowPlayingCompletionSessions.js";
import type {
  NowPlayingCompletionPlatformSession,
} from "../commands/now-playing/nowPlayingTypes.js";

const OWNER = "123456789012345678";
const OTHER_USER = "876543210987654321";
const GAME_ID = 11;
const PLATFORM_ID = 6;
const WIZARD_ID = `np-comp-ui-${OWNER}`;
const PLATFORM_SESSION_ID = `np-comp-platform-${OWNER}`;

type SavedSession = Parameters<typeof persistedSessionStore.save>[0];

function stubSessionStore(t: TestContext): { saved: SavedSession[]; removed: string[] } {
  const saved: SavedSession[] = [];
  const removed: string[] = [];
  t.mock.method(persistedSessionStore, "save", async (params: SavedSession) => {
    saved.push(params);
    return `row-${params.kind}`;
  });
  t.mock.method(persistedSessionStore, "remove", async (rowId: string) => {
    removed.push(rowId);
  });
  return { saved, removed };
}

function stubNowPlaying(t: TestContext): void {
  t.mock.method(Member, "getNowPlaying", async () => [{
    gameId: GAME_ID,
    title: "Alpha",
    platformId: null,
    platformName: null,
    platformAbbreviation: null,
    note: null,
    threadId: null,
    addedAt: null,
    noteUpdatedAt: null,
    sortOrder: null,
  }]);
  t.mock.method(Game, "getGameById", async () => ({ id: GAME_ID, title: "Alpha", imageData: null }));
}

function simulateBotRestart(): void {
  nowPlayingCompletionWizardSessions.clear();
  nowPlayingCompletionPlatformSessions.clear();
}

function componentInteraction(customId: string, values: string[], userId = OWNER): any {
  const sent: any[] = [];
  const interaction: any = {
    customId,
    values,
    user: { id: userId },
    channelId: "channel-1",
    guildId: null,
    deferred: false,
    replied: false,
    sent,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isRepliable: () => true,
    deferUpdate: async () => {
      interaction.deferred = true;
    },
    update: async (opts: any) => {
      if (interaction.deferred || interaction.replied) {
        const error: any = new Error("already acknowledged");
        error.code = 40060;
        throw error;
      }
      sent.push(opts);
      interaction.replied = true;
    },
    reply: async (opts: any) => {
      sent.push(opts);
      interaction.replied = true;
    },
    editReply: async (opts: any) => {
      sent.push(opts);
    },
    followUp: async (opts: any) => {
      sent.push(opts);
    },
  };
  return interaction;
}

function buildPlatformSession(): NowPlayingCompletionPlatformSession {
  return {
    sessionId: WIZARD_ID,
    userId: OWNER,
    gameId: GAME_ID,
    completionType: "Main Story",
    completedAt: new Date("2026-09-01T00:00:00Z"),
    finalPlaytimeHours: 12,
    note: null,
    removeFromNowPlaying: false,
    announce: false,
    returnToList: false,
    platforms: [{ id: PLATFORM_ID, name: "SNES" }],
  };
}

test("wizard and platform sessions survive a JSON round trip", () => {
  const platform = buildPlatformSession();
  const restored = platformSessionFromJson(
    JSON.parse(JSON.stringify(platformSessionToJson(platform))),
  );
  assert.deepEqual(restored, platform);
  assert.equal(platformSessionFromJson({ ...platform, platforms: "nope" }), null);
  assert.equal(wizardSessionFromJson({ userId: OWNER, gameId: GAME_ID }), null);
});

test("opening the wizard and changing a step persists the current state", async (t) => {
  const { saved } = stubSessionStore(t);
  stubNowPlaying(t);
  const command = new NowPlayingCompletionHandlers() as any;

  await command.handleNowPlayingEditMenuComplete(
    componentInteraction(`nowplaying-edit-menu-complete:${OWNER}`, []),
  );
  await command.handleNowPlayingCompletionTypeSelect(
    componentInteraction(`np-complete-type:${WIZARD_ID}`, ["Main Story + Side Content"]),
  );

  const wizardSaves = saved.filter((entry) => entry.kind === "np-complete");
  assert.ok(wizardSaves.length >= 2, "expected a save on open and on the type change");
  const last = wizardSaves[wizardSaves.length - 1].state as any;
  assert.equal(last.gameId, GAME_ID);
  assert.equal(last.completionType, "Main Story + Side Content");
  assert.equal(wizardSaves[0].location.channelId, "channel-1");
  simulateBotRestart();
});

test("a wizard step after a restart restores the session from the API", async (t) => {
  stubSessionStore(t);
  stubNowPlaying(t);
  simulateBotRestart();
  const load = t.mock.method(persistedSessionStore, "load", async () => ({
    rowId: "row-9",
    state: {
      userId: OWNER,
      gameId: GAME_ID,
      completionType: "Main Story",
      removeFromNowPlaying: true,
      announce: true,
      returnToList: true,
    },
  }));
  const command = new NowPlayingCompletionHandlers() as any;
  const interaction = componentInteraction(`np-complete-announce:${WIZARD_ID}`, ["no"]);

  await command.handleNowPlayingCompletionAnnounceSelect(interaction);

  assert.equal(load.mock.callCount(), 1);
  assert.equal(interaction.deferred, true, "restore should acknowledge before the API read");
  assert.equal(nowPlayingCompletionWizardSessions.get(WIZARD_ID)?.announce, false);
  assert.doesNotMatch(JSON.stringify(interaction.sent), /expired/);
  simulateBotRestart();
});

test("a wizard step with no persisted row says the prompt expired", async (t) => {
  stubSessionStore(t);
  simulateBotRestart();
  t.mock.method(persistedSessionStore, "load", async () => null);
  const command = new NowPlayingCompletionHandlers() as any;
  const interaction = componentInteraction(`np-complete-type:${WIZARD_ID}`, ["Main Story"]);

  await command.handleNowPlayingCompletionTypeSelect(interaction);

  assert.match(JSON.stringify(interaction.sent), /This completion prompt has expired/);
});

test("another member's click is refused before any API read", async (t) => {
  stubSessionStore(t);
  simulateBotRestart();
  const load = t.mock.method(persistedSessionStore, "load", async () => null);
  const command = new NowPlayingCompletionHandlers() as any;
  const interaction = componentInteraction(`np-complete-type:${WIZARD_ID}`, ["Main Story"], OTHER_USER);

  await command.handleNowPlayingCompletionTypeSelect(interaction);

  assert.equal(load.mock.callCount(), 0);
  assert.match(JSON.stringify(interaction.sent), /isn't for you/);
});

test("a platform pick after a restart saves the completion once", async (t) => {
  const { removed } = stubSessionStore(t);
  stubNowPlaying(t);
  simulateBotRestart();
  const platformState = JSON.parse(JSON.stringify(platformSessionToJson(buildPlatformSession())));
  t.mock.method(persistedSessionStore, "load", async (params: { kind: string }) => (
    params.kind === "np-complete-platform"
      ? { rowId: "row-platform", state: platformState }
      : {
        rowId: "row-wizard",
        state: {
          userId: OWNER,
          gameId: GAME_ID,
          completionType: "Main Story",
          removeFromNowPlaying: false,
          announce: false,
          returnToList: false,
        },
      }
  ));
  const addCompletion = t.mock.method(Member, "addCompletion", async () => 1);
  const command = new NowPlayingCompletionHandlers() as any;
  const customId = `np-complete-platform:${PLATFORM_SESSION_ID}`;

  await Promise.all([
    command.handleNowPlayingCompletionPlatformSelect(
      componentInteraction(customId, [String(PLATFORM_ID)]),
    ),
    command.handleNowPlayingCompletionPlatformSelect(
      componentInteraction(customId, [String(PLATFORM_ID)]),
    ),
  ]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(addCompletion.mock.callCount(), 1);
  assert.equal((addCompletion.mock.calls[0].arguments[0] as any).platformId, PLATFORM_ID);
  // The simulated restart keeps earlier tests' row ids in the registry, so only the
  // platform row is checked here.
  assert.ok(removed.includes("row-platform"), "the used platform row is deleted");
});

test("a details modal after a restart with no row fills its deferred reply", async (t) => {
  stubSessionStore(t);
  simulateBotRestart();
  t.mock.method(persistedSessionStore, "load", async () => null);
  const edits: any[] = [];
  const followUps: any[] = [];
  const interaction: any = {
    customId: `nowplaying-complete-modal:${WIZARD_ID}`,
    user: { id: OWNER },
    channelId: "channel-1",
    guildId: null,
    deferred: false,
    replied: false,
    isMessageComponent: () => false,
    isModalSubmit: () => true,
    isRepliable: () => true,
    deferReply: async () => {
      interaction.deferred = true;
    },
    editReply: async (opts: any) => {
      edits.push(opts);
    },
    followUp: async (opts: any) => {
      followUps.push(opts);
    },
    reply: async () => {
      throw new Error("reply should not be called after deferReply");
    },
  };
  const command = new NowPlayingCompletionHandlers() as any;

  await command.handleNowPlayingCompletionModal(interaction);

  assert.equal(followUps.length, 0);
  assert.match(JSON.stringify(edits), /This completion prompt has expired/);
});
