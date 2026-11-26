import assert from "node:assert/strict";
import test from "node:test";
import { DiscordAPIError } from "discord.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { BotJobStepError } from "../services/BotJobErrors.js";
import {
  buildPsnAuthExpiredMessage,
  buildPsnAuthRestoredMessage,
  deliverPsnAuthAlert,
  formatPausedDuration,
  parsePsnAuthExpired,
  type IPsnAlertSender,
} from "../services/PsnAuthAlerts.js";

const HOUR = 3_600_000;
const EXPIRED_AT = new Date("2026-11-20T10:00:00Z");
const EXPIRED_UNIX = Math.floor(EXPIRED_AT.getTime() / 1000);

test("formatPausedDuration keeps the two largest units", () => {
  assert.equal(formatPausedDuration(30_000), "under a minute");
  assert.equal(formatPausedDuration(45 * 60_000), "45m");
  assert.equal(formatPausedDuration(3 * HOUR + 5 * 60_000), "3h 5m");
  assert.equal(formatPausedDuration(51 * HOUR + 59 * 60_000), "2d 3h");
  assert.equal(formatPausedDuration(48 * HOUR + 5 * 60_000), "2d");
});

test("the expiry alert names the time and the four fix steps", () => {
  const text = buildPsnAuthExpiredMessage({ expiredAt: EXPIRED_AT, reminder: false }, new Date());
  assert.match(text, /^\*\*PSN login expired:\*\* PSN sync is paused since <t:\d+:f>\./);
  assert.ok(text.includes(`<t:${EXPIRED_UNIX}:f>`));
  assert.ok(text.includes("docs/runbooks/psn-npsso.md"));
  assert.ok(text.includes("https://ca.account.sony.com/api/v1/ssocookie"));
  assert.ok(text.includes("`fly secrets set -a therpgclub-api PSN_NPSSO=...`"));
  assert.ok(text.includes("`bin/rails runner 'Psn::Client.new.send(:access_token)'`"));
  assert.ok(text.includes("`Achievements::ProviderTickJob.perform_later(\"psn\")`"));
  assert.match(text, /usually happen on their own/);
  assert.ok(!text.includes("<@"), "the alert itself mentions nobody");
});

test("the reminder says how long PSN sync has been paused", () => {
  const now = new Date(EXPIRED_AT.getTime() + 26 * HOUR);
  const text = buildPsnAuthExpiredMessage({ expiredAt: EXPIRED_AT, reminder: true }, now);
  assert.match(text, /^\*\*PSN login still expired:\*\* PSN sync has been paused for 1d 2h,/);
  assert.ok(text.includes("fly secrets set"));
});

test("the restored notice says how long it was down", () => {
  const restoredAt = new Date(EXPIRED_AT.getTime() + 5 * HOUR);
  assert.equal(
    buildPsnAuthRestoredMessage({ expiredAt: EXPIRED_AT, restoredAt }),
    "**PSN login restored** after 5h; PSN sync is running again.",
  );
});

test("parsePsnAuthExpired rejects a bad time or reminder", () => {
  assert.throws(() => parsePsnAuthExpired({ expired_at: "soon", reminder: false }), /expired_at/);
  assert.throws(
    () => parsePsnAuthExpired({ expired_at: EXPIRED_AT.toISOString() }),
    /reminder must be a boolean/,
  );
});

interface IRecordingSender extends IPsnAlertSender {
  posts: { channelId: string; pings: readonly string[] }[];
  dms: string[];
}

function sender(fail: { post?: unknown; dm?: unknown } = {}): IRecordingSender {
  const recorder: IRecordingSender = {
    posts: [],
    dms: [],
    sendChannelMessage: async (channelId, _content, pings) => {
      if (fail.post) throw fail.post;
      recorder.posts.push({ channelId, pings });
    },
    sendDm: async (userId) => {
      if (fail.dm) throw fail.dm;
      recorder.dms.push(userId);
    },
  };
  return recorder;
}

const TARGETS = { channelId: "dev-channel", ownerUserId: "owner-1" };

