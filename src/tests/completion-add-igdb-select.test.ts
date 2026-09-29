import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import { MessageFlags } from "discord.js";
import Game from "../classes/Game.js";
import Member from "../classes/Member.js";
import { igdbService } from "../services/IGDB/IgdbService.js";
import { handleIgdbSelectInteraction } from "../services/IGDB/IgdbSelectService.js";
import { persistedSessionStore } from "../services/PersistedInteractionSessionStore.js";
import { promptIgdbSelection } from "../commands/game-completion/completion-add.service.js";
import type { CompletionAddContext } from "../commands/game-completion/completion.types.js";

const OWNER = "222222222222222222";
const IGDB_ID = 4242;
const GAME_ID = 777;

function buildCtx(): CompletionAddContext {
  return {
    userId: OWNER,
    completionType: "Main Story + Side Content",
    completedAt: new Date("2026-09-01T00:00:00Z"),
    finalPlaytimeHours: 10,
    selectedPlatformId: 4,
    note: null,
    source: "igdb",
    query: "Pokemon Infinity",
    announce: false,
  };
}

function fakeInteraction(extra: Record<string, unknown> = {}): any {
  const sent: any[] = [];
  const interaction: any = {
    user: { id: OWNER },
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
    update: async (opts: any) => {
      sent.push(opts);
      interaction.replied = true;
    },
    isMessageComponent: () => false,
    isRepliable: () => true,
    ...extra,
  };
  return interaction;
}

function findIgdbSelectId(sent: any[]): string {
  const json = JSON.stringify(sent);
  const match = json.match(/"custom_id":"(igdb-select:[^"]+)"/);
  if (!match) throw new Error("no igdb-select custom id was sent");
  return match[1];
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

function simulateBotRestart(): void {
  const store = (globalThis as any)[Symbol.for("igdbSelectSessions")] as Map<string, unknown>;
  store.clear();
}

async function openIgdbPrompt(t: TestContext): Promise<string> {
  if (!(persistedSessionStore.save as any).mock) stubSessionStore(t);
  t.mock.method(igdbService, "searchGames", async () => ({
    results: [
      { id: 1, name: "Pokemon Mystery Dungeon: Gates to Infinity", summary: "" },
      { id: IGDB_ID, name: "Pokemon Infinity Fan Game", summary: "" },
    ],
  }));
  const command = fakeInteraction();
  await promptIgdbSelection(command, "Pokemon Infinity", buildCtx());
  return findIgdbSelectId(command.sent);
}

function selectInteraction(customId: string): any {
  return fakeInteraction({
    customId,
    values: [String(IGDB_ID)],
    isMessageComponent: () => true,
  });
}

test("picking an IGDB result records the completion with the command options", async (t) => {
  const customId = await openIgdbPrompt(t);
  const game = { id: GAME_ID, title: "Pokemon Infinity Fan Game" };
  const createGame = t.mock.method(Game, "createGame", async () => game);
  t.mock.method(Game, "getGameById", async () => game);
  t.mock.method(Member, "getRecentCompletionForGame", async () => null);
  t.mock.method(Member, "getNowPlayingEntryMeta", async () => null);
  const addCompletion = t.mock.method(Member, "addCompletion", async () => 1);

  const select = selectInteraction(customId);
  const handled = await handleIgdbSelectInteraction(select);

  assert.equal(handled, true);
  assert.equal(createGame.mock.calls[0].arguments[0], IGDB_ID);
  assert.equal(addCompletion.mock.callCount(), 1);
  const saved: any = addCompletion.mock.calls[0].arguments[0];
  assert.equal(saved.userId, OWNER);
  assert.equal(saved.gameId, GAME_ID);
  assert.equal(saved.platformId, 4);
  assert.equal(saved.completionType, "Main Story + Side Content");
  assert.equal(saved.finalPlaytimeHours, 10);
  assert.match(JSON.stringify(select.sent), /Logged completion/);
});

