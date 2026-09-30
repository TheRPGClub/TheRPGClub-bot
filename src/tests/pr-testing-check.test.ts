import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { checkPrTesting, countStepActions } from "../conductor/PrTestingCheck.js";

const FENCE = "```";
const SCRIPT = fileURLToPath(new URL("../../scripts/check-pr-testing.ts", import.meta.url));

function step(n: number, expected: string, trailing: string[] = []): string[] {
  return [
    `### Step ${n}: Step ${n} label`,
    FENCE,
    `/command${n}`,
    FENCE,
    `Expected: ${expected}`,
    "Ephemeral: yes",
    ...trailing,
    "",
  ];
}

function body(section: string[]): string {
  return ["## Summary", "- a change", "", "## Testing", "", ...section, "## Checklist", ""]
    .join("\n");
}

const VALID = body([...step(1, "a reply saying \"Saved\""), ...step(2, "a public embed")]);
/** PR 1279: a free-text note after Step 1's Ephemeral line. */
const NOTE_AFTER_EPHEMERAL = body([
  ...step(1, "a reply saying \"Saved\"", ["Note: run this in the dev channel."]),
  ...step(2, "a reply saying \"Done\""),
]);
const NO_TESTING = "## Summary\n- a docs change\n\n## Checklist\n- [x] done\n";

type ScriptRun = { status: number | null; output: string };

function runScriptOn(file: string): ScriptRun {
  const result = spawnSync(
    process.execPath,
    ["--no-warnings=ExperimentalWarning", "--import", "tsx", SCRIPT, file],
    { encoding: "utf8" },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function runScript(content: string): ScriptRun {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-testing-"));
  const file = path.join(dir, "body.md");
  fs.writeFileSync(file, content);
  try {
    return runScriptOn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("a valid multi-step section passes and lists each step", () => {
  const result = checkPrTesting(VALID);
  assert.equal(result.ok, true);
  const report = result.lines.join("\n");
  assert.match(report, /parses into 2 step\(s\)/);
  assert.match(report, /Step 1: Step 1 label \(ephemeral\)/);
  assert.match(report, /Command: \/command2/);
  assert.match(report, /step\(s\) 2 have nothing the conductor can check/);
});

test("each single action counts once, a modal submit included", () => {
  assert.equal(countStepActions("/collection add"), 1);
  assert.equal(countStepActions('click "Confirm"'), 1);
  assert.equal(countStepActions('select "Gloomhaven"'), 1);
  assert.equal(countStepActions("/journal select game:Gloomhaven"), 1);
  assert.equal(countStepActions("/journal add body:Great game, pick it up"), 1);
  assert.equal(countStepActions('click "Search", enter "Gloomhaven" in "Title", submit'), 1);
  assert.equal(countStepActions('click "Add", enter "Hello, then bye" in "Body", submit'), 1);
  assert.equal(countStepActions('click "Add", select "PS5" in "Platform", submit'), 1);
});

test("chained actions count separately", () => {
  assert.equal(countStepActions('select "Gloomhaven", click "Confirm"'), 2);
  assert.equal(countStepActions('click "Add", submit, select "PS5"'), 2);
  assert.equal(countStepActions('click "Manage", select "Delete"'), 2);
  assert.equal(countStepActions('/journal view\nclick "Manage"'), 2);
  assert.equal(countStepActions('click "Mike" and click "Add Entry"'), 2);
  assert.equal(countStepActions('select "Gloomhaven" and click "Confirm"'), 2);
  assert.equal(
    countStepActions('click "Mike", click "Add Entry", enter "x" in "Title", submit'),
    2,
  );
});

test("a step chaining several actions passes with a warning", () => {
  const chained = [
    "### Step 1: Chained",
    FENCE,
    'select "Gloomhaven", click "Confirm"',
    FENCE,
    'Expected: "Saved"',
    "Ephemeral: yes",
    "",
  ];
  const result = checkPrTesting(body(chained));
  assert.equal(result.ok, true);
  assert.match(result.lines.join("\n"), /step\(s\) 1 chain several actions/);
  assert.doesNotMatch(checkPrTesting(VALID).lines.join("\n"), /chain several actions/);
});

test("text after an Ephemeral line is rejected with the parser's reason", () => {
  const result = checkPrTesting(NOTE_AFTER_EPHEMERAL);
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /extra content after its Ephemeral line/);
});

test("a body with no Testing section passes", () => {
  assert.equal(checkPrTesting(NO_TESTING).ok, true);
});

test("a Testing section holding only the template comment passes", () => {
  const result = checkPrTesting(body(["<!-- format reminder -->", ""]));
  assert.equal(result.ok, true);
  assert.match(result.lines[0], /no steps/);
});

test("the script exits 0 on a valid body and 1 on a malformed one", () => {
  const valid = runScript(VALID);
  assert.equal(valid.status, 0, valid.output);
  assert.match(valid.output, /parses into 2 step\(s\)/);

  const malformed = runScript(NOTE_AFTER_EPHEMERAL);
  assert.equal(malformed.status, 1, malformed.output);
  assert.match(malformed.output, /cannot be parsed/);
});

test("the script exits 2 without a readable body file", () => {
  const result = runScriptOn(path.join(os.tmpdir(), "pr-testing-missing", "body.md"));
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /Cannot read/);
});
