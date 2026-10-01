import assert from "node:assert/strict";
import test from "node:test";
import { parseRoundCustomId } from "../commands/admin/round-admin.service.js";
import {
  listPendingTitles,
  resolveAnswers,
  votingSetupFromState,
  type VotingSetupState,
} from "../commands/admin/voting-admin.service.js";

const LONG_TITLE = "The Legend of Heroes: Trails in the Sky the 3rd";
const LONG_NR_TITLE = "Teenage Mutant Ninja Turtles: Shredder's Revenge";

function buildState(): VotingSetupState {
  return {
    roundNumber: 42,
    monthLabel: "October 2026",
    answers: { "GOTM": ["Chrono Trigger", LONG_TITLE], "NR-GOTM": [LONG_NR_TITLE] },
    overrides: {},
  };
}

test("round custom ids parse kind, round, and game index", () => {
  assert.deepEqual(
    parseRoundCustomId("admin-round-edit-v1:nr-gotm:12:3", true),
    { kind: "nr-gotm", round: 12, gameIndex: 3 },
  );
  assert.deepEqual(
    parseRoundCustomId("admin-round-add-v1:gotm:7", false),
    { kind: "gotm", round: 7, gameIndex: 0 },
  );
  assert.equal(parseRoundCustomId("admin-round-add-v1:other:7", false), null);
  assert.equal(parseRoundCustomId("admin-round-edit-v1:gotm:0:1", true), null);
  assert.equal(parseRoundCustomId("admin-round-edit-v1:gotm:3", true), null);
});

test("only titles over the limit and not yet shortened are pending", () => {
  const state = buildState();
  assert.deepEqual(listPendingTitles(state).map((item) => item.key), ["GOTM-1", "NR-GOTM-0"]);

  state.overrides["GOTM-1"] = "Trails in the Sky 3rd";
  assert.deepEqual(listPendingTitles(state).map((item) => item.key), ["NR-GOTM-0"]);
  assert.deepEqual(resolveAnswers(state, "GOTM"), ["Chrono Trigger", "Trails in the Sky 3rd"]);
  assert.deepEqual(resolveAnswers(state, "NR-GOTM"), [LONG_NR_TITLE]);
});

test("voting setup state survives a JSON round trip and rejects bad rows", () => {
  const state = buildState();
  state.overrides["NR-GOTM-0"] = "TMNT: Shredder's Revenge";
  const restored = votingSetupFromState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);

  assert.equal(votingSetupFromState(null), null);
  assert.equal(votingSetupFromState({ ...state, answers: { "GOTM": [] } }), null);
  assert.equal(votingSetupFromState({ ...state, overrides: { "GOTM-0": 5 } }), null);
});
