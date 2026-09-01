import assert from "node:assert/strict";
import test from "node:test";
import type { INominationEntry } from "../classes/Nomination.js";
import type { IVoteCastResult, IVoteEntry, IVoteTallyRow } from "../classes/Vote.js";
import type { ITallyDisplayRow } from "../functions/VoteResultsUtils.js";
import {
  buildCastResultText,
  buildHiddenTallyText,
  buildMyVotesText,
  buildWinnerAnnouncementText,
  dedupeNominationsByGame,
  mergeTallyWithNominations,
  pickWinningRows,
  sumTallyVotes,
} from "../functions/VoteResultsUtils.js";
import { calculateVoteDeadlineEt } from "../functions/VoteDateUtils.js";
import { buildWinnerThreadTitle } from "../services/WinnerThreadService.js";
import { DISCORD_THREAD_NAME_MAX } from "../config/textLimits.js";

function makeNomination(
  params: Partial<INominationEntry> & { id: number },
): INominationEntry {
  return {
    id: params.id,
    roundNumber: params.roundNumber ?? 100,
    userId: params.userId ?? "100",
    gameTitle: params.gameTitle ?? `Game ${params.id}`,
    gamedbGameId: params.gamedbGameId ?? params.id,
    nominatedAt: params.nominatedAt ?? new Date("2026-01-01T00:00:00.000Z"),
    reason: params.reason ?? null,
  };
}

function makeVote(params: Partial<IVoteEntry> & { id: number }): IVoteEntry {
  return {
    id: params.id,
    roundNumber: params.roundNumber ?? 100,
    userId: params.userId ?? "100",
    nominationId: params.nominationId ?? params.id,
    gamedbGameId: params.gamedbGameId ?? params.id,
    gameTitle: params.gameTitle ?? `Game ${params.id}`,
    votedAt: params.votedAt ?? new Date("2026-01-02T00:00:00.000Z"),
  };
}

test("dedupeNominationsByGame keeps the first nomination per game and skips gameless rows", () => {
  const deduped = dedupeNominationsByGame([
    makeNomination({ id: 1, gamedbGameId: 9 }),
    makeNomination({ id: 2, gamedbGameId: 9 }),
    makeNomination({ id: 3, gamedbGameId: 0 }),
    makeNomination({ id: 4, gamedbGameId: 5 }),
  ]);

  assert.deepEqual(deduped.map((n) => n.id), [1, 4]);
});

test("mergeTallyWithNominations sums per-nomination counts of the same game", () => {
  const rows: IVoteTallyRow[] = [
    { nominationId: 1, gamedbGameId: 9, voteCount: 2 },
    { nominationId: 2, gamedbGameId: 9, voteCount: 1 },
    { nominationId: 4, gamedbGameId: 5, voteCount: 1 },
  ];
  const merged = mergeTallyWithNominations(rows, [
    makeNomination({ id: 1, gamedbGameId: 9, gameTitle: "Alpha" }),
    makeNomination({ id: 2, gamedbGameId: 9, gameTitle: "Alpha" }),
    makeNomination({ id: 4, gamedbGameId: 5, gameTitle: "Beta" }),
  ]);

  assert.deepEqual(
    merged.map((row) => [row.gameTitle, row.voteCount]),
    [["Alpha", 3], ["Beta", 1]],
  );
});

test("mergeTallyWithNominations includes zero-vote games and sorts by votes then title", () => {
  const rows: IVoteTallyRow[] = [
    { nominationId: 2, gamedbGameId: 6, voteCount: 4 },
  ];
  const merged = mergeTallyWithNominations(rows, [
    makeNomination({ id: 1, gamedbGameId: 5, gameTitle: "Zed" }),
    makeNomination({ id: 2, gamedbGameId: 6, gameTitle: "Mid" }),
    makeNomination({ id: 3, gamedbGameId: 7, gameTitle: "Apple" }),
  ]);

  assert.deepEqual(
    merged.map((row) => [row.gameTitle, row.voteCount]),
    [["Mid", 4], ["Apple", 0], ["Zed", 0]],
  );
});

test("sumTallyVotes totals every row", () => {
  const rows: IVoteTallyRow[] = [
    { nominationId: 1, gamedbGameId: 5, voteCount: 2 },
    { nominationId: 2, gamedbGameId: 6, voteCount: 3 },
  ];
  assert.equal(sumTallyVotes(rows), 5);
  assert.equal(sumTallyVotes([]), 0);
});

test("buildCastResultText reports a recorded vote with the API warning", () => {
  const result: IVoteCastResult = {
    action: "voted",
    vote: makeVote({ id: 1, gameTitle: "Alpha" }),
    removedVotes: [makeVote({ id: 2, gameTitle: "Beta" })],
    cap: 2,
    warning: "You were at the vote cap (2), so your oldest vote (Beta) was removed.",
  };
  const text = buildCastResultText({
    kindLabel: "GOTM",
    roundNumber: 100,
    result,
    votes: [makeVote({ id: 1, gameTitle: "Alpha" })],
  });

  assert.match(text, /Vote recorded for \*\*Alpha\*\*/);
  assert.match(text, /oldest vote \(Beta\) was removed/);
  assert.match(text, /Your GOTM votes for Round 100 \(1\/2\)/);
});

