import test from "node:test";
import assert from "node:assert/strict";
import {
  castSandboxVote,
  closeSandboxBallot,
  closeSandboxRunoff,
  closeSandboxVoting,
  createSandboxState,
  fillSandboxSeeds,
  sandboxPoolFromWinners,
  openSandboxVoting,
  parseSandboxState,
  remindSandboxNominations,
  resolveSandboxTie,
  sandboxTally,
  sandboxVotesForUser,
  sandboxWinnerTitles,
  SANDBOX_MAX_NOMINATIONS,
  seedSandboxOutcome,
  toSandboxNextRound,
  toSandboxVotingRound,
  type IVotingSandboxState,
} from "../services/VotingSandboxModel.js";
import { resolveSandboxGuilds } from "../commands/vote-sandbox/vote-sandbox.service.js";
import { TEST_SANDBOX_POOLS, winnerRounds } from "./votingSandboxPools.js";

const NOW = new Date("2026-09-29T12:00:00.000Z");

function sandbox(overrides: Partial<Parameters<typeof createSandboxState>[0]> = {}) {
  return createSandboxState({
    id: "abc123",
    ownerId: "111",
    now: NOW,
    pools: TEST_SANDBOX_POOLS,
    ...overrides,
  });
}

function votingSandbox(cap = 2): IVotingSandboxState {
  const state = sandbox({ cap });
  openSandboxVoting(state, NOW);
  return state;
}

