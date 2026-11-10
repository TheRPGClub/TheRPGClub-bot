import assert from "node:assert/strict";
import test from "node:test";

import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import type { Client } from "discord.js";
import {
  ANNOUNCEMENT_CHANNEL_ID,
  BOT_DEV_CHANNEL_ID,
  GAMEDB_UPDATES_CHANNEL_ID,
  GIVEAWAY_HUB_CHANNEL_ID,
} from "../config/channels.js";
import { refreshGiveawayHubMessage } from "../services/GiveawayHubService.js";
import type { IVotingEvent } from "../classes/VotingEvents.js";
import {
  handleVotingEvent,
  type IVotingEventContext,
} from "../services/VotingEventHandlers.js";
import {
  BOT_JOB_HANDLERS,
  type BotJobHandlers,
  type IBotJobSurface,
} from "../services/BotJobHandlers.js";
import { createBotJobDeliveryState, processBotJobs } from "../services/BotJobService.js";
import {
  featurePostDestination,
  resolveFeatureState,
  routeFeaturePost,
  routeVotingPost,
  type FeatureState,
  type IFeatureFlag,
  type IFeatureFlagSource,
} from "../functions/FeatureGate.js";
import { resolveVotingPostTarget } from "../services/FeaturePostRouting.js";

const NORMAL_CHANNEL_ID = ANNOUNCEMENT_CHANNEL_ID;

test("routeFeaturePost: a Live Feature posts to its normal channel", () => {
  assert.equal(featurePostDestination("live"), "normal");
  assert.equal(routeFeaturePost("live", NORMAL_CHANNEL_ID), NORMAL_CHANNEL_ID);
});

test("routeFeaturePost: a Preview Feature posts to the bot-dev channel", () => {
  assert.equal(featurePostDestination("preview"), "bot_dev");
  assert.equal(routeFeaturePost("preview", NORMAL_CHANNEL_ID), BOT_DEV_CHANNEL_ID);
});

test("routeFeaturePost: an Off Feature's post is suppressed", () => {
  assert.equal(featurePostDestination("off"), "suppressed");
  assert.equal(routeFeaturePost("off", NORMAL_CHANNEL_ID), null);
});

test("routeFeaturePost: with no state (lookup failed) the post goes to its normal channel", () => {
  assert.equal(featurePostDestination(null), "normal");
  assert.equal(routeFeaturePost(null, NORMAL_CHANNEL_ID), NORMAL_CHANNEL_ID);
});

/** A fake club-wide flag source: one Feature in `state`, counting reads. */
function fakeSource(key: string, state: FeatureState): IFeatureFlagSource & { reads: number } {
  const source = {
    reads: 0,
    flags: async (): Promise<IFeatureFlag[]> => {
      source.reads += 1;
      return [{ key, name: key, state }];
    },
  };
  return source;
}

for (const state of ["off", "preview", "live"] as const) {
  test(`resolveFeatureState: reads the club-wide ${state} state`, async () => {
    const source = fakeSource("giveaways", state);
    assert.equal(await resolveFeatureState("giveaways", source), state);
    assert.equal(source.reads, 1);
  });
}

test("resolveFeatureState: a Feature missing from the flags has no state", async () => {
  assert.equal(await resolveFeatureState("journals", fakeSource("giveaways", "off")), null);
});

test("resolveFeatureState: a failed lookup has no state, so the post is not lost", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const source: IFeatureFlagSource = {
    flags: async () => {
      throw new Error("API down");
    },
  };
  const state = await resolveFeatureState("giveaways", source);
  assert.equal(state, null);
  assert.equal(routeFeaturePost(state, NORMAL_CHANNEL_ID), NORMAL_CHANNEL_ID);
});

const TO_ANNOUNCEMENTS = { channelId: ANNOUNCEMENT_CHANNEL_ID, rehearsal: false };

