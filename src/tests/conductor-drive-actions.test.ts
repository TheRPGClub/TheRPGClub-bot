import test from "node:test";
import assert from "node:assert/strict";

import { parseDriveAction, splitClauses } from "../conductor/DriveActions.js";

test("a bare slash command has a path and no options", () => {
  assert.deepEqual(parseDriveAction("/help"), {
    kind: "slash", path: ["help"], options: [], modal: null,
  });
});

test("slash options keep spaces inside their values", () => {
  assert.deepEqual(
    parseDriveAction("/backlog add title:Chrono Trigger platform:SNES note:Conductor test"),
    {
      kind: "slash",
      path: ["backlog", "add"],
      options: [
        { name: "title", value: "Chrono Trigger" },
        { name: "platform", value: "SNES" },
        { name: "note", value: "Conductor test" },
      ],
      modal: null,
    },
  );
});

test("a slash option with no value, or a malformed name, is not exact", () => {
  assert.equal(parseDriveAction("/backlog add title:"), null);
  assert.equal(parseDriveAction("/Backlog add"), null);
});

test("a slash command that opens a modal carries its fields", () => {
  assert.deepEqual(parseDriveAction('/feedback\nenter "hi, there" in "Text", submit'), {
    kind: "slash",
    path: ["feedback"],
    options: [],
    modal: [{ kind: "enter", value: "hi, there", field: "Text" }],
  });
});

test("a click, with straight or curly quotes", () => {
  assert.deepEqual(parseDriveAction('click "Confirm"'), { kind: "click", button: "Confirm" });
  assert.deepEqual(parseDriveAction("press “Next”"), { kind: "click", button: "Next" });
});

test("a modal submit names its button and fields", () => {
  assert.deepEqual(
    parseDriveAction(
      'click "Search", enter "Gloomhaven" in "Title", select "PC" in "Platform", submit',
    ),
    {
      kind: "modal",
      button: "Search",
      fields: [
        { kind: "enter", value: "Gloomhaven", field: "Title" },
        { kind: "select", value: "PC", field: "Platform" },
      ],
    },
  );
  assert.equal(parseDriveAction('click "Search", enter "x" in "Title"'), null);
});

test("a select names its values and, optionally, its menu", () => {
  assert.deepEqual(parseDriveAction('select "/noms" from "Monthly Games commands"'), {
    kind: "select", values: ["/noms"], menu: "Monthly Games commands",
  });
  assert.deepEqual(parseDriveAction('choose "A", "B" and "C"'), {
    kind: "select", values: ["A", "B", "C"], menu: null,
  });
  assert.equal(parseDriveAction("select the first one"), null);
});

test("anything else is not a driven action", () => {
  assert.equal(parseDriveAction("react with a thumbs up"), null);
  assert.equal(parseDriveAction('click "A"\nclick "B"'), null);
});

test("splitClauses ignores commas inside quotes", () => {
  assert.deepEqual(splitClauses('enter "a, b" in "F", submit'), ['enter "a, b" in "F"', "submit"]);
});
