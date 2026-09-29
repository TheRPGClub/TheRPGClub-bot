import test from "node:test";
import assert from "node:assert/strict";

import { MAX_TEST_STEPS, parseTestPlan } from "../conductor/TestPlanParser.js";

const FENCE = "```";

function step(n: number, command: string, expected: string, ephemeral: string): string {
  return [
    `### Step ${n}: Step ${n} label`,
    FENCE,
    command,
    FENCE,
    `Expected: ${expected}`,
    `Ephemeral: ${ephemeral}`,
  ].join("\n");
}

function body(section: string): string {
  return `## Summary\n- a change\n\n## Testing\n\n${section}\n\n## Checklist\n- [x] done\n`;
}

const WORKED_EXAMPLE = [
  "### Step 1: Open the collection add flow",
  FENCE,
  "/collection add",
  FENCE,
  "Expected: an ephemeral reply with a game search modal trigger button labelled",
  "\"Search for a game\".",
  "Ephemeral: yes",
  "",
  "### Step 2: Search for a game",
  FENCE,
  "click \"Search for a game\", enter \"Gloomhaven\", submit",
  FENCE,
  "Expected: the ephemeral reply updates to a list of matching games, each with a",
  "select option. \"Gloomhaven\" is the first result.",
  "Ephemeral: yes",
  "",
  "### Step 3: Confirm the selection",
  FENCE,
  "select \"Gloomhaven\", click \"Confirm\"",
  FENCE,
  "Expected: a public embed in the channel titled \"Collection updated\" naming",
  "Gloomhaven, and the ephemeral flow reply is dismissed.",
  "Ephemeral: no",
].join("\n");

test("parses the format doc's worked example into an ordered script", () => {
  const result = parseTestPlan(body(WORKED_EXAMPLE));
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.deepEqual(result.steps.map((entry) => entry.number), [1, 2, 3]);
  assert.equal(result.steps[0].label, "Open the collection add flow");
  assert.equal(result.steps[0].command, "/collection add");
  assert.equal(result.steps[0].ephemeral, true);
  assert.deepEqual(result.steps[0].expectedTexts, ["Search for a game"]);
  assert.equal(result.steps[1].command, "click \"Search for a game\", enter \"Gloomhaven\", submit");
  assert.equal(result.steps[2].ephemeral, false);
  assert.deepEqual(result.steps[2].expectedTexts, ["Collection updated"]);
  assert.match(result.steps[2].expected, /naming Gloomhaven, and the ephemeral/);
});

test("stops the section at the next level-two heading", () => {
  const result = parseTestPlan(body(step(1, "/help", "a \"Help\" reply", "no")));
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") assert.equal(result.steps.length, 1);
});

test("ignores the template's HTML comment", () => {
  const section = `<!--\n### Step N: <short label>\n${FENCE}\nx\n${FENCE}\n-->\n` +
    step(1, "/help", "help", "no");
  const result = parseTestPlan(body(section));
  assert.equal(result.kind, "ok");
});

test("reports a missing section as absent and a comment-only one as empty", () => {
  assert.deepEqual(parseTestPlan("## Summary\n- nothing\n"), { kind: "absent" });
  assert.deepEqual(parseTestPlan(null), { kind: "absent" });
  assert.deepEqual(parseTestPlan(body("<!-- delete me -->")), { kind: "empty" });
});

const MALFORMED: [string, string][] = [
  ["a missing Ephemeral line", step(1, "/help", "help", "no").replace("\nEphemeral: no", "")],
  ["an Ephemeral value other than yes or no", step(1, "/help", "help", "maybe")],
  ["a capitalized Ephemeral value", step(1, "/help", "help", "Yes")],
  ["steps numbered out of order", step(2, "/help", "help", "no")],
  ["a step with no code block", "### Step 1: x\nExpected: y\nEphemeral: no"],
  ["an unclosed code block", `### Step 1: x\n${FENCE}\n/help\nExpected: y\nEphemeral: no`],
  ["an empty code block", `### Step 1: x\n${FENCE}\n${FENCE}\nExpected: y\nEphemeral: no`],
  ["two code blocks in one step", `${step(1, "/help", "help", "no")}\n${FENCE}\n/x\n${FENCE}`],
  ["a missing Expected line", `### Step 1: x\n${FENCE}\n/help\n${FENCE}\nEphemeral: no`],
  ["prose before the first step", `Run these:\n${step(1, "/help", "help", "no")}`],
  ["a heading without a label", `### Step 1:\n${FENCE}\n/help\n${FENCE}\nExpected: y\nEphemeral: no`],
];

for (const [name, section] of MALFORMED) {
  test(`degrades to malformed, never a partial script, for ${name}`, () => {
    const result = parseTestPlan(body(section));
    assert.equal(result.kind, "malformed");
  });
}

test("a malformed later step discards the steps parsed before it", () => {
  const section = `${step(1, "/help", "help", "no")}\n\n${step(2, "/x", "x", "sometimes")}`;
  const result = parseTestPlan(body(section));
  assert.equal(result.kind, "malformed");
  assert.equal("steps" in result, false);
});

test("refuses more steps than the cap", () => {
  const steps = Array.from({ length: MAX_TEST_STEPS + 1 }, (_, index) =>
    step(index + 1, "/help", "help", "no"));
  assert.equal(parseTestPlan(body(steps.join("\n\n"))).kind, "malformed");
});

test("accepts CRLF line endings", () => {
  const result = parseTestPlan(body(step(1, "/help", "help", "no")).replace(/\n/g, "\r\n"));
  assert.equal(result.kind, "ok");
});
