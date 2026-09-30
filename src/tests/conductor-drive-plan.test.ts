import test from "node:test";
import assert from "node:assert/strict";

import { buildDrivePlan, detectAction, type IDriveStep } from "../conductor/DrivePlan.js";

const FENCE = "```";

function step(n: number, command: string, expected: string, label = `Step ${n}`): string[] {
  return [`### Step ${n}: ${label}`, FENCE, command, FENCE, `Expected: ${expected}`,
    "Ephemeral: yes", ""];
}

function drive(section: string[][]): IDriveStep[] {
  const result = buildDrivePlan(["## Testing", "", ...section.flat()].join("\n"));
  assert.equal(result.kind, "ok");
  return result.kind === "ok" ? result.steps : [];
}

test("detectAction recognizes each single action", () => {
  assert.equal(detectAction("/help"), "slash");
  assert.equal(detectAction("/help topic:games"), "slash");
  assert.equal(detectAction('/feedback\nenter "hi" in "Text", submit'), "slash-modal");
  assert.equal(detectAction('click "Confirm"'), "click");
  assert.equal(detectAction('click "Edit", enter "x" in "Title", submit'), "modal");
  assert.equal(detectAction('select "Gloomhaven"'), "select");
  assert.equal(detectAction("react with a thumbs up"), null);
  assert.equal(detectAction('click "A"\nclick "B"'), null);
});

test("a checkable read-only step is driven", () => {
  const [only] = drive([step(1, "/help", 'title: "Help", option: "Monthly Games"')]);
  assert.equal(only.mode, "drive");
  assert.equal(only.action, "slash");
  assert.deepEqual(only.reasons, []);
});

test("unchecked, by-eye, second-account, and chained steps are handed off", () => {
  const steps = drive([
    step(1, "/help", "the help menu shows"),
    step(2, "/help", 'title: "Help"; check by eye that the image loads'),
    step(3, "/rsvp", 'a second account sees "Going"'),
    step(4, 'click "A", select "B"', 'title: "Done"'),
    step(5, "wave at the bot", '"Hi"'),
  ]);
  assert.deepEqual(steps.map((s) => s.mode), Array(5).fill("hand-off"));
  assert.match(steps[0].reasons.join(), /nothing to check/);
  assert.match(steps[1].reasons.join(), /by eye/);
  assert.match(steps[2].reasons.join(), /second account/);
  assert.match(steps[3].reasons.join(), /chains 2 actions/);
  assert.match(steps[4].reasons.join(), /not one recognized action/);
});

test("steps in an external-effect command's flow stay with the tester", () => {
  const steps = drive([
    step(1, "/todo", 'title: "Issues"'),
    step(2, 'click "Create issue"', 'button: "Confirm"'),
    step(3, "/help", 'title: "Help"'),
  ]);
  assert.deepEqual(steps.map((s) => s.mode), ["hand-off", "hand-off", "drive"]);
  assert.match(steps[1].reasons.join(), /\/todo changes data outside the test guild/);
});

test("readsFrom lists earlier steps the command takes a value from", () => {
  const steps = drive([
    step(1, "/feed list", '"Feed"'),
    step(2, "/feed remove id:(feed number from step 1)", '"Removed"'),
    step(3, "/feed show id:(value from step 7)", '"Feed"'),
  ]);
  assert.deepEqual(steps[1].readsFrom, [1]);
  assert.deepEqual(steps[2].readsFrom, []);
});

test("a body without steps has nothing to drive", () => {
  assert.equal(buildDrivePlan("## Summary\n- none\n").kind, "none");
  assert.equal(buildDrivePlan("## Testing\n\n### Step 1: x\nno fence\n").kind, "none");
});
