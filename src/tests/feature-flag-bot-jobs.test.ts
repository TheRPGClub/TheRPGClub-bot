import assert from "node:assert/strict";
import test from "node:test";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { ADMIN_CHANNEL_ID } from "../config/channels.js";

type Ack = { id: number; status: "done" } | { id: number; status: "failed"; error: string };

function fakeApi(): IBotJobApi & { acks: Ack[] } {
  const acks: Ack[] = [];
  return {
    acks,
    claim: async () => [],
    done: async (id) => {
      acks.push({ id, status: "done" });
    },
    failed: async (id, error) => {
      acks.push({ id, status: "failed", error });
    },
  };
}

interface IPostingSurface extends IBotJobSurface {
  posts: { channelId: string; content: string; pings: readonly string[] }[];
}

function fakeSurface(): IPostingSurface {
  const surface: IPostingSurface = {
    posts: [],
    requestVotingEventPoll: () => {},
    fetchGameKey: async () => null,
    runGiveawayClaimSideEffects: async () => "",
    sendDm: async () => {},
    refreshGiveawayHub: async () => {},
    fetchSuggestion: async () => null,
    sendChannelMessage: async (channelId, content, pings) => {
      surface.posts.push({ channelId, content, pings });
    },
    reloadGotmRound: async () => {},
    announceNominationChange: async () => {},
    fetchCompletionForUser: async () => null,
    publishVotingResults: async () => {},
    repostVotingPanels: async () => ({ status: "no_round" }),
    announceTieBreak: async () => [],
    fetchGame: async () => null,
    announceCompletion: async () => {},
    fetchLiveEvent: async () => null,
    recordLiveEventStep: async () => {},
    fetchLiveEventImage: async () => Buffer.alloc(0),
    createLiveEventThread: async () => "",
    createLiveEventScheduledEvent: async () => "",
    applyLatestPresence: async () => {},
    sendSayMessage: async () => {},
    sharedStateRefusal: () => null,
    runMemberScan: async () => ({ upserted: 0, failed: 0, departed: 0 }),
    featureState: async () => null,
    featureFlagsChanged: () => undefined,
  };
  return surface;
}

function job(id: number, payload: Record<string, unknown>): IBotJob {
  return { id, kind: "feature_flag_changed", payload, attempts: 1, requestedByUserId: "123" };
}

async function run(surface: IBotJobSurface, jobs: IBotJob[]): Promise<Ack[]> {
  const api = fakeApi();
  await processBotJobs(jobs, BOT_JOB_HANDLERS, surface, api);
  return api.acks;
}

const changedPayload = {
  key: "reviews",
  name: "Reviews",
  from_state: "live",
  to_state: "preview",
  changed_by: "123",
  changed_by_name: "Ada",
  reason: "Testing the new layout",
};

test("feature_flag_changed: posts who, from, to and reason in the admin channel", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, changedPayload)]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.posts, [{
    channelId: ADMIN_CHANNEL_ID,
    content: "**Feature Flag changed:** Reviews (`reviews`) is now **Preview** (was Live).\n" +
      "Changed by <@123> (Ada).\n" +
      "Reason: Testing the new layout",
    pings: [],
  }]);
});

test("feature_flag_changed: no reason and the system changer read plainly", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(2, {
    ...changedPayload,
    from_state: "preview",
    to_state: "off",
    changed_by: "system",
    changed_by_name: null,
    reason: null,
  })]);
  assert.deepEqual(acks, [{ id: 2, status: "done" }]);
  assert.equal(
    surface.posts[0]?.content,
    "**Feature Flag changed:** Reviews (`reviews`) is now **Off** (was Preview).\n" +
      "Changed by system.\n" +
      "Reason: none given",
  );
});

test("feature_flag_changed: a payload missing its states fails without posting", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(3, { ...changedPayload, to_state: "sideways" })]);
  assert.equal(acks[0]?.status, "failed");
  assert.match(acks[0]?.status === "failed" ? acks[0].error : "", /to_state/);
  assert.deepEqual(surface.posts, []);
});
