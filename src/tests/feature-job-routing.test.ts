import assert from "node:assert/strict";
import test from "node:test";

import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID, GIVEAWAY_LOG_CHANNEL_ID } from "../config/channels.js";
import type { FeatureState } from "../functions/FeatureGate.js";
import {
  BOT_JOB_HANDLERS,
  type IBotJobContext,
  type IBotJobSurface,
} from "../services/BotJobHandlers.js";
import { createBotJobDeliveryState, processBotJobs } from "../services/BotJobService.js";

// Bot jobs of a Feature (payload `feature_key`) get the Feature's state from the dispatcher
// and route their own public posts by it, keeping whatever else they do (a DM, a poll nudge).

type Call = [string, ...unknown[]];

/** A surface that records each call; the dispatcher's read is the only state read allowed. */
function recordingSurface(): IBotJobSurface & { calls: Call[] } {
  const calls: Call[] = [];
  const record = (name: string, result?: unknown) => async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return result;
  };
  const surface = {
    calls,
    featureState: async () => {
      throw new Error("handlers must use the dispatcher's read");
    },
    requestVotingEventPoll: () => {
      calls.push(["requestVotingEventPoll"]);
    },
    announceTieBreak: record("announceTieBreak", []),
    fetchGameKey: async (keyId: number) => ({
      keyId,
      gameTitle: "Chrono Trigger",
      platform: "Steam",
      keyValue: "AAAA-BBBB",
      donorUserId: "donor-1",
    }),
    runGiveawayClaimSideEffects: record("runGiveawayClaimSideEffects", "Donor"),
    sendDm: record("sendDm"),
    refreshGiveawayHub: record("refreshGiveawayHub"),
    fetchSuggestion: async () => ({ createdBy: "author-1", createdByName: "Ada" }),
    sendChannelMessage: record("sendChannelMessage"),
    announceNominationChange: record("announceNominationChange"),
    fetchCompletionForUser: async () => ({
      completionType: "Main Story",
      completedAt: null,
      finalPlaytimeHours: null,
    }),
    fetchGame: async (gameId: number) => ({ id: gameId, title: "Chrono Trigger" }),
    announceCompletion: record("announceCompletion"),
  };
  return surface as unknown as IBotJobSurface & { calls: Call[] };
}

function context(key: string, state: FeatureState | null): IBotJobContext {
  return { feature: { key, state } };
}

function callNames(calls: Call[]): string[] {
  return calls.map(([name]) => name);
}

test("bot jobs: an Off Feature's job still runs, told the Feature is Off", async () => {
  const acks: unknown[] = [];
  const api = {
    claim: async () => [],
    done: async (id: number, text?: string) => {
      acks.push({ id, text });
    },
    failed: async () => undefined,
  } as unknown as IBotJobApi;
  const seen: unknown[] = [];
  const job: IBotJob = {
    id: 1,
    kind: "announce",
    payload: { feature_key: "giveaways" },
    attempts: 1,
    requestedByUserId: null,
  };
  const surface = { featureState: async () => "off" } as unknown as IBotJobSurface;
  await processBotJobs(
    [job],
    {
      announce: async (_payload, _surface, jobContext) => {
        seen.push(jobContext);
        return "Not posted: the giveaways Feature is Off.";
      },
    },
    surface,
    api,
    createBotJobDeliveryState(),
  );
  assert.deepEqual(seen, [context("giveaways", "off")]);
  assert.deepEqual(acks, [{ id: 1, text: "Not posted: the giveaways Feature is Off." }]);
});

test("voting_tie_broken while Off: nothing posted, but the voting poller is still woken",
  async () => {
    const surface = recordingSurface();
    const text = await BOT_JOB_HANDLERS.voting_tie_broken(
      { round_number: 4, category: "gotm", games: [{ game_id: 1, title: "Chrono Trigger" }] },
      surface,
      context("voting_gotm", "off"),
    );
    assert.deepEqual(callNames(surface.calls), ["requestVotingEventPoll"]);
    assert.equal(text, "Not posted: the voting_gotm Feature is Off.");
  });

const CLAIM = {
  key_id: 3,
  claimed_by_user_id: "claimer-1",
  donor_user_id: "donor-1",
  game_title: "Chrono Trigger",
  platform: "Steam",
  feature_key: "giveaways",
};

for (const [state, logChannelId] of [
  ["live", GIVEAWAY_LOG_CHANNEL_ID],
  ["preview", BOT_DEV_CHANNEL_ID],
  ["off", null],
] as const) {
  test(`giveaway_claim_notice: ${state} logs the claim in ${logChannelId ?? "no channel"}` +
    " and always DMs the claimer", async () => {
    const surface = recordingSurface();
    await BOT_JOB_HANDLERS.giveaway_claim_notice(CLAIM, surface, context("giveaways", state));
    const sideEffects = surface.calls.find(([name]) => name === "runGiveawayClaimSideEffects");
    assert.equal(sideEffects?.[3], logChannelId);
    assert.equal(surface.calls.filter(([name]) => name === "sendDm").length, 1);
  });
}

for (const [state, channelId] of [
  ["live", BOT_DEV_CHANNEL_ID],
  ["preview", BOT_DEV_CHANNEL_ID],
  [null, BOT_DEV_CHANNEL_ID],
] as const) {
  test(`suggestion_submitted: a ${state ?? "unknown"} Suggestions Feature pings in bot-dev`,
    async () => {
      const surface = recordingSurface();
      await BOT_JOB_HANDLERS.suggestion_submitted(
        { suggestion_id: 7, created_by: "author-1", feature_key: "suggestions" },
        surface,
        context("suggestions", state),
      );
      assert.deepEqual(surface.calls.map(([name, id]) => [name, id]), [
        ["sendChannelMessage", channelId],
      ]);
    });
}

const COMPLETION = { completion_id: 5, user_id: "u1", game_id: 9, actor_user_id: null };
const NOMINATION_DELETED = {
  category: "gotm",
  round_number: 4,
  user_id: "u1",
  game_title: "Chrono Trigger",
  deleted_by_user_id: "admin-1",
  reason: "Duplicate",
};

const STATE_PASSING_JOBS = [
  ["suggestion_submitted", "suggestions", { suggestion_id: 7, created_by: null }, null],
  ["completion_announce", "game_completions", COMPLETION, "announceCompletion"],
  ["nomination_deleted", "voting_gotm", NOMINATION_DELETED, "announceNominationChange"],
  ["giveaway_hub_refresh", "giveaways", { reason: "claim", key_id: 3 }, "refreshGiveawayHub"],
] as const;

for (const [kind, featureKey, payload, post] of STATE_PASSING_JOBS) {
  test(`${kind}: Off posts nothing and says so`, async () => {
    const surface = recordingSurface();
    const text = await BOT_JOB_HANDLERS[kind](
      { ...payload, feature_key: featureKey },
      surface,
      context(featureKey, "off"),
    );
    assert.deepEqual(surface.calls, []);
    assert.equal(text, `Not posted: the ${featureKey} Feature is Off.`);
  });

  if (!post) continue;
  test(`${kind}: the dispatcher's Preview state is passed down to the post`, async () => {
    const surface = recordingSurface();
    await BOT_JOB_HANDLERS[kind](
      { ...payload, feature_key: featureKey },
      surface,
      context(featureKey, "preview"),
    );
    const call = surface.calls.find(([name]) => name === post);
    assert.equal(call?.at(-1), "preview");
  });
}
