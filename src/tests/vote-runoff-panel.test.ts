import test from "node:test";
import assert from "node:assert/strict";
import type { INominationEntry } from "../classes/Nomination.js";
import type { IVotingRound } from "../classes/VotingRounds.js";
import { buildVotePanelComponents } from "../functions/VotePanelComponents.js";
import {
  buildBallotClosedText,
  isBallotOpen,
  parseVoteCustomId,
  type IVotePanelTarget,
} from "../commands/vote/vote-panel-actions.service.js";

function nomination(id: number): INominationEntry {
  return {
    id,
    roundNumber: 143,
    userId: "100",
    gameTitle: `Game ${id}`,
    gamedbGameId: id * 10,
    nominatedAt: new Date("2026-09-01T00:00:00.000Z"),
    reason: null,
  };
}

function round(overrides: Partial<IVotingRound> = {}): IVotingRound {
  return {
    roundNumber: 143,
    monthYear: "October 2026",
    votingOpensAt: new Date("2026-09-25T16:00:00.000Z"),
    votingClosesAt: new Date("2026-09-28T04:00:00.000Z"),
    closedAt: new Date("2026-09-28T04:00:00.000Z"),
    decidedAt: null,
    phase: "runoff",
    nominationsOpen: false,
    votingOpen: false,
    votingEnded: true,
    runoffOpensAt: new Date("2026-09-28T04:00:00.000Z"),
    runoffClosesAt: new Date("2026-09-29T04:00:00.000Z"),
    runoffClosedAt: null,
    runoffOpen: true,
    runoffEnded: false,
    pendingTies: { gotm: [{ gameId: 10, title: "Game 1", coverUrl: null }] },
    runoffTies: { gotm: [{ gameId: 10, title: "Game 1", coverUrl: null }] },
    ...overrides,
  };
}

const GOTM_RUNOFF: IVotePanelTarget = { kind: "gotm", round: 143, ballot: "runoff" };
const GOTM_MAIN: IVotePanelTarget = { kind: "gotm", round: 143, ballot: "main" };
const NR_RUNOFF: IVotePanelTarget = { kind: "nr-gotm", round: 143, ballot: "runoff" };

test("parseVoteCustomId reads the ballot from the panel's prefix", () => {
  assert.deepEqual(parseVoteCustomId("vote-cast:gotm:143:0"), GOTM_MAIN);
  assert.deepEqual(parseVoteCustomId("vote-tally:nr-gotm:143"), {
    kind: "nr-gotm",
    round: 143,
    ballot: "main",
  });
  assert.deepEqual(parseVoteCustomId("vote-runoff-mine:gotm:143"), GOTM_RUNOFF);
  assert.equal(parseVoteCustomId("vote-other:gotm:143"), null);
  assert.equal(parseVoteCustomId("vote-runoff-cast:retro:143:0"), null);
  assert.equal(parseVoteCustomId("vote-runoff-cast:gotm:0:0"), null);
});

test("a runoff panel offers one vote and routes to the runoff handlers", () => {
  const json = JSON.stringify(
    buildVotePanelComponents({
      kind: "gotm",
      ballot: "runoff",
      roundNumber: 143,
      voteDeadline: new Date("2026-09-29T04:00:00.000Z"),
      cap: 1,
      nominations: [nomination(1), nomination(2)],
    }).map((component) => component.toJSON()),
  );
  assert.match(json, /GOTM Runoff - Round 143/);
  assert.match(json, /Vote for \*\*1\*\* game using/);
  assert.match(json, /The runoff closes <t:/);
  assert.match(json, /"custom_id":"vote-runoff-cast:gotm:143:0"/);
  assert.match(json, /"custom_id":"vote-runoff-mine:gotm:143"/);
  assert.match(json, /"custom_id":"vote-runoff-tally:gotm:143"/);
  assert.doesNotMatch(json, /"vote-cast:/);
});

test("a runoff ballot is open only for a category still in the runoff", () => {
  const open = round();
  assert.equal(isBallotOpen(GOTM_RUNOFF, open), true);
  assert.equal(isBallotOpen(NR_RUNOFF, open), false);
  assert.equal(isBallotOpen(GOTM_MAIN, open), false);
  assert.equal(isBallotOpen(GOTM_RUNOFF, round({ runoffOpen: false })), false);
  assert.equal(isBallotOpen(GOTM_RUNOFF, null), false);
  assert.equal(isBallotOpen(GOTM_MAIN, round({ phase: "voting", votingOpen: true })), true);
});

test("a main panel during the runoff points the member to the runoff panel", () => {
  assert.match(buildBallotClosedText(GOTM_MAIN, round()), /Vote in the runoff/);
  assert.match(buildBallotClosedText(NR_RUNOFF, round()), /NR-GOTM runoff .* is not open/);

  const closed = round({
    phase: "decided",
    runoffOpen: false,
    runoffEnded: true,
    runoffClosedAt: new Date("2026-09-29T04:00:00.000Z"),
    pendingTies: {},
  });
  assert.match(buildBallotClosedText(GOTM_RUNOFF, closed), /GOTM runoff for Round 143 closed <t:/);
  assert.match(buildBallotClosedText(GOTM_MAIN, closed), /Voting for Round 143 closed <t:/);
});