function later(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

function outboxKinds(state: IVotingSandboxState): string[] {
  return state.outbox.map((event) => event.kind);
}

test("createSandboxState nominates past winners in round order and starts nominating", () => {
  const state = sandbox({ nominationCounts: { "gotm": 3, "nr-gotm": 0 } });
  assert.deepEqual(
    state.nominations.gotm.map((n) => [n.gameId, n.title, n.reason]),
    [
      [101, "GOTM Winner 1", "GOTM Round 1 winner"],
      [102, "GOTM Winner 2", "GOTM Round 2 winner"],
      [103, "GOTM Winner 3", "GOTM Round 3 winner"],
    ],
  );
  assert.equal(state.nominations["nr-gotm"].length, 0);
  const round = toSandboxVotingRound(state);
  assert.equal(round.phase, "nominating");
  assert.equal(round.nominationsOpen, true);
  assert.equal(round.votingOpen, false);
  assert.equal(round.votingEnded, false);
});

test("createSandboxState caps nominations one past a single select", () => {
  const state = sandbox({ nominationCounts: { gotm: 99 } });
  assert.equal(state.nominations.gotm.length, SANDBOX_MAX_NOMINATIONS);
  assert.ok(SANDBOX_MAX_NOMINATIONS > 25);
});

test("createSandboxState uses copied nominations and past winners for an empty category", () => {
  const state = sandbox({
    seeds: { gotm: [{ gameId: 42, title: "Real Game", userId: "222" }], "nr-gotm": [] },
  });
  assert.deepEqual(
    state.nominations.gotm.map((n) => [n.gameId, n.title, n.userId]),
    [[42, "Real Game", "222"]],
  );
  assert.deepEqual(
    state.nominations["nr-gotm"].map((n) => n.title),
    ["NR-GOTM Winner 1", "NR-GOTM Winner 2", "NR-GOTM Winner 3", "NR-GOTM Winner 4"],
  );
});

test("sandboxPoolFromWinners orders by round and keeps each real game once", () => {
  const pool = sandboxPoolFromWinners("nr-gotm", [
    { round: 7, gameOfTheMonth: [{ gamedbGameId: 9, title: "Later" }] },
    {
      round: 2,
      gameOfTheMonth: [
        { gamedbGameId: 5, title: "Joint A" },
        { gamedbGameId: 6, title: "Joint B" },
        { gamedbGameId: 0, title: "No GameDB row" },
      ],
    },
    { round: 9, gameOfTheMonth: [{ gamedbGameId: 5, title: "Joint A" }] },
  ]);
  assert.deepEqual(
    pool.map((seed) => [seed.gameId, seed.title, seed.reason]),
    [
      [5, "Joint A", "NR-GOTM Round 2 winner"],
      [6, "Joint B", "NR-GOTM Round 2 winner"],
      [9, "Later", "NR-GOTM Round 7 winner"],
    ],
  );
});

test("fillSandboxSeeds borrows from the other pool and never repeats a game", () => {
  const pools = {
    "gotm": sandboxPoolFromWinners("gotm", winnerRounds("GOTM", 2, 100)),
    "nr-gotm": sandboxPoolFromWinners("nr-gotm", [
      ...winnerRounds("NR-GOTM", 1, 500),
      { round: 2, gameOfTheMonth: [{ gamedbGameId: 101, title: "GOTM Winner 1" }] },
    ]),
  };
  const seeds = fillSandboxSeeds(pools, {}, { "gotm": 3, "nr-gotm": 3 });
  assert.deepEqual(seeds.gotm.map((seed) => seed.gameId), [101, 102, 501]);
  assert.deepEqual(seeds["nr-gotm"].map((seed) => seed.gameId), []);
  const copied = fillSandboxSeeds(pools, { gotm: [{ gameId: 501, title: "Copied" }] });
  assert.deepEqual(copied["nr-gotm"].map((seed) => seed.gameId), [101, 102]);
});

test("castSandboxVote records, toggles off, and refuses an unknown nomination", () => {
  const state = votingSandbox();
  const [first] = state.nominations.gotm;
  assert.ok(first);
  const voted = castSandboxVote(state, "gotm", "u1", first.id, NOW);
  assert.equal(voted?.action, "voted");
  assert.equal(sandboxVotesForUser(state, "gotm", "u1").length, 1);

  const unvoted = castSandboxVote(state, "gotm", "u1", first.id, later(1000));
  assert.equal(unvoted?.action, "unvoted");
  assert.equal(unvoted?.removedVotes[0]?.gameTitle, first.title);
  assert.equal(sandboxVotesForUser(state, "gotm", "u1").length, 0);

  assert.equal(castSandboxVote(state, "gotm", "u1", 9999, NOW), null);
});

test("castSandboxVote past the cap drops the oldest vote with the API's warning", () => {
  const state = votingSandbox(2);
  const [a, b, c] = state.nominations.gotm;
  assert.ok(a && b && c);
  castSandboxVote(state, "gotm", "u1", a.id, NOW);
  castSandboxVote(state, "gotm", "u1", b.id, later(1000));
  const result = castSandboxVote(state, "gotm", "u1", c.id, later(2000));
  assert.equal(result?.action, "voted");
  assert.equal(result?.removedVotes[0]?.gameTitle, a.title);
  assert.equal(
    result?.warning,
    `You were at the vote cap (2), so your oldest vote (${a.title}) was removed.`,
  );
  assert.deepEqual(
    sandboxVotesForUser(state, "gotm", "u1").map((vote) => vote.gameTitle),
    [b.title, c.title],
  );
});

test("votes in one category never count toward the other's cap or tally", () => {
  const state = votingSandbox(1);
  const [gotm] = state.nominations.gotm;
  const [nr] = state.nominations["nr-gotm"];
  assert.ok(gotm && nr);
  castSandboxVote(state, "gotm", "u1", gotm.id, NOW);
  const result = castSandboxVote(state, "nr-gotm", "u1", nr.id, NOW);
  assert.equal(result?.warning, null);
  assert.equal(sandboxTally(state, "gotm").rows.length, 1);
  assert.equal(sandboxTally(state, "nr-gotm").rows.length, 1);
});

test("a clear winner decides the round and queues the results then the decision", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "winner", NOW);
  seedSandboxOutcome(state, "nr-gotm", "winner", NOW);
  closeSandboxVoting(state, later(1000));
  assert.equal(state.phase, "decided");
  assert.deepEqual(outboxKinds(state), ["voting_opened", "voting_closed", "round_decided"]);
  assert.deepEqual(sandboxWinnerTitles(state, "gotm"), [state.nominations.gotm[0]?.title]);
  const round = toSandboxVotingRound(state);
  assert.equal(round.votingEnded, true);
  assert.equal(round.votingOpen, false);
});

test("a two-way tie opens a runoff between only the tied games", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "winner", NOW);
  seedSandboxOutcome(state, "nr-gotm", "two-way-tie", NOW);
  closeSandboxVoting(state, later(1000));
  assert.equal(state.phase, "runoff");
  assert.deepEqual(outboxKinds(state), ["voting_opened", "voting_closed", "runoff_opened"]);
  assert.equal(state.pendingTies.gotm, undefined);
  assert.equal(state.pendingTies.nr_gotm?.length, 2);
  assert.deepEqual(state.runoffTies, state.pendingTies);

  const round = toSandboxVotingRound(state);
  assert.equal(round.runoffOpen, true);
  assert.equal(round.runoffEnded, false);
  assert.equal(round.votingOpen, false);
  assert.equal(round.runoffClosesAt?.getTime(), later(1000 + 24 * 60 * 60 * 1000).getTime());
});