test("an IGDB import failure surfaces the full request and response", async (t) => {
  const customId = await openIgdbPrompt(t);
  const request = { method: "post", url: "/api/v1/games", data: `{"igdb_id":${IGDB_ID}}` };
  const response: any = {
    status: 422,
    data: { error: "Title has already been taken" },
    headers: {},
    statusText: "Unprocessable Entity",
    config: { headers: new AxiosHeaders() },
  };
  t.mock.method(Game, "createGame", async () => {
    throw new AxiosError("Request failed", "ERR_BAD_REQUEST", request as any, null, response);
  });
  t.mock.method(console, "error", () => undefined);

  const select = selectInteraction(customId);
  await handleIgdbSelectInteraction(select);

  const text = JSON.stringify(select.sent);
  assert.match(text, /Failed to add completion/);
  assert.match(text, /api\/v1\/games/);
  assert.match(text, /igdb_id/);
  assert.match(text, /422/);
  assert.match(text, /already been taken/);
  const errorReply = select.sent.find(
    (m: any) => /Failed to add completion/.test(JSON.stringify(m)),
  );
  assert.ok(errorReply.flags & MessageFlags.Ephemeral, "error reply must stay ephemeral");
});

test("an IGDB pick after a bot restart completes the original completion", async (t) => {
  const { saved, removed } = stubSessionStore(t);
  const customId = await openIgdbPrompt(t);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].kind, "igdb-select");
  assert.equal(saved[0].ownerId, OWNER);

  simulateBotRestart();
  const load = t.mock.method(persistedSessionStore, "load", async (params: any) => {
    assert.equal(params.sessionId, saved[0].sessionId);
    assert.equal(params.ownerId, OWNER);
    return { rowId: "row-1", state: JSON.parse(JSON.stringify(saved[0].state)) };
  });
  const game = { id: GAME_ID, title: "Pokemon Infinity Fan Game" };
  t.mock.method(Game, "createGame", async () => game);
  t.mock.method(Game, "getGameById", async () => game);
  t.mock.method(Member, "getRecentCompletionForGame", async () => null);
  t.mock.method(Member, "getNowPlayingEntryMeta", async () => null);
  const addCompletion = t.mock.method(Member, "addCompletion", async () => 1);

  const select = selectInteraction(customId);
  const handled = await handleIgdbSelectInteraction(select);

  assert.equal(handled, true);
  assert.equal(load.mock.callCount(), 1);
  assert.equal(addCompletion.mock.callCount(), 1);
  const completion: any = addCompletion.mock.calls[0].arguments[0];
  assert.equal(completion.userId, OWNER);
  assert.equal(completion.gameId, GAME_ID);
  assert.equal(completion.platformId, 4);
  assert.equal(completion.completionType, "Main Story + Side Content");
  assert.equal(completion.finalPlaytimeHours, 10);
  assert.equal(new Date(completion.completedAt).toISOString(), "2026-09-01T00:00:00.000Z");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(removed, ["row-1"], "the persisted row is deleted once used");
});

test("a restart with no persisted session still replies with the expired notice", async (t) => {
  stubSessionStore(t);
  const customId = await openIgdbPrompt(t);
  simulateBotRestart();
  t.mock.method(persistedSessionStore, "load", async () => null);

  const select = selectInteraction(customId);
  const handled = await handleIgdbSelectInteraction(select);

  assert.equal(handled, true);
  assert.match(JSON.stringify(select.sent), /has expired/);
});

test("an API failure while restoring a session shows the request and response", async (t) => {
  stubSessionStore(t);
  const customId = await openIgdbPrompt(t);
  simulateBotRestart();
  const request = { method: "get", url: "/api/v1/users/1/wizard_sessions" };
  const response: any = {
    status: 500,
    data: { error: "boom" },
    headers: {},
    statusText: "Internal Server Error",
    config: { headers: new AxiosHeaders() },
  };
  t.mock.method(persistedSessionStore, "load", async () => {
    throw new AxiosError("Request failed", "ERR_BAD_RESPONSE", request as any, null, response);
  });
  t.mock.method(console, "error", () => undefined);

  const select = selectInteraction(customId);
  await handleIgdbSelectInteraction(select);

  const text = JSON.stringify(select.sent);
  assert.match(text, /Could not restore this game selection/);
  assert.match(text, /wizard_sessions/);
  assert.match(text, /500/);
});
