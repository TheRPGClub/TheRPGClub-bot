import test from "node:test";
import assert from "node:assert/strict";
import {
  NowPlayingCompletionHandlers,
} from "../commands/now-playing/nowPlayingCompletion.handler.js";
import { nowPlayingCompletionWizardSessions } from "../commands/now-playing/nowPlayingContexts.js";
import Member from "../classes/Member.js";
import Game from "../classes/Game.js";

const USER_ID = "123";
const SESSION_ID = `np-comp-ui-${USER_ID}`;
let nowPlaying: any[] = [];

function buildEntry(gameId: number, title: string): any {
  return {
    gameId,
    title,
    platformId: 77,
    platformName: "Nintendo Switch",
    platformAbbreviation: "NS",
    note: null,
    threadId: null,
    addedAt: null,
    noteUpdatedAt: null,
    sortOrder: null,
  };
}

function serialize(payload: any): string {
  const components = (payload?.components ?? []).map((component: any) =>
    typeof component?.toJSON === "function" ? component.toJSON() : component,
  );
  return JSON.stringify(components);
}

// Runs list complete -> modal submit for Alpha and returns the final modal reply payload.
async function completeAlphaFromList(
  removeNowPlaying: (userId: string, gameId: number) => Promise<boolean>,
): Promise<any> {
  const command = new NowPlayingCompletionHandlers() as any;
  const originalGetNowPlaying = Member.getNowPlaying;
  const originalGetRecentCompletionForGame = Member.getRecentCompletionForGame;
  const originalAddCompletion = Member.addCompletion;
  const originalRemoveNowPlaying = Member.removeNowPlaying;
  const originalGetGameById = Game.getGameById;
  const modalReplyPayloads: any[] = [];

  try {
    Member.getNowPlaying = (async () =>
      nowPlaying.map((entry) => ({ ...entry }))) as any;
    Member.getRecentCompletionForGame = (async () => null) as any;
    Member.addCompletion = (async () => 999) as any;
    Member.removeNowPlaying = removeNowPlaying as any;
    Game.getGameById = (async () => ({ id: 11, title: "Alpha", imageData: null })) as any;

    const listInteraction: any = {
      customId: `nowplaying-list-complete:${USER_ID}`,
      isMessageComponent: () => true,
      user: { id: USER_ID },
      guildId: null,
      message: {
        id: "message-1",
        channelId: "channel-1",
        flags: { has: () => false },
      },
      deferred: false,
      replied: false,
      update: async () => {},
    };
    await command.handleNowPlayingListComplete(listInteraction);

    const session = nowPlayingCompletionWizardSessions.get(SESSION_ID);
    assert.ok(session, "list complete should open a completion session");
    session.gameId = 11;
    session.announce = false;
    assert.equal(session.removeFromNowPlaying, true, "remove should default to Yes");
    assert.equal(session.returnToList, true, "list complete should return to the list");

    const modalInteraction: any = {
      customId: `nowplaying-complete-modal:${SESSION_ID}`,
      user: { id: USER_ID },
      guildId: null,
      deferred: false,
      replied: false,
      deferReply: async () => {
        modalInteraction.deferred = true;
      },
      fields: { getTextInputValue: () => "" },
      editReply: async (payload: any) => {
        modalReplyPayloads.push(payload);
      },
    };
    await command.handleNowPlayingCompletionModal(modalInteraction);

    assert.equal(modalReplyPayloads.length, 1, "should reply once after saving");
    return modalReplyPayloads[0];
  } finally {
    Member.getNowPlaying = originalGetNowPlaying;
    Member.getRecentCompletionForGame = originalGetRecentCompletionForGame;
    Member.addCompletion = originalAddCompletion;
    Member.removeNowPlaying = originalRemoveNowPlaying;
    Game.getGameById = originalGetGameById;
    nowPlayingCompletionWizardSessions.delete(SESSION_ID);
  }
}

test("completion with remove set to Yes returns a picker without the completed game", async () => {
  nowPlaying = [buildEntry(11, "Alpha"), buildEntry(22, "Beta")];
  const payload = await completeAlphaFromList(async (_userId, gameId) => {
    // Resolve on a later tick so an unawaited removal would still show the game.
    await new Promise((resolve) => setTimeout(resolve, 5));
    nowPlaying = nowPlaying.filter((entry) => entry.gameId !== gameId);
    return true;
  });

  const rendered = serialize(payload);
  assert.ok(rendered.includes("Beta"), "picker should still list the other game");
  assert.ok(!rendered.includes("Alpha"), "picker should not list the completed game");
});

test("completion that empties the list says the list is empty", async () => {
  nowPlaying = [buildEntry(11, "Alpha")];
  const payload = await completeAlphaFromList(async (_userId, gameId) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    nowPlaying = nowPlaying.filter((entry) => entry.gameId !== gameId);
    return true;
  });

  const rendered = serialize(payload);
  assert.ok(rendered.includes("Your Now Playing list is empty."));
  assert.ok(!rendered.includes("Alpha"), "reply should not list the completed game");
});

test("completion reports a failed removal and keeps the game in the picker", async () => {
  nowPlaying = [buildEntry(11, "Alpha"), buildEntry(22, "Beta")];
  const payload = await completeAlphaFromList(async () => {
    throw new Error("delete exploded");
  });

  const rendered = serialize(payload);
  assert.ok(rendered.includes("could not be removed from Now Playing"));
  assert.ok(rendered.includes("delete exploded"), "warning should include the error");
  assert.ok(rendered.includes("Beta"), "picker should still render");
});
