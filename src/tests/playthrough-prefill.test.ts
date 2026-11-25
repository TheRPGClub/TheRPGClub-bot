import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Game from "../classes/Game.js";
import Member from "../classes/Member.js";
import {
  createCompletionSession,
  handleCompletionAddSelect,
} from "../commands/game-completion/completion-add.service.js";
import {
  playthroughMinutesToHours,
  playthroughPrefill,
  prefillHoursFromPlaytime,
  prefillInputValue,
} from "../services/PlaythroughPrefill.js";
import { buildCompletionDetailsModal } from "../commands/gamedb/gamedb-completion.command.js";
import {
  NowPlayingCompletionHandlers,
} from "../commands/now-playing/nowPlayingCompletion.handler.js";
import { nowPlayingCompletionWizardSessions } from "../commands/now-playing/nowPlayingContexts.js";
import { persistedSessionStore } from "../services/PersistedInteractionSessionStore.js";

// Final playtime prefill from the open Playthrough (bot#1573): /game-completion add, the
// gamedb completion modal and the Now Playing complete modal.

const MEMBER = "123456789012345678";
const GAME_ID = 42;

function playtimeDoc(playthrough: { minutes: number } | null): any {
  return { user_id: MEMBER, game_id: GAME_ID, total_minutes: 900, playthrough };
}

function inputs(modalJson: any): any[] {
  return modalJson.components.map((label: any) => ({
    label: label.label,
    ...label.component,
  }));
}

test("Playthrough minutes become hours with 2 decimals, as the API fills them", () => {
  assert.equal(playthroughMinutesToHours(90), 1.5);
  assert.equal(playthroughMinutesToHours(100), 1.67);
  assert.equal(playthroughMinutesToHours(0), 0);
});

test("the prefill is the open Playthrough's time, or nothing when none is open", () => {
  assert.equal(prefillHoursFromPlaytime(playtimeDoc({ minutes: 750 })), 12.5);
  assert.equal(prefillHoursFromPlaytime(playtimeDoc(null)), null);
  assert.equal(prefillHoursFromPlaytime(null), null);
  assert.equal(prefillHoursFromPlaytime({}), null);
});

test("a modal input shows the prefill as plain hours", () => {
  assert.equal(prefillInputValue(12.5), "12.5");
  assert.equal(prefillInputValue(0), "0");
  assert.equal(prefillInputValue(null), undefined);
  assert.equal(prefillInputValue(undefined), undefined);
});

test("fetchHours reads the member's playtime for the game", async () => {
  const reads: [string, number][] = [];
  const hours = await playthroughPrefill.fetchHours(MEMBER, GAME_ID, {
    get: async (userId, gameId) => {
      reads.push([userId, gameId]);
      return playtimeDoc({ minutes: 125 });
    },
  });
  assert.equal(hours, 2.08);
  assert.deepEqual(reads, [[MEMBER, GAME_ID]]);
});

test("fetchHours leaves the field blank on a 404, an error or a slow API", async (t) => {
  t.mock.method(console, "error", () => undefined);
  assert.equal(
    await playthroughPrefill.fetchHours(MEMBER, GAME_ID, { get: async () => null }),
    null,
  );
  assert.equal(
    await playthroughPrefill.fetchHours(MEMBER, GAME_ID, {
      get: async () => {
        throw new Error("boom");
      },
    }),
    null,
  );
  const slow = await playthroughPrefill.fetchHours(MEMBER, GAME_ID, {
    timeoutMs: 10,
    get: () => new Promise((resolve) => {
      setTimeout(() => resolve(playtimeDoc({ minutes: 60 })), 50);
    }),
  });
  assert.equal(slow, null);
});

test("/game-completion add keeps a given playtime and fills a blank one", async (t) => {
  const fetch = t.mock.method(playthroughPrefill, "fetchHours", async () => 7.25);
  assert.equal(await playthroughPrefill.resolveFinalHours(MEMBER, GAME_ID, 30), 30);
  assert.equal(await playthroughPrefill.resolveFinalHours(MEMBER, GAME_ID, 0), 0);
  assert.equal(fetch.mock.callCount(), 0, "a given value skips the lookup");
  assert.equal(await playthroughPrefill.resolveFinalHours(MEMBER, GAME_ID, null), 7.25);
  assert.deepEqual(fetch.mock.calls[0].arguments.slice(0, 2), [MEMBER, GAME_ID]);
});

test("/game-completion add sends nothing when no Playthrough is open", async (t) => {
  t.mock.method(playthroughPrefill, "fetchHours", async () => null);
  assert.equal(await playthroughPrefill.resolveFinalHours(MEMBER, GAME_ID, null), null);
});

test("the gamedb details modal prefills playtime from the open Playthrough", () => {
  const json: any = buildCompletionDetailsModal({
    id: "1",
    dateChoice: "today",
    prefillPlaytimeHours: 12.5,
  }).toJSON();
  const playtime = inputs(json).find((input) => input.custom_id === "completion-playtime");
  assert.equal(playtime.value, "12.5");
  assert.equal(playtime.required, false, "the member can still clear it");
  assert.equal(playtime.label, "Playtime hours (from your Playthrough)");
});

test("the gamedb details modal is unchanged without an open Playthrough", () => {
  const json: any = buildCompletionDetailsModal({
    id: "1",
    dateChoice: "date",
    prefillPlaytimeHours: null,
  }).toJSON();
  const all = inputs(json);
  const playtime = all.find((input) => input.custom_id === "completion-playtime");
  assert.equal(playtime.value, undefined);
  assert.equal(playtime.label, "Playtime hours (optional)");
  assert.deepEqual(
    all.map((input) => input.custom_id),
    ["completion-date", "completion-playtime", "completion-note"],
  );
});

