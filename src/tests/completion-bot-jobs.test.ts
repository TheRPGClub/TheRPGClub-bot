import assert from "node:assert/strict";
import test from "node:test";
import type { ICompletionRecord } from "../classes/Member.js";
import type { IGame } from "../types/GameTypes.js";
import {
  BOT_JOB_HANDLERS,
  type ICompletionAnnouncement,
  type IBotJobSurface,
} from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { buildCompletionAnnouncementText } from "../functions/CompletionHelpers.js";

type Ack =
  | { id: number; status: "done"; resultText?: string }
  | { id: number; status: "failed"; error: string };

function fakeApi(): IBotJobApi & { acks: Ack[] } {
  const acks: Ack[] = [];
  return {
    acks,
    claim: async () => [],
    done: async (id, resultText) => {
      acks.push(
        resultText === undefined ? { id, status: "done" } : { id, status: "done", resultText },
      );
    },
    failed: async (id, error) => {
      acks.push({ id, status: "failed", error });
    },
  };
}

function storedCompletion(overrides: Partial<ICompletionRecord> = {}): ICompletionRecord {
  return {
    completionId: 55,
    gameId: 9,
    title: "Chrono Trigger",
    completionType: "Main Story",
    platformId: null,
    completedAt: new Date(2026, 10, 2),
    finalPlaytimeHours: 24,
    createdAt: new Date(2026, 10, 2),
    threadId: null,
    note: null,
    ...overrides,
  };
}

const storedGame = { id: 9, title: "Chrono Trigger", coverUrl: null } as unknown as IGame;

interface ICompletionSurface extends IBotJobSurface {
  completionFetches: { userId: string; completionId: number }[];
  announcements: ICompletionAnnouncement[];
}

function fakeSurface(options: {
  completion?: ICompletionRecord | null;
  game?: IGame | null;
  announceError?: unknown;
} = {}): ICompletionSurface {
  const completion = options.completion === undefined ? storedCompletion() : options.completion;
  const game = options.game === undefined ? storedGame : options.game;
  const surface: ICompletionSurface = {
    completionFetches: [],
    announcements: [],
    requestVotingEventPoll: () => {},
    fetchGameKey: async () => null,
    runGiveawayClaimSideEffects: async () => "",
    sendDm: async () => {},
    refreshGiveawayHub: async () => {},
    fetchSuggestion: async () => null,
    sendChannelMessage: async () => {},
    reloadGotmRound: async () => {},
    announceNominationChange: async () => {},
    fetchCompletionForUser: async (userId, completionId) => {
      surface.completionFetches.push({ userId, completionId });
      return completion;
    },
    publishVotingResults: async () => {},
    repostVotingPanels: async () => ({ status: "no_round" }),
    announceTieBreak: async () => [],
    fetchGame: async () => game,
    announceCompletion: async (announcement) => {
      if (options.announceError) throw options.announceError;
      surface.announcements.push(announcement);
    },
  };
  return surface;
}

function job(id: number, payload: Record<string, unknown>): IBotJob {
  return { id, kind: "completion_announce", payload, attempts: 1, requestedByUserId: null };
}

async function run(surface: IBotJobSurface, jobs: IBotJob[]): Promise<Ack[]> {
  const api = fakeApi();
  await processBotJobs(jobs, BOT_JOB_HANDLERS, surface, api);
  return api.acks;
}

function failure(acks: Ack[]): string {
  const [ack] = acks;
  assert.equal(ack?.status, "failed");
  return ack.status === "failed" ? ack.error : "";
}

const payload = { completion_id: 55, user_id: "member-1", game_id: 9, actor_user_id: "sa-1" };

test("announces a Superadmin's completion for a member, naming the Superadmin", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, payload)]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.completionFetches, [{ userId: "member-1", completionId: 55 }]);
  assert.deepEqual(surface.announcements, [{
    userId: "member-1",
    actorUserId: "sa-1",
    game: storedGame,
    completionType: "Main Story",
    completedAt: new Date(2026, 10, 2),
    finalPlaytimeHours: 24,
  }]);
});

test("a service-queued announcement has no actor, so it reads as the member's own", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, { ...payload, actor_user_id: null })]);
  assert.equal(surface.announcements[0]?.actorUserId, "member-1");
});

test("fails the job when the completion is gone or is not the member's", async () => {
  const acks = await run(fakeSurface({ completion: null }), [job(1, payload)]);
  assert.match(failure(acks), /Game Completion 55 of member-1 no longer exists/);
});

test("fails the job when the game is gone", async () => {
  const acks = await run(fakeSurface({ game: null }), [job(1, payload)]);
  assert.match(failure(acks), /GameDB game 9 no longer exists/);
});

test("fails the job when the post fails", async () => {
  const acks = await run(
    fakeSurface({ announceError: new Error("Missing Access") }),
    [job(1, payload)],
  );
  assert.match(failure(acks), /Missing Access/);
});

test("fails the job on a bad payload", async () => {
  const acks = await run(fakeSurface(), [job(1, { ...payload, completion_id: "x" })]);
  assert.match(failure(acks), /completion_id must be a positive integer/);
});

const textBase = {
  user: { id: "member-1", name: "Ayla" },
  title: "Chrono Trigger",
  completionType: "Main Story",
  completedAt: new Date(2026, 10, 2),
  playtimeText: "24 hours",
  yearlyCount: 3,
  isFirst: false,
};

test("announcement text for the member's own completion", () => {
  assert.equal(
    buildCompletionAnnouncementText({ ...textBase, actor: null }),
    "### Ayla\n\nAyla has added a game completion: **Chrono Trigger** - Main Story - " +
      "11/02/2026 - 24 hours\nGame completion #3 for 2026",
  );
});

test("announcement text names the actor who logged it for someone else", () => {
  assert.equal(
    buildCompletionAnnouncementText({
      ...textBase,
      actor: { id: "sa-1", name: "Marle" },
      playtimeText: null,
      isFirst: true,
    }),
    "### Ayla\n\nMarle added a game completion for Ayla: **Chrono Trigger** - Main Story - " +
      "11/02/2026\nGame completion #3 for 2026\n\n" +
      "This is the first recorded completion for this game in the club!",
  );
});

test("announcement text ignores an actor who is the member", () => {
  assert.match(
    buildCompletionAnnouncementText({ ...textBase, actor: { id: "member-1", name: "Ayla" } }),
    /Ayla has added a game completion/,
  );
});