test("routeVotingPost: announcements follow the Voting & GOTM flag", () => {
  assert.deepEqual(routeVotingPost("live", TO_ANNOUNCEMENTS), TO_ANNOUNCEMENTS);
  assert.deepEqual(routeVotingPost(null, TO_ANNOUNCEMENTS), TO_ANNOUNCEMENTS);
  assert.deepEqual(routeVotingPost("preview", TO_ANNOUNCEMENTS), {
    channelId: BOT_DEV_CHANNEL_ID,
    rehearsal: true,
  });
  assert.equal(routeVotingPost("off", TO_ANNOUNCEMENTS), null);
});

test("routeVotingPost: a rehearsal or another channel goes where it was asked", () => {
  const rehearsal = { channelId: ANNOUNCEMENT_CHANNEL_ID, rehearsal: true };
  assert.deepEqual(routeVotingPost("off", rehearsal), rehearsal);
  const elsewhere = { channelId: GAMEDB_UPDATES_CHANNEL_ID, rehearsal: false };
  assert.deepEqual(routeVotingPost("preview", elsewhere), elsewhere);
});

test("resolveVotingPostTarget: reads the flag once and routes as routeVotingPost does",
  async (t) => {
    t.mock.method(console, "log", () => undefined);
    const preview = fakeSource("voting_gotm", "preview");
    assert.deepEqual(await resolveVotingPostTarget(undefined, preview), {
      channelId: BOT_DEV_CHANNEL_ID,
      rehearsal: true,
    });
    assert.equal(preview.reads, 1);
    const off = fakeSource("voting_gotm", "off");
    assert.equal(await resolveVotingPostTarget(TO_ANNOUNCEMENTS, off), null);
    const elsewhere = { channelId: GAMEDB_UPDATES_CHANNEL_ID, rehearsal: false };
    assert.deepEqual(await resolveVotingPostTarget(elsewhere, off), elsewhere);
    const rehearsal = { ...TO_ANNOUNCEMENTS, rehearsal: true };
    assert.deepEqual(await resolveVotingPostTarget(rehearsal, off), rehearsal);
  });

type Ack = { id: number; status: "done" | "failed"; text?: string };

function fakeJobApi(): IBotJobApi & { acks: Ack[] } {
  const acks: Ack[] = [];
  return {
    acks,
    claim: async () => [],
    done: async (id, resultText) => {
      acks.push(resultText === undefined ? { id, status: "done" } : {
        id,
        status: "done",
        text: resultText,
      });
    },
    failed: async (id, error) => {
      acks.push({ id, status: "failed", text: error });
    },
  };
}

/** Only the surface's Feature state; the test handlers below post nothing. */
function stateSurface(states: Record<string, FeatureState>): IBotJobSurface & {
  asked: string[];
} {
  const asked: string[] = [];
  const surface = {
    asked,
    featureState: async (featureKey: string) => {
      asked.push(featureKey);
      return states[featureKey] ?? null;
    },
  };
  return surface as unknown as IBotJobSurface & { asked: string[] };
}

function job(id: number, payload: Record<string, unknown>): IBotJob {
  return { id, kind: "announce", payload, attempts: 1, requestedByUserId: null };
}

function countingHandlers(): { handlers: BotJobHandlers; runs: number[] } {
  const runs: number[] = [];
  return {
    runs,
    handlers: {
      announce: async (payload) => {
        runs.push(Number(payload.n));
        return "Posted the thing to announcements.";
      },
    },
  };
}

test("bot jobs: a Preview Feature's job runs and its result says it went to bot-dev",
  async () => {
    const api = fakeJobApi();
    const { handlers, runs } = countingHandlers();
    await processBotJobs(
      [job(2, { n: 2, feature_key: "voting_gotm" })],
      handlers,
      stateSurface({ voting_gotm: "preview" }),
      api,
      createBotJobDeliveryState(),
    );
    assert.deepEqual(runs, [2]);
    assert.deepEqual(api.acks, [{
      id: 2,
      status: "done",
      text: "Preview: posted to the bot-dev channel instead. Posted the thing to announcements.",
    }]);
  });

