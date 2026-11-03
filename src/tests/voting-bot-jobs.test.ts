import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import type { IResultsRound } from "../services/VotingResultsAnnouncement.js";
import type { IVotingRound } from "../classes/VotingRounds.js";
import type { VotingPanelRepostOutcome } from "../functions/VotingPanelRepost.js";
import type { ITieBreakPick } from "../services/VotingResultsAnnouncement.js";

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

interface IVotingSurface extends IBotJobSurface {
  published: IResultsRound[];
  reposts: number[];
  tieBreaks: { roundNumber: number; pick: ITieBreakPick }[];
  /** What happened, in order: "announce" and "wake". */
  events: string[];
}

function fakeSurface(options: {
  publishError?: unknown;
  repost?: VotingPanelRepostOutcome;
  tieBreakError?: unknown;
} = {}): IVotingSurface {
  const surface: IVotingSurface = {
    published: [],
    reposts: [],
    tieBreaks: [],
    events: [],
    requestVotingEventPoll: () => {
      surface.events.push("wake");
    },
    fetchGameKey: async () => null,
    runGiveawayClaimSideEffects: async () => "",
    sendDm: async () => {},
    refreshGiveawayHub: async () => {},
    fetchSuggestion: async () => null,
    sendChannelMessage: async () => {},
    reloadGotmRound: async () => {},
    announceNominationChange: async () => {},
    fetchCompletionForUser: async () => null,
    applyLatestPresence: async () => {},
    sendSayMessage: async () => {},
    sharedStateRefusal: () => null,
    runMemberScan: async () => ({ upserted: 0, failed: 0, departed: 0 }),
    fetchGame: async () => null,
    announceCompletion: async () => {},
    fetchLiveEvent: async () => null,
    recordLiveEventStep: async () => {},
    fetchLiveEventImage: async () => Buffer.alloc(0),
    createLiveEventThread: async () => "",
    createLiveEventScheduledEvent: async () => "",
    publishVotingResults: async (round) => {
      if (options.publishError) throw options.publishError;
      surface.published.push(round);
    },
    repostVotingPanels: async (roundNumber) => {
      surface.reposts.push(roundNumber);
      return options.repost ?? { status: "no_round" };
    },
    announceTieBreak: async (roundNumber, pick) => {
      surface.events.push("announce");
      if (options.tieBreakError) throw options.tieBreakError;
      surface.tieBreaks.push({ roundNumber, pick });
      return ["https://discord.com/channels/1/2/3"];
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

test("results publish posts the round's results with its month", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [
    job(1, "voting_results_publish", { round_number: 42, month_label: "November 2026" }),
  ]);
  assert.deepEqual(surface.published, [{ roundNumber: 42, monthLabel: "November 2026" }]);
  assert.deepEqual(acks, [{
    id: 1,
    status: "done",
    resultText: "Posted the round 42 results to announcements.",
  }]);
});

test("results publish rejects a payload without a month", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "voting_results_publish", { round_number: 42 })]);
  assert.match(failure(acks), /month_label must be a non-empty string/);
  assert.equal(surface.published.length, 0);
});

test("results publish acks failed when nothing could be posted", async () => {
  const surface = fakeSurface({
    publishError: new Error("No nominations were found for Round 42; nothing to announce."),
  });
  const acks = await run(surface, [
    job(1, "voting_results_publish", { round_number: 42, month_label: "November 2026" }),
  ]);
  assert.match(failure(acks), /nothing to announce/);
});

test("results publish hitting a temporary API error is left for the lease", async () => {
  const config = { method: "get", url: "/api/v1/voting_rounds/42", headers: new AxiosHeaders() };
  const err = new AxiosError("timeout of 20000ms exceeded", "ECONNABORTED", config, {});
  const surface = fakeSurface({ publishError: err });
  const acks = await run(surface, [
    job(1, "voting_results_publish", { round_number: 42, month_label: "November 2026" }),
  ]);
  assert.deepEqual(acks, []);
});

const openRound = { roundNumber: 42, monthYear: "November 2026" } as unknown as IVotingRound;

function postedOutcome(
  posted: number,
  failed: number,
  lines: string[],
): VotingPanelRepostOutcome {
  return { status: "posted", round: openRound, result: { posted, failed, lines } };
}

test("panels repost posts the round's panels to announcements", async () => {
  const surface = fakeSurface({ repost: postedOutcome(2, 0, []) });
  const acks = await run(surface, [job(1, "voting_panels_repost", { round_number: 42 })]);
  assert.deepEqual(surface.reposts, [42]);
  assert.deepEqual(acks, [{
    id: 1,
    status: "done",
    resultText: "Reposted 2 voting panels for round 42 in announcements.",
  }]);
});

