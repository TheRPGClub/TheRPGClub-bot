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
  type FeatureState,
  type IFeatureAccess,
  type IFeatureAccessSource,
} from "../functions/FeatureGate.js";

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

/** A fake access lookup: one Feature in `state`, as the API answers for a non-staff user. */
function fakeSource(key: string, state: FeatureState): IFeatureAccessSource & {
  lookups: string[];
} {
  const lookups: string[] = [];
  return {
    lookups,
    get: async (userId: string): Promise<IFeatureAccess> => {
      lookups.push(userId);
      return {
        userId,
        staff: false,
        features: [
          { key, name: key, state, canUse: state === "live", preview: false },
        ],
      };
    },
  };
}

for (const state of ["off", "preview", "live"] as const) {
  test(`resolveFeatureState: reads the club-wide ${state} state from the lookup`, async () => {
    const source = fakeSource("giveaways", state);
    assert.equal(await resolveFeatureState("giveaways", "bot-user", source), state);
    assert.deepEqual(source.lookups, ["bot-user"]);
  });
}

test("resolveFeatureState: a Feature missing from the lookup has no state", async () => {
  assert.equal(await resolveFeatureState("journals", "bot-user", fakeSource("giveaways", "off")),
    null);
});

test("resolveFeatureState: a failed lookup has no state, so the post is not lost", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const source: IFeatureAccessSource = {
    get: async () => {
      throw new Error("API down");
    },
  };
  const state = await resolveFeatureState("giveaways", "bot-user", source);
  assert.equal(state, null);
  assert.equal(routeFeaturePost(state, NORMAL_CHANNEL_ID), NORMAL_CHANNEL_ID);
});

test("resolveFeatureState: with no user to look up (bot not logged in) there is no state",
  async () => {
    const source = fakeSource("giveaways", "off");
    assert.equal(await resolveFeatureState("giveaways", null, source), null);
    assert.deepEqual(source.lookups, []);
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

test("bot jobs: an Off Feature's public-post job is suppressed and acked done", async () => {
  const api = fakeJobApi();
  const { handlers, runs } = countingHandlers();
  const surface = stateSurface({ giveaways: "off" });
  await processBotJobs(
    [job(1, { n: 1, feature_key: "giveaways" })],
    handlers,
    surface,
    api,
    createBotJobDeliveryState(),
  );
  assert.deepEqual(runs, []);
  assert.deepEqual(surface.asked, ["giveaways"]);
  assert.deepEqual(api.acks, [
    { id: 1, status: "done", text: "Not posted: the giveaways Feature is Off." },
  ]);
});

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

function postingSurface(state: FeatureState | null): IBotJobSurface & {
  posts: string[];
} {
  const posts: string[] = [];
  const surface = {
    posts,
    featureState: async () => state,
    sendChannelMessage: async (channelId: string) => {
      posts.push(channelId);
    },
  };
  return surface as unknown as IBotJobSurface & { posts: string[] };
}

for (const [state, expected] of [
  ["live", GAMEDB_UPDATES_CHANNEL_ID],
  ["preview", BOT_DEV_CHANNEL_ID],
  [null, GAMEDB_UPDATES_CHANNEL_ID],
] as const) {
  test(`suggestion_outcome: a ${state ?? "unknown"} Suggestions Feature posts to ${expected}`,
    async () => {
      const surface = postingSurface(state);
      await BOT_JOB_HANDLERS.suggestion_outcome(REJECTED_OUTCOME, surface);
      assert.deepEqual(surface.posts, [expected]);
    });
}

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
      featureAccess: fakeSource("giveaways", state),
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
