import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Game from "../classes/Game.js";
import GamePlatformRegionService from "../classes/GamePlatformRegionService.js";
import Member from "../classes/Member.js";
import { persistedSessionStore } from "../services/PersistedInteractionSessionStore.js";
import {
  handleCompletionPlatformSelect,
  promptCompletionPlatformSelection,
} from "../commands/game-completion/completion-platform.service.js";
import {
  completionPlatformContextFromJson,
  completionPlatformContextToJson,
} from "../commands/game-completion/completion-platform-context.codec.js";
import {
  completionPlatformSessions,
  type CompletionPlatformContext,
} from "../commands/game-completion/completion.types.js";

const OWNER = "222222222222222222";
const OTHER_USER = "333333333333333333";
const GAME_ID = 777;
const PLATFORM_ID = 6;

function buildPromptCtx(): Omit<CompletionPlatformContext, "platforms"> {
  return {
    userId: OWNER,
    gameId: GAME_ID,
    gameTitle: "Chrono Trigger",
    completionType: "Main Story",
    completedAt: new Date("2026-09-01T00:00:00Z"),
    finalPlaytimeHours: 22,
    note: null,
    announce: false,
    removeFromNowPlaying: false,
  };
}

function fakeInteraction(extra: Record<string, unknown> = {}): any {
  const sent: any[] = [];
  const interaction: any = {
    user: { id: OWNER },
    channelId: "channel-1",
    guildId: "guild-1",
    replied: false,
    deferred: false,
    sent,
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
    deferUpdate: async () => {
      interaction.deferred = true;
    },
    isMessageComponent: () => false,
    isRepliable: () => true,
    ...extra,
  };
  return interaction;
}

function selectInteraction(customId: string, value: string, userId = OWNER): any {
  return fakeInteraction({
    customId,
    values: [value],
    user: { id: userId },
    isMessageComponent: () => true,
  });
}

type SavedSession = Parameters<typeof persistedSessionStore.save>[0];

function stubSessionStore(t: TestContext): { saved: SavedSession[]; removed: string[] } {
  const saved: SavedSession[] = [];
  const removed: string[] = [];
  t.mock.method(persistedSessionStore, "save", async (params: SavedSession) => {
    saved.push(params);
    return "row-1";
  });
  t.mock.method(persistedSessionStore, "remove", async (rowId: string) => {
    removed.push(rowId);
  });
  return { saved, removed };
}

function stubCompletionSave(t: TestContext): ReturnType<typeof t.mock.method> {
  t.mock.method(Game, "getGameById", async () => ({ id: GAME_ID, title: "Chrono Trigger" }));
  return t.mock.method(Member, "addCompletion", async () => 1);
}

async function openPrompt(t: TestContext): Promise<string> {
  t.mock.method(GamePlatformRegionService, "getPlatformsForGameWithStandard", async () => [
    { id: PLATFORM_ID, name: "SNES" },
  ]);
  const command = fakeInteraction();
  await promptCompletionPlatformSelection(command, buildPromptCtx());
  const match = JSON.stringify(command.sent)
    .match(/"custom_id":"(completion-platform-select:[^"]+)"/);
  if (!match) throw new Error("no platform select custom id was sent");
  return match[1];
}

function sentText(interaction: any): string {
  return JSON.stringify(interaction.sent);
}

test("platform context survives a JSON round trip", () => {
  const ctx: CompletionPlatformContext = {
    ...buildPromptCtx(),
    platforms: [{ id: PLATFORM_ID, name: "SNES" }],
  };
  const restored = completionPlatformContextFromJson(
    JSON.parse(JSON.stringify(completionPlatformContextToJson(ctx))),
  );
  assert.deepEqual(restored, ctx);
  assert.equal(completionPlatformContextFromJson({ ...ctx, platforms: "nope" }), null);
});

test("platform prompt persists its session with the owner and channel", async (t) => {
  const { saved } = stubSessionStore(t);
  await openPrompt(t);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].kind, "completion-platform");
  assert.equal(saved[0].ownerId, OWNER);
  assert.deepEqual(saved[0].location, { channelId: "channel-1", guildId: "guild-1" });
  completionPlatformSessions.clear();
});

test("platform pick after a restart restores the session and saves", async (t) => {
  const { saved, removed } = stubSessionStore(t);
  const customId = await openPrompt(t);
  const state = JSON.parse(JSON.stringify(saved[0].state));
  completionPlatformSessions.clear();
  const load = t.mock.method(persistedSessionStore, "load", async () => ({
    rowId: "row-9",
    state,
  }));
  const addCompletion = stubCompletionSave(t);

  const select = selectInteraction(customId, String(PLATFORM_ID));
  await handleCompletionPlatformSelect(select);

  assert.equal(load.mock.callCount(), 1);
  assert.equal(addCompletion.mock.callCount(), 1);
  const args = addCompletion.mock.calls[0].arguments[0] as any;
  assert.equal(args.platformId, PLATFORM_ID);
  assert.equal(args.completedAt.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.match(sentText(select), /Logged completion/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(removed, ["row-9"]);
});

test("platform pick with no persisted row says the prompt expired", async (t) => {
  stubSessionStore(t);
  const customId = await openPrompt(t);
  completionPlatformSessions.clear();
  t.mock.method(persistedSessionStore, "load", async () => null);
  const addCompletion = stubCompletionSave(t);

  const select = selectInteraction(customId, String(PLATFORM_ID));
  await handleCompletionPlatformSelect(select);

  assert.equal(addCompletion.mock.callCount(), 0);
  assert.match(sentText(select), /This completion prompt has expired/);
});

test("platform pick by another user is refused before any API read", async (t) => {
  stubSessionStore(t);
  const customId = await openPrompt(t);
  completionPlatformSessions.clear();
  const load = t.mock.method(persistedSessionStore, "load", async () => null);

  const select = selectInteraction(customId, String(PLATFORM_ID), OTHER_USER);
  await handleCompletionPlatformSelect(select);

  assert.equal(load.mock.callCount(), 0);
  assert.match(sentText(select), /isn't for you/);
});

test("a double pick saves the completion once", async (t) => {
  stubSessionStore(t);
  const customId = await openPrompt(t);
  const addCompletion = stubCompletionSave(t);

  await Promise.all([
    handleCompletionPlatformSelect(selectInteraction(customId, String(PLATFORM_ID))),
    handleCompletionPlatformSelect(selectInteraction(customId, String(PLATFORM_ID))),
  ]);

  assert.equal(addCompletion.mock.callCount(), 1);
});
