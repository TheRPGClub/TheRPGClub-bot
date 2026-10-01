import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRescheduleBody,
  explainRescheduleRefusal,
  isRoundTallyRevealed,
  isRunoffTallyRevealed,
  listRunoffCategories,
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
  assert.equal(round.runoffOpen, false);
  assert.equal(round.runoffClosesAt, null);
  assert.deepEqual(round.runoffTies, {});
});

test("mapVotingRoundApiData reads an open runoff and its ballot", () => {
  const ballot = [
    { game_id: 12, title: "Saltmarsh Requiem", cover_url: null },
    { game_id: 34, title: "Verdant Hollow", cover_url: null },
  ];
  const round = mapVotingRoundApiData(apiRound({
    phase: "runoff",
    voting_open: false,
    voting_ended: true,
    closed_at: "2026-09-28T04:00:00.000Z",
    runoff_opens_at: "2026-09-28T04:00:00.000Z",
    runoff_closes_at: "2026-09-29T04:00:00.000Z",
    runoff_closed_at: null,
    runoff_open: true,
    runoff_ended: false,
    pending_ties: { nr_gotm: ballot },
    runoff_ties: { nr_gotm: ballot },
  }));

  assert.equal(round.phase, "runoff");
  assert.equal(round.runoffOpen, true);
  assert.equal(round.runoffEnded, false);
  assert.equal(round.runoffClosesAt?.toISOString(), "2026-09-29T04:00:00.000Z");
  assert.equal(round.runoffClosedAt, null);
  assert.deepEqual(round.runoffTies.nr_gotm?.map((game) => game.gameId), [12, 34]);
  assert.deepEqual(listRunoffCategories(round.runoffTies), ["nr_gotm"]);
  assert.equal(isRunoffTallyRevealed(round), false);
  assert.equal(
    isRunoffTallyRevealed({ ...round, runoffOpen: false, runoffEnded: true }),
    true,
  );
  assert.equal(isRunoffTallyRevealed(null), false);
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

test("buildRescheduleBody sends only the fields being changed", () => {
  const opensAt = new Date("2026-10-30T16:00:00.000Z");
  assert.deepEqual(buildRescheduleBody({ votingOpensAt: opensAt }), {
    voting_opens_at: "2026-10-30T16:00:00.000Z",
  });
  const closesAt = new Date("2026-09-27T20:00:00.000Z");
  assert.deepEqual(buildRescheduleBody({ votingClosesAt: closesAt }), {
    voting_closes_at: "2026-09-27T20:00:00.000Z",
  });
});

test("explainRescheduleRefusal only moves a round still collecting nominations", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const nextFriday = new Date("2026-10-30T16:00:00.000Z");
  const nominating = mapVotingRoundApiData(
    apiRound({ phase: "nominating", nominations_open: true, voting_open: false }),
  );
  assert.equal(explainRescheduleRefusal(nominating, nextFriday, now), null);

  const voting = mapVotingRoundApiData(apiRound());
  assert.match(explainRescheduleRefusal(voting, nextFriday, now) ?? "", /already open/);

  const ended = mapVotingRoundApiData(
    apiRound({ phase: "closed", voting_open: false, voting_ended: true }),
  );
  assert.match(explainRescheduleRefusal(ended, nextFriday, now) ?? "", /has ended/);
});

test("explainRescheduleRefusal refuses an open whose voting weekend has passed", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const nominating = mapVotingRoundApiData(
    apiRound({ phase: "nominating", nominations_open: true, voting_open: false }),
  );
  const lastMonth = new Date("2026-09-04T16:00:00.000Z");
  assert.match(explainRescheduleRefusal(nominating, lastMonth, now) ?? "", /already be over/);
  // Opening today still leaves the weekend window ahead.
  const today = new Date("2026-10-01T16:00:00.000Z");
  assert.equal(explainRescheduleRefusal(nominating, today, now), null);
});
