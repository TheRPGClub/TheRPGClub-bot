import assert from "node:assert/strict";
import test from "node:test";
import {
  BOT_JOB_HANDLERS,
  type IBotJobSurface,
  type ISayMessage,
} from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import { buildMemberScanSummary, type IMemberScanCounts } from "../functions/MemberScan.js";

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

interface ISuperadminSurface extends IBotJobSurface {
  presenceApplies: number;
  says: ISayMessage[];
  memberScans: number;
}

function fakeSurface(options: {
  presenceError?: unknown;
  sayError?: unknown;
  refusal?: string | null;
  scanCounts?: IMemberScanCounts;
} = {}): ISuperadminSurface {
  const surface: ISuperadminSurface = {
    presenceApplies: 0,
    says: [],
    memberScans: 0,
    requestVotingEventPoll: () => {},
    fetchGameKey: async () => null,
    runGiveawayClaimSideEffects: async () => "",
    sendDm: async () => {},
    refreshGiveawayHub: async () => {},
    fetchSuggestion: async () => null,
    sendChannelMessage: async () => {},
    fetchCompletionForUser: async () => null,
    fetchGame: async () => null,
    announceCompletion: async () => {},
    applyLatestPresence: async () => {
      if (options.presenceError) throw options.presenceError;
      surface.presenceApplies++;
    },
    sendSayMessage: async (message) => {
      if (options.sayError) throw options.sayError;
      surface.says.push(message);
    },
    sharedStateRefusal: () => options.refusal ?? null,
    runMemberScan: async () => {
      surface.memberScans++;
      return options.scanCounts ?? { upserted: 0, failed: 0, departed: 0 };
    },
  };
  return surface;
}

function job(id: number, kind: string, payload: Record<string, unknown>): IBotJob {
  return { id, kind, payload, attempts: 1, requestedByUserId: null };
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

test("presence_set applies the latest presence", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "presence_set", { activity_name: "Chrono Trigger" })]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.equal(surface.presenceApplies, 1);
});

test("presence_set fails the job when the presence could not be applied", async () => {
  const surface = fakeSurface({ presenceError: new Error("No presence is saved yet.") });
  const acks = await run(surface, [job(1, "presence_set", { activity_name: "x" })]);
  assert.match(failure(acks), /No presence is saved yet/);
});

const sayPayload = {
  channel_id: "100",
  content: "Hello <@200>, welcome!",
  reply_to: null,
  allowed_mentions: { parse: ["users"] },
};

test("say posts in the channel with only user mentions allowed", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "say", sayPayload)]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.says, [{
    channelId: "100",
    content: "Hello <@200>, welcome!",
    replyTo: null,
    allowedMentions: { parse: ["users"] },
  }]);
});

test("say replies to the linked message", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "say", {
    ...sayPayload,
    reply_to: { channel_id: "100", message_id: "300" },
  })]);
  assert.deepEqual(surface.says[0]?.replyTo, { channelId: "100", messageId: "300" });
});

test("say allows no mentions at all when the payload parses none", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "say", { ...sayPayload, allowed_mentions: { parse: [] } })]);
  assert.deepEqual(surface.says[0]?.allowedMentions, { parse: [] });
});

test("say refuses everyone, here and role pings", async () => {
  for (const parse of [["users", "everyone"], ["roles"]]) {
    const surface = fakeSurface();
    const acks = await run(surface, [job(1, "say", {
      ...sayPayload,
      allowed_mentions: { parse },
    })]);
    assert.match(failure(acks), /allowed_mentions may only parse "users"/);
    assert.deepEqual(surface.says, []);
  }
});

test("say refuses a payload with no allowed_mentions or extra mention keys", async () => {
  for (const allowed of [undefined, { parse: ["users"], roles: ["1"] }, { users: ["1"] }]) {
    const surface = fakeSurface();
    const acks = await run(surface, [job(1, "say", {
      ...sayPayload,
      allowed_mentions: allowed,
    })]);
    assert.match(failure(acks), /allowed_mentions/);
    assert.deepEqual(surface.says, []);
  }
});

test("say refuses a reply to a message in another channel", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "say", {
    ...sayPayload,
    reply_to: { channel_id: "999", message_id: "300" },
  })]);
  assert.match(failure(acks), /reply_to\.channel_id must equal channel_id/);
});

test("say fails the job on empty content or when the post fails", async () => {
  let acks = await run(fakeSurface(), [job(1, "say", { ...sayPayload, content: "  " })]);
  assert.match(failure(acks), /content must be a non-empty string/);
  acks = await run(fakeSurface({ sayError: new Error("Missing Access") }), [
    job(2, "say", sayPayload),
  ]);
  assert.match(failure(acks), /Missing Access/);
});

test("memberscan scans the members and reports the counts", async () => {
  const surface = fakeSurface({ scanCounts: { upserted: 120, failed: 2, departed: 5 } });
  const acks = await run(surface, [job(1, "memberscan", {})]);
  assert.deepEqual(acks, [{
    id: 1,
    status: "done",
    resultText: "Member scan complete. Upserts succeeded: 120. Failed: 2. Marked departed: 5.",
  }]);
  assert.equal(surface.memberScans, 1);
});

test("memberscan is refused by the shared-state guard without scanning", async () => {
  const surface = fakeSurface({ refusal: "`memberscan` is disabled in test mode." });
  const acks = await run(surface, [job(1, "memberscan", {})]);
  assert.match(failure(acks), /`memberscan` is disabled in test mode/);
  assert.equal(surface.memberScans, 0);
});

test("memberscan result text matches the slash command's summary", () => {
  assert.equal(
    buildMemberScanSummary({ upserted: 1, failed: 0, departed: 0 }),
    "Member scan complete. Upserts succeeded: 1. Failed: 0. Marked departed: 0.",
  );
});
