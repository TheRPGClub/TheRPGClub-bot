import test from "node:test";
import assert from "node:assert/strict";
import {
  areNominationsClosed,
  buildNominationsClosedText,
  type INominationWindow,
} from "../functions/NominationWindow.js";

const opensAt = new Date("2026-09-25T16:00:00.000Z");

function nominationWindow(nominationsOpen: boolean): INominationWindow {
  return { targetRound: 143, nextVoteAt: opensAt, closesAt: opensAt, nominationsOpen };
}

test("areNominationsClosed follows the API's nominationsOpen verdict", () => {
  assert.equal(areNominationsClosed(nominationWindow(true)), false);
  assert.equal(areNominationsClosed(nominationWindow(false)), true);
});

test("buildNominationsClosedText gives the scheduled vote time before voting opens", () => {
  const text = buildNominationsClosedText(
    nominationWindow(false), "are closed", new Date("2026-09-24T00:00:00.000Z"),
  );
  assert.match(
    text,
    /^Nominations for Round 143 are closed\. Voting is scheduled for <t:\d+:F>\.$/,
  );
});

test("buildNominationsClosedText never schedules a vote in the past", () => {
  const text = buildNominationsClosedText(
    nominationWindow(false), "are closed", new Date("2026-09-29T00:00:00.000Z"),
  );
  assert.doesNotMatch(text, /scheduled/);
  assert.match(text, /open once Round 143 is decided\.$/);
});