test("deliverPsnAuthAlert posts without pings and DMs the owner", async () => {
  const s = sender();
  const result = await deliverPsnAuthAlert("hi", s, TARGETS);
  assert.deepEqual(s.posts, [{ channelId: "dev-channel", pings: [] }]);
  assert.deepEqual(s.dms, ["owner-1"]);
  assert.equal(result, "Posted in the bot-dev channel; DMed Xer.");
});

test("a failed channel post still DMs the owner", async () => {
  const s = sender({ post: new Error("Missing Access") });
  const result = await deliverPsnAuthAlert("hi", s, TARGETS);
  assert.deepEqual(s.dms, ["owner-1"]);
  assert.equal(result, "Not posted (Missing Access); DMed Xer.");
});

test("a failed or unset owner DM still posts", async () => {
  const failed = sender({ dm: new Error("Cannot send messages to this user") });
  assert.match(await deliverPsnAuthAlert("hi", failed, TARGETS), /not DMed to Xer/);
  assert.equal(failed.posts.length, 1);

  const unset = sender();
  const result = await deliverPsnAuthAlert("hi", unset, { ...TARGETS, ownerUserId: "" });
  assert.equal(unset.posts.length, 1);
  assert.match(result, /no alert DM user is configured/);
});

test("nothing delivered fails, temporary only when Discord may recover", async () => {
  const permanent = deliverPsnAuthAlert("hi", sender({ post: new Error("gone") }), {
    ...TARGETS,
    ownerUserId: "",
  });
  await assert.rejects(permanent, (err: unknown) => {
    assert.ok(err instanceof BotJobStepError);
    assert.equal(err.temporary, false);
    assert.match(err.message, /PSN alert not delivered: Not posted \(gone\)/);
    return true;
  });

  const outage = new DiscordAPIError(
    { code: 0, message: "Server Error" }, 0, 503, "POST", "https://discord.com/api/v10/x", {},
  );
  const temporary = deliverPsnAuthAlert("hi", sender({ post: outage, dm: outage }), TARGETS);
  await assert.rejects(temporary, (err: unknown) => {
    assert.ok(err instanceof BotJobStepError);
    assert.equal(err.temporary, true);
    return true;
  });
});

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

function fakeSurface(posts: { channelId: string; content: string }[]): IBotJobSurface {
  return {
    requestVotingEventPoll: () => {},
    fetchGameKey: async () => null,
    runGiveawayClaimSideEffects: async () => "",
    sendDm: async () => {},
    refreshGiveawayHub: async () => {},
    fetchFeedback: async () => null,
    sendChannelMessage: async (channelId, content) => {
      posts.push({ channelId, content });
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
    giveawayHubLeftPreview: async () => undefined,
  };
}

function job(id: number, kind: string, payload: Record<string, unknown>): IBotJob {
  return { id, kind, payload, attempts: 1, requestedByUserId: null };
}

test("both PSN kinds route to the bot-dev channel and ack done", async () => {
  const posts: { channelId: string; content: string }[] = [];
  const api = fakeApi();
  const expired_at = EXPIRED_AT.toISOString();
  await processBotJobs(
    [
      job(1, "psn_auth_expired", { expired_at, reminder: false }),
      job(2, "psn_auth_restored", { expired_at, restored_at: "2026-11-20T12:30:00Z" }),
      job(3, "psn_auth_expired", { expired_at: "nope", reminder: false }),
    ],
    BOT_JOB_HANDLERS,
    fakeSurface(posts),
    api,
  );
  assert.deepEqual(api.acks.slice(0, 2), [{ id: 1, status: "done" }, { id: 2, status: "done" }]);
  assert.equal(api.acks[2]?.status, "failed");
  assert.deepEqual(posts.map((p) => p.channelId), [BOT_DEV_CHANNEL_ID, BOT_DEV_CHANNEL_ID]);
  assert.match(posts[0]?.content ?? "", /PSN login expired/);
  assert.match(posts[1]?.content ?? "", /PSN login restored\*\* after 2h 30m/);
});