function stubNowPlaying(t: TestContext): void {
  t.mock.method(persistedSessionStore, "save", async () => "row-1");
  t.mock.method(persistedSessionStore, "load", async () => null);
  t.mock.method(Member, "getNowPlaying", async () => [{
    gameId: GAME_ID,
    title: "Alpha",
    platformId: null,
    platformName: null,
    platformAbbreviation: null,
    note: "Almost there",
    threadId: null,
    addedAt: null,
    noteUpdatedAt: null,
    sortOrder: null,
  }]);
}

async function openNowPlayingDetails(): Promise<any> {
  const sessionId = `np-comp-ui-${MEMBER}`;
  nowPlayingCompletionWizardSessions.set(sessionId, {
    userId: MEMBER,
    gameId: GAME_ID,
    completionType: "Main Story",
    removeFromNowPlaying: true,
    announce: false,
    returnToList: false,
  } as any);
  const modals: any[] = [];
  const interaction: any = {
    customId: `np-complete-details:${sessionId}`,
    user: { id: MEMBER },
    channelId: "channel-1",
    guildId: null,
    deferred: false,
    replied: false,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isRepliable: () => true,
    showModal: async (modal: any) => {
      modals.push(modal.toJSON());
    },
    reply: async () => {},
    editReply: async () => {},
    followUp: async () => {},
  };
  await new NowPlayingCompletionHandlers().handleNowPlayingCompletionDetails(interaction);
  await new Promise((resolve) => setImmediate(resolve));
  nowPlayingCompletionWizardSessions.clear();
  assert.equal(modals.length, 1, "the details modal opens");
  return inputs(modals[0]).find((input) => input.custom_id.includes("hours"));
}

test("the Now Playing complete modal prefills playtime from the open Playthrough", async (t) => {
  stubNowPlaying(t);
  const fetch = t.mock.method(playthroughPrefill, "fetchHours", async () => 41.33);
  const hours = await openNowPlayingDetails();
  assert.equal(hours.value, "41.33");
  assert.equal(hours.required, false);
  assert.equal(hours.label, "Final playtime hours (from your Playthrough)");
  const [userId, gameId, options] = fetch.mock.calls[0].arguments as any[];
  assert.deepEqual([userId, gameId], [MEMBER, GAME_ID]);
  assert.ok(options?.timeoutMs > 0, "the lookup is capped to fit Discord's modal window");
});

test("the Now Playing complete modal is unchanged without an open Playthrough", async (t) => {
  stubNowPlaying(t);
  t.mock.method(playthroughPrefill, "fetchHours", async () => null);
  const hours = await openNowPlayingDetails();
  assert.equal(hours.value, undefined);
  assert.equal(hours.label, "Final playtime hours (optional)");
});

async function completionAddWithPlaytime(
  t: TestContext,
  finalPlaytimeHours: number | null,
): Promise<{ saved: any; sent: string; prefillCalls: number }> {
  t.mock.method(persistedSessionStore, "save", async () => "row-1");
  t.mock.method(persistedSessionStore, "remove", async () => {});
  const game = { id: GAME_ID, title: "Alpha" };
  t.mock.method(Game, "getGameById", async () => game);
  t.mock.method(Member, "getRecentCompletionForGame", async () => null);
  t.mock.method(Member, "getNowPlayingEntryMeta", async () => null);
  const addCompletion = t.mock.method(Member, "addCompletion", async () => 1);
  const fetch = t.mock.method(playthroughPrefill, "fetchHours", async () => 12.5);
  const sessionId = createCompletionSession({
    userId: MEMBER,
    completionType: "Main Story",
    completedAt: null,
    finalPlaytimeHours,
    selectedPlatformId: 4,
    note: null,
    source: "existing",
    query: "Alpha",
    announce: false,
  }, { channelId: "c1", guildId: "g1" });
  const sent: any[] = [];
  const interaction: any = {
    customId: `completion-add-select:${sessionId}`,
    values: [String(GAME_ID)],
    user: { id: MEMBER },
    channelId: "c1",
    deferred: false,
    replied: false,
    isMessageComponent: () => true,
    isRepliable: () => true,
    deferUpdate: async () => {
      interaction.deferred = true;
    },
    reply: async (opts: any) => {
      sent.push(opts);
    },
    editReply: async (opts: any) => {
      sent.push(opts);
    },
    followUp: async (opts: any) => {
      sent.push(opts);
    },
  };
  await handleCompletionAddSelect(interaction);
  assert.equal(addCompletion.mock.callCount(), 1);
  return {
    saved: addCompletion.mock.calls[0].arguments[0],
    sent: JSON.stringify(sent),
    prefillCalls: fetch.mock.callCount(),
  };
}

test("/game-completion add with no playtime saves the open Playthrough's time", async (t) => {
  const { saved, sent } = await completionAddWithPlaytime(t, null);
  assert.equal(saved.finalPlaytimeHours, 12.5);
  assert.match(sent, /12\.5/, "the receipt shows the prefilled hours");
});

test("/game-completion add keeps the member's own playtime", async (t) => {
  const { saved, prefillCalls } = await completionAddWithPlaytime(t, 3);
  assert.equal(saved.finalPlaytimeHours, 3);
  assert.equal(prefillCalls, 0);
});