test("panels repost acks failed when a panel could not be sent", async () => {
  const surface = fakeSurface({
    repost: postedOutcome(1, 1, [
      "GOTM: voting panel posted in <#1>.",
      "NR-GOTM: failed to post the voting panel in <#1>: Missing Access",
    ]),
  });
  const acks = await run(surface, [job(1, "voting_panels_repost", { round_number: 42 })]);
  const error = failure(acks);
  assert.match(error, /Posted 1 of 2 voting panels for round 42/);
  assert.match(error, /NR-GOTM: failed to post the voting panel in <#1>: Missing Access/);
});

const refusals: Array<[string, VotingPanelRepostOutcome, RegExp]> = [
  ["no round is scheduled", { status: "no_round" }, /No voting round is scheduled/i],
  [
    "voting has not opened",
    { status: "not_open_yet", round: openRound },
    /Voting for round 42 has not opened yet, so no panels were posted/,
  ],
  [
    "voting has ended",
    { status: "ended", round: openRound },
    /Voting for round 42 has ended, so no panels were posted/,
  ],
  [
    "there are no votable nominations",
    { status: "no_votable_nominations", round: openRound },
    /There are no votable nominations for round 42, so no panels were posted/,
  ],
  [
    "another round is current",
    { status: "other_round", round: { ...openRound, roundNumber: 43 } },
    /Round 42 is no longer the current voting round \(round 43 is\)/,
  ],
];

for (const [label, outcome, expected] of refusals) {
  test(`panels repost acks failed when ${label}`, async () => {
    const surface = fakeSurface({ repost: outcome });
    const acks = await run(surface, [job(1, "voting_panels_repost", { round_number: 42 })]);
    assert.match(failure(acks), expected);
  });
}

const tiePayload = {
  round_number: 42,
  category: "nr_gotm",
  games: [{ game_id: 7, title: "Chrono Trigger" }],
};

test("tie broken announces the pick, then wakes the voting poller", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "voting_tie_broken", tiePayload)]);
  assert.deepEqual(surface.tieBreaks, [{
    roundNumber: 42,
    pick: { category: "nr_gotm", games: [{ gameId: 7, title: "Chrono Trigger" }] },
  }]);
  assert.deepEqual(surface.events, ["announce", "wake"]);
  assert.deepEqual(acks, [{
    id: 1,
    status: "done",
    resultText: "Announced the NR-GOTM round 42 tie break: Chrono Trigger. " +
      "https://discord.com/channels/1/2/3",
  }]);
});

test("tie broken names joint winners together", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, "voting_tie_broken", {
    ...tiePayload,
    category: "gotm",
    games: [{ game_id: 7, title: "Chrono Trigger" }, { game_id: 8, title: "Xenogears" }],
  })]);
  assert.equal(surface.tieBreaks[0]?.pick.games.length, 2);
  const [ack] = acks;
  assert.equal(ack?.status, "done");
  assert.match(
    ack.status === "done" ? ack.resultText ?? "" : "",
    /GOTM round 42 tie break: Chrono Trigger, Xenogears\./,
  );
});

test("tie broken still wakes the poller when the announcement fails", async () => {
  const surface = fakeSurface({ tieBreakError: new Error("Missing Access") });
  const acks = await run(surface, [job(1, "voting_tie_broken", tiePayload)]);
  assert.match(failure(acks), /Missing Access/);
  assert.deepEqual(surface.events, ["announce", "wake"]);
});

const badTiePayloads: Array<[string, Record<string, unknown>, RegExp]> = [
  ["an unknown category", { ...tiePayload, category: "nr-gotm" }, /category must be/],
  ["no games", { ...tiePayload, games: [] }, /games must be a non-empty list/],
  [
    "a game without an id",
    { ...tiePayload, games: [{ title: "Chrono Trigger" }] },
    /games\[0\]\.game_id must be a positive integer/,
  ],
  [
    "a game without a title",
    { ...tiePayload, games: [{ game_id: 7 }] },
    /games\[0\]\.title must be a non-empty string/,
  ],
];

for (const [label, payload, expected] of badTiePayloads) {
  test(`tie broken rejects a payload with ${label}`, async () => {
    const surface = fakeSurface();
    const acks = await run(surface, [job(1, "voting_tie_broken", payload)]);
    assert.match(failure(acks), expected);
    assert.deepEqual(surface.events, []);
  });
}