test("bot jobs: a Live Feature's job runs as before", async () => {
  const api = fakeJobApi();
  const { handlers, runs } = countingHandlers();
  await processBotJobs(
    [job(3, { n: 3, feature_key: "suggestions" })],
    handlers,
    stateSurface({ suggestions: "live" }),
    api,
    createBotJobDeliveryState(),
  );
  assert.deepEqual(runs, [3]);
  assert.deepEqual(api.acks, [
    { id: 3, status: "done", text: "Posted the thing to announcements." },
  ]);
});

test("bot jobs: a job without a feature_key never asks for a Feature's state", async () => {
  const api = fakeJobApi();
  const { handlers, runs } = countingHandlers();
  const surface = stateSurface({});
  await processBotJobs([job(4, { n: 4 })], handlers, surface, api, createBotJobDeliveryState());
  assert.deepEqual(runs, [4]);
  assert.deepEqual(surface.asked, []);
});

const REJECTED_OUTCOME = {
  suggestion_id: 7,
  outcome: "rejected",
  created_by: "author-1",
  title: "Dark mode",
  rejection_reason: "Out of scope",
  feature_key: "suggestions",
};

function postingSurface(): IBotJobSurface & { posts: string[]; asked: number } {
  const posts: string[] = [];
  const surface = {
    posts,
    asked: 0,
    featureState: async () => {
      surface.asked += 1;
      return "off" as const;
    },
    sendChannelMessage: async (channelId: string) => {
      posts.push(channelId);
    },
  };
  return surface as unknown as IBotJobSurface & { posts: string[]; asked: number };
}

for (const [state, expected] of [
  ["live", GAMEDB_UPDATES_CHANNEL_ID],
  ["preview", BOT_DEV_CHANNEL_ID],
  [null, GAMEDB_UPDATES_CHANNEL_ID],
] as const) {
  test(`suggestion_outcome: a ${state ?? "unknown"} Suggestions Feature posts to ${expected}` +
    " (the dispatcher's read, not a second one)", async () => {
    const surface = postingSurface();
    const context = { feature: { key: "suggestions", state } };
    await BOT_JOB_HANDLERS.suggestion_outcome(REJECTED_OUTCOME, surface, context);
    assert.deepEqual(surface.posts, [expected]);
    assert.equal(surface.asked, 0);
  });
}

test("bot jobs: the dispatcher reads a job's Feature once and hands it to the handler",
  async () => {
    const api = fakeJobApi();
    const seen: unknown[] = [];
    const surface = stateSurface({ suggestions: "preview" });
    await processBotJobs(
      [job(5, { feature_key: "suggestions" })],
      { announce: async (_payload, _surface, context) => { seen.push(context); } },
      surface,
      api,
      createBotJobDeliveryState(),
    );
    assert.deepEqual(surface.asked, ["suggestions"]);
    assert.deepEqual(seen, [{ feature: { key: "suggestions", state: "preview" } }]);
  });

function votingSurface(): IBotJobSurface & { targets: unknown[] } {
  const targets: unknown[] = [];
  const surface = {
    targets,
    featureState: async () => null,
    publishVotingResults: async (_round: unknown, _onPosted: unknown, target: unknown) => {
      targets.push(target);
    },
  };
  return surface as unknown as IBotJobSurface & { targets: unknown[] };
}

test("voting_results_publish: in Preview the results go to bot-dev, and the text says so",
  async () => {
    const surface = votingSurface();
    const text = await BOT_JOB_HANDLERS.voting_results_publish(
      { round_number: 5, month_label: "May 2027", feature_key: "voting_gotm" },
      surface,
      { feature: { key: "voting_gotm", state: "preview" } },
    );
    assert.deepEqual(surface.targets, [{ channelId: BOT_DEV_CHANNEL_ID, rehearsal: true }]);
    assert.equal(text, "Posted the round 5 results to the bot-dev channel.");
  });

