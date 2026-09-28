import test from "node:test";
import assert from "node:assert/strict";
import {
  isRoundTallyRevealed,
  mapVotingRoundApiData,
  type VotingRoundApiData,
} from "../classes/VotingRounds.js";

function apiRound(overrides: Partial<VotingRoundApiData> = {}): VotingRoundApiData {
  return {
    round_number: 143,
    month_year: "October 2026",
    voting_opens_at: "2026-09-25T16:00:00.000Z",
    voting_closes_at: "2026-09-28T03:59:59.999Z",
    closed_at: null,
    decided_at: null,
    phase: "voting",
    nominations_open: false,
    voting_open: true,
    voting_ended: false,
    pending_ties: {},
    ...overrides,
  };
}

test("mapVotingRoundApiData reads the round and its windows as the API reports them", () => {
  const round = mapVotingRoundApiData(apiRound());

  assert.equal(round.roundNumber, 143);
  assert.equal(round.monthYear, "October 2026");
  assert.equal(round.phase, "voting");
  assert.equal(round.votingOpensAt.toISOString(), "2026-09-25T16:00:00.000Z");
  assert.equal(round.votingClosesAt.toISOString(), "2026-09-28T03:59:59.999Z");
  assert.equal(round.closedAt, null);
  assert.equal(round.decidedAt, null);
  assert.equal(round.votingOpen, true);
  assert.equal(round.nominationsOpen, false);
  assert.deepEqual(round.pendingTies, {});
});

test("mapVotingRoundApiData maps tied games per category", () => {
  const round = mapVotingRoundApiData(apiRound({
    phase: "tie",
    voting_open: false,
    voting_ended: true,
    closed_at: "2026-09-28T04:00:00.000Z",
    pending_ties: {
      gotm: [
        { game_id: 12, title: "Saltmarsh Requiem", cover_url: "https://example.test/c.png" },
        { game_id: 34, title: "Verdant Hollow", cover_url: null },
      ],
    },
  }));

  assert.equal(round.closedAt?.toISOString(), "2026-09-28T04:00:00.000Z");
  assert.deepEqual(round.pendingTies, {
    gotm: [
      { gameId: 12, title: "Saltmarsh Requiem", coverUrl: "https://example.test/c.png" },
      { gameId: 34, title: "Verdant Hollow", coverUrl: null },
    ],
  });
});

test("isRoundTallyRevealed hides the tally until voting ends", () => {
  const live = mapVotingRoundApiData(apiRound());
  assert.equal(isRoundTallyRevealed(143, live, null), false);
  const ended = mapVotingRoundApiData(
    apiRound({ phase: "closed", voting_open: false, voting_ended: true }),
  );
  assert.equal(isRoundTallyRevealed(143, ended, null), true);
});

test("isRoundTallyRevealed shows rounds older than the current one with no API row", () => {
  const current = mapVotingRoundApiData(apiRound());
  assert.equal(isRoundTallyRevealed(120, null, current), true);
});

test("isRoundTallyRevealed fails closed for a missing row at or past the current round", () => {
  const current = mapVotingRoundApiData(apiRound());
  assert.equal(isRoundTallyRevealed(143, null, current), false);
  assert.equal(isRoundTallyRevealed(144, null, current), false);
  assert.equal(isRoundTallyRevealed(143, null, null), false);
});

test("mapVotingRoundApiData rejects an unparseable vote time", () => {
  assert.throws(
    () => mapVotingRoundApiData(apiRound({ voting_opens_at: "not a date" })),
    /Invalid voting_opens_at/,
  );
});