test("buildCastResultText reports a toggled-off vote", () => {
  const result: IVoteCastResult = {
    action: "unvoted",
    vote: null,
    removedVotes: [makeVote({ id: 2, gameTitle: "Beta" })],
    cap: 3,
    warning: "Removed your vote for Beta.",
  };
  const text = buildCastResultText({
    kindLabel: "NR-GOTM",
    roundNumber: 100,
    result,
    votes: [],
  });

  assert.match(text, /Removed your vote for \*\*Beta\*\*/);
  assert.match(text, /You have not voted yet\./);
});

test("buildMyVotesText lists votes with the cap", () => {
  const text = buildMyVotesText({
    kindLabel: "GOTM",
    roundNumber: 42,
    votes: [
      makeVote({ id: 1, gameTitle: "Alpha" }),
      makeVote({ id: 2, gameTitle: "Beta" }),
    ],
    cap: 3,
  });

  assert.match(text, /\(2\/3\)/);
  assert.match(text, /1\. \*\*Alpha\*\*/);
  assert.match(text, /2\. \*\*Beta\*\*/);
});

test("buildHiddenTallyText reports the total without a breakdown", () => {
  const text = buildHiddenTallyText({
    kindLabel: "GOTM",
    roundNumber: 42,
    totalVotes: 7,
    voteDeadline: new Date("2026-07-27T03:59:59.999Z"),
  });

  assert.match(text, /hidden while voting is open/);
  assert.match(text, /\*\*7\*\* votes cast so far/);
  assert.doesNotMatch(text, /1\./);
});

function makeTallyRow(
  params: Partial<ITallyDisplayRow> & { gamedbGameId: number },
): ITallyDisplayRow {
  return {
    gamedbGameId: params.gamedbGameId,
    gameTitle: params.gameTitle ?? `Game ${params.gamedbGameId}`,
    nominationId: params.nominationId ?? params.gamedbGameId,
    voteCount: params.voteCount ?? 0,
  };
}

test("pickWinningRows returns the top game, all ties, or nothing without votes", () => {
  const single = pickWinningRows([
    makeTallyRow({ gamedbGameId: 1, voteCount: 5 }),
    makeTallyRow({ gamedbGameId: 2, voteCount: 3 }),
  ]);
  assert.deepEqual(single.map((row) => row.gamedbGameId), [1]);

  const tied = pickWinningRows([
    makeTallyRow({ gamedbGameId: 1, voteCount: 4 }),
    makeTallyRow({ gamedbGameId: 2, voteCount: 4 }),
    makeTallyRow({ gamedbGameId: 3, voteCount: 1 }),
  ]);
  assert.deepEqual(tied.map((row) => row.gamedbGameId), [1, 2]);

  assert.deepEqual(pickWinningRows([makeTallyRow({ gamedbGameId: 1, voteCount: 0 })]), []);
  assert.deepEqual(pickWinningRows([]), []);
});

test("buildWinnerAnnouncementText covers winner, tie, and no-votes cases", () => {
  const winner = buildWinnerAnnouncementText({
    kindLabel: "GOTM",
    roundNumber: 42,
    monthLabel: "August 2026",
    winners: [makeTallyRow({ gamedbGameId: 1, gameTitle: "Alpha", voteCount: 5 })],
  });
  assert.match(winner, /The GOTM winner for Round 42 \(August 2026\) is \*\*Alpha\*\*!/);

  const tie = buildWinnerAnnouncementText({
    kindLabel: "NR-GOTM",
    roundNumber: 42,
    monthLabel: "August 2026",
    winners: [
      makeTallyRow({ gamedbGameId: 1, gameTitle: "Alpha", voteCount: 4 }),
      makeTallyRow({ gamedbGameId: 2, gameTitle: "Beta", voteCount: 4 }),
    ],
  });
  assert.match(tie, /tie between \*\*Alpha\*\* and \*\*Beta\*\*/);

  const none = buildWinnerAnnouncementText({
    kindLabel: "GOTM",
    roundNumber: 42,
    monthLabel: "August 2026",
    winners: [],
  });
  assert.match(none, /No GOTM votes were cast for Round 42/);
});

test("buildWinnerThreadTitle formats and truncates the round thread name", () => {
  assert.equal(
    buildWinnerThreadTitle("Chrono Trigger", "GOTM", 42),
    "Chrono Trigger [GOTM Round 42]",
  );
  assert.equal(
    buildWinnerThreadTitle("Suikoden", "NR-GOTM", 7),
    "Suikoden [NR-GOTM Round 7]",
  );
  const long = buildWinnerThreadTitle("A".repeat(120), "GOTM", 42);
  assert.equal(long.length, DISCORD_THREAD_NAME_MAX);
});

test("calculateVoteDeadlineEt ends on the first Sunday at/after the open", () => {
  // Friday 2026-07-24 noon ET -> Sunday 2026-07-26 end of day ET.
  const fromFriday = calculateVoteDeadlineEt(new Date("2026-07-24T16:00:00.000Z"));
  assert.equal(fromFriday.toISOString(), "2026-07-27T03:59:59.999Z");

  // Sunday noon ET ends the same day.
  const fromSunday = calculateVoteDeadlineEt(new Date("2026-07-26T16:00:00.000Z"));
  assert.equal(fromSunday.toISOString(), "2026-07-27T03:59:59.999Z");

  // Monday rolls forward to the following Sunday.
  const fromMonday = calculateVoteDeadlineEt(new Date("2026-07-27T16:00:00.000Z"));
  assert.equal(fromMonday.toISOString(), "2026-08-03T03:59:59.999Z");
});
