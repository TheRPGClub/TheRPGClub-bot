import assert from "node:assert/strict";
import test from "node:test";
import { persistedSessionStore } from "../services/PersistedInteractionSessionStore.js";
import {
  createNowPlayingDuplicateSession,
  nowPlayingDuplicateRegistry,
  parseNowPlayingDuplicateOwnerId,
  type NowPlayingPendingCompletion,
} from "../commands/now-playing/nowPlayingCompletionDuplicate.js";

const OWNER = "333333333333333333";
const LOCATION = { channelId: "444444444444444444", guildId: "555555555555555555" };

function buildPending(): NowPlayingPendingCompletion {
  return {
    sessionId: `np-comp-ui-${OWNER}`,
    userId: OWNER,
    gameId: 321,
    completionType: "Main Story",
    completedAt: new Date("2026-09-15T00:00:00Z"),
    finalPlaytimeHours: 12.5,
    note: "Great ending",
    removeFromNowPlaying: true,
    announce: false,
    returnToList: true,
  };
}

test("a pending Now Playing completion restores from its persisted row", async (t) => {
  let savedState: unknown;
  t.mock.method(persistedSessionStore, "save", async (params: { state: unknown }) => {
    savedState = params.state;
    return "row-1";
  });
  const sessionId = createNowPlayingDuplicateSession(buildPending(), LOCATION);
  assert.equal(parseNowPlayingDuplicateOwnerId(sessionId), OWNER);

  // A restart leaves only the API row: resolve an id that is not in memory.
  t.mock.method(persistedSessionStore, "load", async () => ({
    rowId: "row-1",
    state: JSON.parse(JSON.stringify(savedState)),
  }));
  const restored = await nowPlayingDuplicateRegistry.resolve(`${sessionId}-restart`, {
    ownerId: OWNER,
    channelId: LOCATION.channelId,
  });
  assert.deepEqual(restored, buildPending());
});

test("a malformed persisted row does not restore", async (t) => {
  t.mock.method(persistedSessionStore, "load", async () => ({
    rowId: "row-2",
    state: { ...buildPending(), completionType: "Not a type" },
  }));
  const restored = await nowPlayingDuplicateRegistry.resolve(`npdup-${OWNER}-1-2`, {
    ownerId: OWNER,
    channelId: LOCATION.channelId,
  });
  assert.equal(restored, undefined);
});

test("only npdup session ids yield an owner", () => {
  assert.equal(parseNowPlayingDuplicateOwnerId(`npdup-${OWNER}-1-2`), OWNER);
  assert.equal(parseNowPlayingDuplicateOwnerId(`compadd-${OWNER}-1-2`), null);
  assert.equal(parseNowPlayingDuplicateOwnerId("npdup-abc-1-2"), null);
});
