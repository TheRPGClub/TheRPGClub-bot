import test from "node:test";
import assert from "node:assert/strict";
import {
  castSandboxVote,
  closeSandboxVoting,
  createSandboxState,
  isFixtureGameId,
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

const NOW = new Date("2026-09-29T12:00:00.000Z");

function sandbox(overrides: Partial<Parameters<typeof createSandboxState>[0]> = {}) {
  return createSandboxState({ id: "abc123", ownerId: "111", now: NOW, ...overrides });
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

test("createSandboxState makes fixture nominations and starts nominating", () => {
  const state = sandbox({ nominationCounts: { "gotm": 3, "nr-gotm": 0 } });
  assert.equal(state.nominations.gotm.length, 3);
  assert.equal(state.nominations["nr-gotm"].length, 0);
  assert.ok(state.nominations.gotm.every((nomination) => nomination.gameId > 0));
  const round = toSandboxVotingRound(state);
  assert.equal(round.phase, "nominating");
  assert.equal(round.nominationsOpen, true);
  assert.equal(round.votingOpen, false);
  assert.equal(round.votingEnded, false);
});

test("createSandboxState caps fixture nominations one past a single select", () => {
  const state = sandbox({ nominationCounts: { gotm: 99 } });
  assert.equal(state.nominations.gotm.length, SANDBOX_MAX_NOMINATIONS);
  assert.ok(SANDBOX_MAX_NOMINATIONS > 25);
});

test("createSandboxState uses copied nominations and fixtures for an empty category", () => {
  const state = sandbox({
    seeds: { gotm: [{ gameId: 42, title: "Real Game", userId: "222" }], "nr-gotm": [] },
  });
  assert.deepEqual(
    state.nominations.gotm.map((n) => [n.gameId, n.title, n.userId]),
    [[42, "Real Game", "222"]],
  );
  assert.equal(state.nominations["nr-gotm"].length, 4);
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

test("a two-way tie leaves the round tied until an admin breaks it", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "winner", NOW);
  seedSandboxOutcome(state, "nr-gotm", "tie", NOW);
  closeSandboxVoting(state, later(1000));
  assert.equal(state.phase, "tie");
  assert.deepEqual(outboxKinds(state), ["voting_opened", "voting_closed", "tie_pending"]);
  assert.equal(state.pendingTies.gotm, undefined);
  const tied = state.pendingTies.nr_gotm ?? [];
  assert.equal(tied.length, 2);

  assert.throws(() => resolveSandboxTie(state, "gotm", [1], NOW), /no_tie/);
  assert.throws(() => resolveSandboxTie(state, "nr_gotm", [123456], NOW), /invalid_pick/);
  assert.equal(state.phase, "tie");

  resolveSandboxTie(state, "nr_gotm", [tied[1]?.gameId ?? 0], later(2000));
  assert.equal(state.phase, "decided");
  assert.equal(outboxKinds(state).at(-1), "round_decided");
  assert.deepEqual(sandboxWinnerTitles(state, "nr-gotm"), [tied[1]?.title]);
});

test("a three-way tie in both categories needs both broken, and joint winners stick", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "three-way-tie", NOW);
  seedSandboxOutcome(state, "nr-gotm", "three-way-tie", NOW);
  closeSandboxVoting(state, NOW);
  assert.equal(state.pendingTies.gotm?.length, 3);
  assert.equal(state.pendingTies.nr_gotm?.length, 3);

  const gotmIds = (state.pendingTies.gotm ?? []).slice(0, 2).map((game) => game.gameId);
  resolveSandboxTie(state, "gotm", gotmIds, NOW);
  assert.equal(state.phase, "tie");
  assert.equal(outboxKinds(state).includes("round_decided"), false);

  resolveSandboxTie(state, "nr_gotm", [state.pendingTies.nr_gotm?.[0]?.gameId ?? 0], NOW);
  assert.equal(state.phase, "decided");
  assert.equal(sandboxWinnerTitles(state, "gotm").length, 2);
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
  assert.throws(() => seedSandboxOutcome(state, "gotm", "tie", NOW), /needs at least 2/);
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

test("isFixtureGameId marks only fixture games", () => {
  const state = sandbox();
  assert.ok(state.nominations.gotm.every((n) => isFixtureGameId(n.gameId)));
  assert.ok(state.nominations["nr-gotm"].every((n) => isFixtureGameId(n.gameId)));
  assert.equal(isFixtureGameId(42), false);
});

test("parseSandboxState round-trips JSON and rejects anything else", () => {
  const state = votingSandbox();
  seedSandboxOutcome(state, "gotm", "tie", NOW);
  const restored = parseSandboxState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  assert.equal(parseSandboxState(null), null);
  assert.equal(parseSandboxState({ id: "x" }), null);
  assert.equal(parseSandboxState({ ...state, nominations: { gotm: [] } }), null);
});

test("resolveSandboxGuilds registers only in the test guild", () => {
  assert.deepEqual(resolveSandboxGuilds(true, "123"), ["123"]);
  assert.deepEqual(resolveSandboxGuilds(false, ""), []);
  assert.deepEqual(resolveSandboxGuilds(false, "123"), []);
  assert.deepEqual(resolveSandboxGuilds(true, ""), []);
});
