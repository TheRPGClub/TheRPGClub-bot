import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { checkPrTesting } from "../conductor/PrTestingCheck.js";

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