test("a runoff cast goes to the runoff ballot, capped at one, and only for a tied game", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "winner", NOW);
  seedSandboxOutcome(state, "nr-gotm", "two-way-tie", NOW);
  closeSandboxVoting(state, NOW);
  const [first, second, untied] = state.nominations["nr-gotm"];
  assert.ok(first && second && untied);

  const cast = castSandboxVote(state, "nr-gotm", "member", first.id, NOW);
  assert.equal(cast?.runoff, true);
  assert.equal(cast?.cap, 1);
  const moved = castSandboxVote(state, "nr-gotm", "member", second.id, later(1));
  assert.equal(moved?.removedVotes[0]?.gameTitle, first.title);
  assert.deepEqual(
    sandboxVotesForUser(state, "nr-gotm", "member", "runoff").map((vote) => vote.gameTitle),
    [second.title],
  );
  assert.equal(sandboxVotesForUser(state, "nr-gotm", "member").length, 0);
  assert.equal(sandboxTally(state, "nr-gotm", "runoff").cap, 1);

  assert.throws(() => castSandboxVote(state, "nr-gotm", "member", untied.id, NOW), /not_in_runoff/);
  const gotm = state.nominations.gotm[0];
  assert.ok(gotm);
  assert.throws(() => castSandboxVote(state, "gotm", "member", gotm.id, NOW), /voting_closed/);
});

test("a runoff with a sole leader decides the round", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "winner", NOW);
  seedSandboxOutcome(state, "nr-gotm", "two-way-tie", NOW);
  closeSandboxVoting(state, NOW);
  seedSandboxOutcome(state, "nr-gotm", "winner", NOW);
  assert.equal(closeSandboxBallot(state, later(1000)), "runoff");
  assert.equal(state.phase, "decided");
  assert.deepEqual(outboxKinds(state).slice(-2), ["runoff_closed", "round_decided"]);
  assert.deepEqual(state.pendingTies, {});
  assert.equal(toSandboxVotingRound(state).runoffEnded, true);
  assert.deepEqual(sandboxWinnerTitles(state, "nr-gotm"), [state.nominations["nr-gotm"][0]?.title]);
});

test("a runoff that ties again narrows to its leaders and waits on an admin", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "three-way-tie", NOW);
  seedSandboxOutcome(state, "nr-gotm", "two-way-tie", NOW);
  closeSandboxVoting(state, NOW);
  seedSandboxOutcome(state, "gotm", "two-way-tie", NOW);
  seedSandboxOutcome(state, "nr-gotm", "no-votes", NOW);
  closeSandboxRunoff(state, later(1000));
  assert.equal(state.phase, "tie");
  assert.deepEqual(outboxKinds(state).slice(-2), ["runoff_closed", "tie_pending"]);
  assert.equal(state.pendingTies.gotm?.length, 2, "narrowed to the runoff's leaders");
  assert.equal(state.pendingTies.nr_gotm?.length, 2, "no runoff votes keeps the whole tie");
  assert.equal(state.runoffTies.gotm?.length, 3);

  assert.throws(() => resolveSandboxTie(state, "nr_gotm", [123456], NOW), /invalid_pick/);
  const gotmIds = (state.pendingTies.gotm ?? []).map((game) => game.gameId);
  resolveSandboxTie(state, "gotm", gotmIds, NOW);
  assert.equal(state.phase, "tie");
  assert.equal(outboxKinds(state).includes("round_decided"), false);
  resolveSandboxTie(state, "nr_gotm", [state.pendingTies.nr_gotm?.[0]?.gameId ?? 0], NOW);
  assert.equal(state.phase, "decided");
  assert.equal(sandboxWinnerTitles(state, "gotm").length, 2, "joint winners stick");
  assert.throws(() => resolveSandboxTie(state, "gotm", gotmIds, NOW), /no_tie/);
});

test("an admin may settle a category during the runoff, which then skips it", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "two-way-tie", NOW);
  seedSandboxOutcome(state, "nr-gotm", "two-way-tie", NOW);
  closeSandboxVoting(state, NOW);
  assert.throws(() => resolveSandboxTie(state, "gotm", [1], NOW), /invalid_pick/);
  resolveSandboxTie(state, "gotm", [state.pendingTies.gotm?.[1]?.gameId ?? 0], NOW);
  assert.equal(state.phase, "runoff");
  assert.throws(() => seedSandboxOutcome(state, "gotm", "winner", NOW), /no runoff to seed/);

  resolveSandboxTie(state, "nr_gotm", [state.pendingTies.nr_gotm?.[0]?.gameId ?? 0], NOW);
  assert.equal(state.phase, "decided");
  assert.equal(outboxKinds(state).includes("runoff_closed"), false);
  assert.equal(outboxKinds(state).at(-1), "round_decided");
});

