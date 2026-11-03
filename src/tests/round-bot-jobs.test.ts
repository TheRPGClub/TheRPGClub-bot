import assert from "node:assert/strict";
import test from "node:test";
import type { NominationKind } from "../classes/Nomination.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";

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

interface IRoundSurface extends IBotJobSurface {
  reloads: { category: "gotm" | "nr_gotm"; roundNumber: number }[];
  notices: { kind: NominationKind; round: number; content: string }[];
}

function fakeSurface(options: { reloadError?: unknown; announceError?: unknown } = {}) {
  const surface: IRoundSurface = {
    reloads: [],
    notices: [],
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
    reloadGotmRound: async (category, roundNumber) => {
      if (options.reloadError) throw options.reloadError;
      surface.reloads.push({ category, roundNumber });
    },
    announceNominationChange: async (kind, round, content) => {
      if (options.announceError) throw options.announceError;
      surface.notices.push({ kind, round, content });
    },
    applyLatestPresence: async () => {},
    sendSayMessage: async () => {},
    sharedStateRefusal: () => null,
    runMemberScan: async () => ({ upserted: 0, failed: 0, departed: 0 }),
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

test("cache reload re-reads the GOTM round", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "gotm_cache_reload", { category: "gotm", round_number: 42 }),
  ]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.reloads, [{ category: "gotm", roundNumber: 42 }]);
});

test("cache reload re-reads the NR-GOTM round", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "gotm_cache_reload", { category: "nr_gotm", round_number: 9 })]);
  assert.deepEqual(surface.reloads, [{ category: "nr_gotm", roundNumber: 9 }]);
});

test("cache reload rejects an unknown category", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "gotm_cache_reload", { category: "nr-gotm", round_number: 9 }),
  ]);
  assert.match(failure(acks), /category must be "gotm" or "nr_gotm"/);
  assert.equal(surface.reloads.length, 0);
});

test("cache reload rejects a payload without a round number", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "gotm_cache_reload", { category: "gotm" })]);
  assert.match(failure(acks), /round_number must be a positive integer/);
});

test("cache reload acks failed when the API read fails", async () => {
  const surface = fakeSurface({ reloadError: new Error("GET /gotm_entries failed: 500") });
  const acks = await run(surface, [
    job(1, "gotm_cache_reload", { category: "gotm", round_number: 42 }),
  ]);
  assert.match(failure(acks), /GET \/gotm_entries failed: 500/);
});

const deletedPayload = {
  category: "gotm",
  round_number: 42,
  user_id: "nominator-1",
  game_title: "Chrono Trigger",
  deleted_by_user_id: "admin-1",
  reason: "Not eligible",
};

test("nomination removal posts who removed it, the game and the reason", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "nomination_deleted", deletedPayload)]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.notices, [{
    kind: "gotm",
    round: 42,
    content: "<@admin-1> deleted <@nominator-1>'s nomination \"Chrono Trigger\" for " +
      "GOTM Round 42. Reason: Not eligible",
  }]);
});

test("NR-GOTM removal goes to the NR-GOTM list", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "nomination_deleted", { ...deletedPayload, category: "nr_gotm" })]);
  assert.equal(surface.notices[0]?.kind, "nr-gotm");
  assert.match(surface.notices[0]?.content ?? "", /for NR-GOTM Round 42\./);
});

test("a removed nomination without a game leaves the title out", async () => {
  const surface = fakeSurface();
  await run(surface, [job(1, "nomination_deleted", { ...deletedPayload, game_title: null })]);
  assert.equal(
    surface.notices[0]?.content,
    "<@admin-1> deleted <@nominator-1>'s nomination for GOTM Round 42. Reason: Not eligible",
  );
});

test("nomination removal rejects a payload without a reason", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "nomination_deleted", { ...deletedPayload, reason: "" }),
  ]);
  assert.match(failure(acks), /reason must be a non-empty string/);
  assert.equal(surface.notices.length, 0);
});

test("nomination removal acks failed when the post fails", async () => {
  const surface = fakeSurface({ announceError: new Error("Missing Access") });
  const acks = await run(surface, [job(1, "nomination_deleted", deletedPayload)]);
  assert.match(failure(acks), /Missing Access/);
});