test("voting_results_publish: Live results go to announcements", async () => {
  const surface = votingSurface();
  const text = await BOT_JOB_HANDLERS.voting_results_publish(
    { round_number: 5, month_label: "May 2027", feature_key: "voting_gotm" },
    surface,
    { feature: { key: "voting_gotm", state: "live" } },
  );
  assert.deepEqual(surface.targets, [TO_ANNOUNCEMENTS]);
  assert.equal(text, "Posted the round 5 results to announcements.");
});

test("feature_flag_changed: the bot re-reads its Feature Flags at once", async () => {
  let changed = 0;
  const surface = {
    featureFlagsChanged: () => {
      changed += 1;
    },
    sendChannelMessage: async () => undefined,
  } as unknown as IBotJobSurface;
  await BOT_JOB_HANDLERS.feature_flag_changed({
    key: "reviews",
    name: "Reviews",
    from_state: "preview",
    to_state: "live",
    changed_by: "42",
    changed_by_name: "Ada",
    reason: null,
  }, surface);
  assert.equal(changed, 1);
});

function decidedEvent(): IVotingEvent {
  return {
    id: 9,
    roundNumber: 12,
    kind: "round_decided",
    rawKind: "round_decided",
    payload: {},
    availableAt: new Date(0),
    expiresAt: null,
    attempts: 1,
  };
}

test("round_decided while Voting & GOTM is Off: caches reload, nothing public", async (t) => {
  t.mock.method(console, "log", () => undefined);
  const reloaded: number[] = [];
  const recorded: number[] = [];
  const context: IVotingEventContext = {
    source: {} as IVotingEventContext["source"],
    rehearsal: false,
    recordWinners: async (_client, roundNumber) => {
      recorded.push(roundNumber);
    },
    reloadRound: async (roundNumber) => {
      reloaded.push(roundNumber);
    },
  };
  const outcome = await handleVotingEvent(
    {} as Client,
    decidedEvent(),
    context,
    fakeSource("voting_gotm", "off"),
  );
  assert.equal(outcome, "skipped");
  assert.deepEqual(reloaded, [12]);
  assert.deepEqual(recorded, []);
});

/** A client whose channels are all missing, recording which ones were fetched. */
function channelRecordingClient(): { client: Client; fetched: string[] } {
  const fetched: string[] = [];
  const client = {
    user: { id: "bot-user" },
    channels: {
      fetch: async (channelId: string) => {
        fetched.push(channelId);
        return null;
      },
    },
  } as unknown as Client;
  return { client, fetched };
}

for (const [state, expected] of [
  ["live", [GIVEAWAY_HUB_CHANNEL_ID]],
  ["preview", [BOT_DEV_CHANNEL_ID]],
  ["off", []],
] as const) {
  test(`giveaway hub: a ${state} Giveaways Feature refreshes the hub in ${
    expected.join(", ") || "no channel"
  }`, async (t) => {
    t.mock.method(console, "warn", () => undefined);
    t.mock.method(console, "log", () => undefined);
    const { client, fetched } = channelRecordingClient();
    await refreshGiveawayHubMessage(client, 0, {
      featureFlags: fakeSource("giveaways", state),
    });
    assert.deepEqual(fetched, expected);
  });
}

test("post Features: every post kind belongs to one of the API registry's 11 keys", async () => {
  const { POST_FEATURE_KEYS } = await import("../config/featureGate.js");
  const registry = new Set([
    "game_index", "voting_gotm", "backlog", "collection", "now_playing", "game_completions",
    "reviews", "achievement_hub", "giveaways", "journals", "suggestions",
  ]);
  assert.deepEqual(Object.values(POST_FEATURE_KEYS).filter((key) => !registry.has(key)), []);
});