test("no votes decides the round with no winner and no tie", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "no-votes", NOW);
  closeSandboxVoting(state, NOW);
  assert.equal(state.phase, "decided");
  assert.deepEqual(state.pendingTies, {});
  assert.deepEqual(sandboxWinnerTitles(state, "gotm"), []);
});

test("seedSandboxOutcome refuses an outcome the category has too few games for", () => {
  const state = sandbox({ nominationCounts: { "gotm": 1, "nr-gotm": 2 } });
  openSandboxVoting(state, NOW);
  assert.throws(
    () => seedSandboxOutcome(state, "gotm", "two-way-tie", NOW),
    /needs at least 2/,
  );
  assert.throws(
    () => seedSandboxOutcome(state, "nr-gotm", "three-way-tie", NOW),
    /needs at least 3/,
  );
  seedSandboxOutcome(state, "gotm", "winner", NOW);
  closeSandboxVoting(state, NOW);
  assert.equal(sandboxWinnerTitles(state, "gotm").length, 1);
});

test("reseeding replaces simulated votes and keeps members' votes", () => {
  const state = votingSandbox();
  const last = state.nominations.gotm.at(-1);
  assert.ok(last);
  castSandboxVote(state, "gotm", "member", last.id, NOW);
  seedSandboxOutcome(state, "gotm", "three-way-tie", NOW);
  seedSandboxOutcome(state, "gotm", "winner", NOW);
  const total = sandboxTally(state, "gotm").rows.reduce((sum, row) => sum + row.voteCount, 0);
  assert.equal(total, 3 + 2 + 1 + 1);
  assert.equal(sandboxVotesForUser(state, "gotm", "member").length, 1);
});

test("phase transitions refuse what the API would not allow", () => {
  const state = sandbox();
  assert.throws(() => closeSandboxVoting(state, NOW), /only open voting can close/);
  assert.throws(() => closeSandboxRunoff(state, NOW), /only an open runoff can close/);
  openSandboxVoting(state, NOW);
  assert.throws(() => openSandboxVoting(state, NOW), /only opens from nominating/);
});

test("a reminder moves the vote so the countdown reads right, only while nominating", () => {
  const state = sandbox();
  remindSandboxNominations(state, "1d", NOW);
  assert.equal(state.votingOpensAt, later(24 * 60 * 60 * 1000).toISOString());
  assert.deepEqual(outboxKinds(state), ["nomination_reminder_1d"]);

  openSandboxVoting(state, NOW);
  const opensAt = state.votingOpensAt;
  remindSandboxNominations(state, "5d", later(1000));
  assert.equal(state.votingOpensAt, opensAt);
  assert.equal(outboxKinds(state).at(-1), "nomination_reminder_5d");
});

test("the next round exists only once the sandbox round is decided", () => {
  const state = votingSandbox();
  assert.equal(toSandboxNextRound(state), null);
  closeSandboxVoting(state, NOW);
  const next = toSandboxNextRound(state);
  assert.equal(next?.roundNumber, state.roundNumber + 1);
  assert.equal(next?.nominationsOpen, true);
  assert.ok((next?.votingOpensAt.getTime() ?? 0) > NOW.getTime());
});

test("parseSandboxState round-trips JSON and rejects anything else", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "two-way-tie", NOW);
  const restored = parseSandboxState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  assert.equal(parseSandboxState(null), null);
  assert.equal(parseSandboxState({ id: "x" }), null);
  assert.equal(parseSandboxState({ ...state, nominations: { gotm: [] } }), null);
});

test("parseSandboxState reads a sandbox saved before runoffs as one with no runoff", () => {
  const state = votingSandbox();
  const legacy: Record<string, unknown> = JSON.parse(JSON.stringify(state));
  for (const key of ["runoffOpensAt", "runoffClosesAt", "runoffClosedAt", "runoffTies"]) {
    delete legacy[key];
  }
  assert.deepEqual(parseSandboxState(legacy), state);
});

test("resolveSandboxGuilds registers only in the test guild", () => {
  assert.deepEqual(resolveSandboxGuilds(true, "123"), ["123"]);
  assert.deepEqual(resolveSandboxGuilds(false, ""), []);
  assert.deepEqual(resolveSandboxGuilds(false, "123"), []);
  assert.deepEqual(resolveSandboxGuilds(true, ""), []);
});
