import assert from "node:assert/strict";
import test from "node:test";
import { RESTJSONErrorCodes } from "discord.js";
import type { IGameKey } from "../classes/GameKey.js";
import type { IClaimedGiveawayKey } from "../services/GiveawayClaimService.js";
import {
  BOT_JOB_HANDLERS,
  type IBotJobSurface,
} from "../services/BotJobHandlers.js";
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

interface IGiveawaySurface extends IBotJobSurface {
  dms: { userId: string; content: string }[];
  sideEffects: { claimerId: string; key: IClaimedGiveawayKey }[];
  keyFetches: number[];
  hubRefreshes: number;
}

function storedKey(overrides: Partial<IGameKey> = {}): IGameKey {
  return {
    keyId: 42,
    gameTitle: "Chrono Trigger",
    platform: "Steam",
    keyValue: "AAAA-BBBB-CCCC",
    donorUserId: "donor-1",
    claimedByUserId: "claimer-1",
    claimedAt: new Date("2026-11-01T10:00:00Z"),
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-11-01T10:00:00Z"),
    ...overrides,
  };
}

function fakeSurface(options: {
  key?: IGameKey | null;
  dmError?: unknown;
  hubError?: unknown;
} = {}): IGiveawaySurface {
  const key = options.key === undefined ? storedKey() : options.key;
  const surface: IGiveawaySurface = {
    dms: [],
    sideEffects: [],
    keyFetches: [],
    hubRefreshes: 0,
    requestVotingEventPoll: () => {},
    fetchGameKey: async (keyId) => {
      surface.keyFetches.push(keyId);
      return key;
    },
    runGiveawayClaimSideEffects: async (claimerId, claimed) => {
      surface.sideEffects.push({ claimerId, key: claimed });
      return "DonorName";
    },
    sendDm: async (userId, content) => {
      if (options.dmError) throw options.dmError;
      surface.dms.push({ userId, content });
    },
    refreshGiveawayHub: async () => {
      if (options.hubError) throw options.hubError;
      surface.hubRefreshes++;
    },
    fetchSuggestion: async () => null,
    sendChannelMessage: async () => {},
    reloadGotmRound: async () => {},
    announceNominationChange: async () => {},
    fetchCompletionForUser: async () => null,
    publishVotingResults: async () => {},
    repostVotingPanels: async () => ({ status: "no_round" }),
    announceTieBreak: async () => [],
    fetchGame: async () => null,
    announceCompletion: async () => {},
    applyLatestPresence: async () => {},
    sendSayMessage: async () => {},
    sharedStateRefusal: () => null,
    runMemberScan: async () => ({ upserted: 0, failed: 0, departed: 0 }),
  };
  return surface;
}

const claimPayload = {
  key_id: 42,
  claimed_by_user_id: "claimer-1",
  donor_user_id: "donor-1",
  game_title: "Chrono Trigger",
  platform: "Steam",
};

function job(id: number, kind: string, payload: Record<string, unknown>): IBotJob {
  return { id, kind, payload, attempts: 1, requestedByUserId: "claimer-1" };
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

test("claim notice fetches the key and DMs it to the claimer", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "giveaway_claim_notice", claimPayload)]);
  assert.deepEqual(acks, [{ id: 1, status: "done" }]);
  assert.deepEqual(surface.keyFetches, [42]);
  assert.equal(surface.dms.length, 1);
  const [dm] = surface.dms;
  assert.equal(dm.userId, "claimer-1");
  assert.match(dm.content, /You claimed \*\*Chrono Trigger\*\* \(Steam\)/);
  assert.match(dm.content, /Key: `AAAA-BBBB-CCCC`/);
  assert.match(dm.content, /donated by DonorName/);
});

test("claim notice logs the claim and notifies the donor", async () => {
  const surface = fakeSurface();
  await run(surface, [job(2, "giveaway_claim_notice", claimPayload)]);
  assert.equal(surface.sideEffects.length, 1);
  const [effect] = surface.sideEffects;
  assert.equal(effect.claimerId, "claimer-1");
  assert.equal(effect.key.keyId, 42);
  assert.equal(effect.key.donorUserId, "donor-1");
  assert.equal(effect.key.gameTitle, "Chrono Trigger");
});

test("claim notice for a revoked key fails the job and sends nothing", async () => {
  const surface = fakeSurface({ key: null });
  const acks = await run(surface, [job(3, "giveaway_claim_notice", claimPayload)]);
  assert.match(failure(acks), /Game key 42 no longer exists/);
  assert.equal(surface.dms.length, 0);
  assert.equal(surface.sideEffects.length, 0);
});

test("claim notice with closed DMs fails with a reason for the website", async () => {
  const closed = Object.assign(new Error("Cannot send messages to this user"), {
    code: RESTJSONErrorCodes.CannotSendMessagesToThisUser,
  });
  const surface = fakeSurface({ dmError: closed });
  const acks = await run(surface, [job(4, "giveaway_claim_notice", claimPayload)]);
  const error = failure(acks);
  assert.match(error, /could not DM you your key because your Discord DMs are closed/);
});

test("claim notice with another Discord error fails with that error", async () => {
  const surface = fakeSurface({ dmError: new Error("Missing Access") });
  const acks = await run(surface, [job(5, "giveaway_claim_notice", claimPayload)]);
  assert.match(failure(acks), /Missing Access/);
});

test("claim notice with a bad payload fails without fetching the key", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(6, "giveaway_claim_notice", { ...claimPayload, key_id: "42" }),
    job(7, "giveaway_claim_notice", { ...claimPayload, claimed_by_user_id: "" }),
  ]);
  assert.equal(acks.length, 2);
  assert.match(failure([acks[0]]), /key_id/);
  assert.match(failure([acks[1]]), /claimed_by_user_id/);
  assert.deepEqual(surface.keyFetches, []);
});

test("hub refresh re-renders the giveaway hub, even for a key already gone", async () => {
  const surface = fakeSurface({ key: null });
  const acks = await run(surface, [
    job(8, "giveaway_hub_refresh", { reason: "revoke", key_id: 42 }),
  ]);
  assert.deepEqual(acks, [{ id: 8, status: "done" }]);
  assert.equal(surface.hubRefreshes, 1);
  assert.deepEqual(surface.keyFetches, []);
});

test("hub refresh fails the job when the hub cannot be updated", async () => {
  const surface = fakeSurface({ hubError: new Error("Unknown Channel") });
  const acks = await run(surface, [
    job(9, "giveaway_hub_refresh", { reason: "donate", key_id: 1 }),
  ]);
  assert.match(failure(acks), /Unknown Channel/);
});

function discordDmError(status: number, code: number, message: string): Error {
  return Object.assign(new Error(message), {
    method: "POST",
    url: "https://discord.com/api/v10/channels/555/messages",
    status,
    code,
    rawError: { message, code },
    requestBody: { json: { content: "You claimed it. Key: `AAAA-BBBB-CCCC`" } },
  });
}

test("claim notice with a Discord DM failure acks failed without the key", async () => {
  const surface = fakeSurface({ dmError: discordDmError(403, 50001, "Missing Access") });
  const acks = await run(surface, [job(10, "giveaway_claim_notice", claimPayload)]);
  const error = failure(acks);
  assert.doesNotMatch(error, /AAAA-BBBB-CCCC/);
  assert.match(error, /403/);
  assert.match(error, /Missing Access/);
});
