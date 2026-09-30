import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type TestingSteps = { kind: string; reason: string };
type PullRequest = {
  number: number;
  state: string;
  body?: string | null;
  head: { repo?: { full_name?: string } | null };
};
type PlanModule = {
  testingSteps: (body?: string | null) => TestingSteps;
  deployRefusal: (args: { pr: PullRequest; repository: string }) => TestingSteps & {
    refusal: string;
  };
};

// A runtime path keeps tsc from pulling the workflow script, outside src, into the build.
const PLAN_MODULE = new URL("../../scripts/preview/plan.mjs", import.meta.url).href;
const PARSER_FILE = new URL("../conductor/TestPlanParser.ts", import.meta.url);
const { testingSteps, deployRefusal } = await import(PLAN_MODULE) as PlanModule;

const FENCE = "```";
const RUNNABLE = [
  "## Summary\n- a change\n",
  "## Testing\n",
  "### Step 1: Ping",
  FENCE,
  "/ping",
  FENCE,
  "Expected: \"Pong\"",
  "Ephemeral: no\n",
].join("\n");
const UNTESTED = "## Summary\n- a change\n";
const MALFORMED = "## Summary\n- a change\n\n## Testing\n\nJust run /ping.\n";
const REPOSITORY = "owner/repo";

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 7,
    state: "open",
    body: RUNNABLE,
    head: { repo: { full_name: REPOSITORY } },
    ...overrides,
  };
}

test("testingSteps classifies a body the way /conduct does", () => {
  assert.deepEqual(testingSteps(RUNNABLE), { kind: "ok", reason: "" });
  assert.deepEqual(testingSteps(UNTESTED), { kind: "absent", reason: "" });
  assert.equal(testingSteps(null).kind, "absent");
  assert.deepEqual(testingSteps(`${UNTESTED}\n## Testing\n\n`), { kind: "empty", reason: "" });
  const malformed = testingSteps(MALFORMED);
  assert.equal(malformed.kind, "malformed");
  assert.match(malformed.reason, /Step 1/);
});

test("an open same-repo PR with runnable Testing steps may deploy", () => {
  const plan = deployRefusal({ pr: pullRequest(), repository: REPOSITORY });
  assert.deepEqual(plan, { refusal: "", kind: "ok", reason: "" });
});

test("a closed PR is refused", () => {
  const plan = deployRefusal({ pr: pullRequest({ state: "closed" }), repository: REPOSITORY });
  assert.equal(plan.refusal, "PR #7 is closed.");
});

test("a fork PR is refused, including one whose head repo was deleted", () => {
  const fork = pullRequest({ head: { repo: { full_name: "someone/repo" } } });
  assert.match(deployRefusal({ pr: fork, repository: REPOSITORY }).refusal, /fork/);
  const gone = pullRequest({ head: { repo: null } });
  assert.match(deployRefusal({ pr: gone, repository: REPOSITORY }).refusal, /fork/);
});

test("a PR without runnable Testing steps is refused, with the parser's reason", () => {
  const untested = deployRefusal({
    pr: pullRequest({ body: UNTESTED }), repository: REPOSITORY,
  });
  assert.match(untested.refusal, /no Testing steps/);
  const malformed = deployRefusal({
    pr: pullRequest({ body: MALFORMED }), repository: REPOSITORY,
  });
  assert.equal(malformed.kind, "malformed");
  assert.match(malformed.refusal, /could not be parsed: [\s\S]*Step 1/);
});

// The workflow imports the parser under Node's built-in type stripping, which cannot
// follow the `.js` import specifiers the rest of src uses or rewrite non-erasable syntax.
test("the Testing parser stays importable by Node's type stripping", async () => {
  const source = await readFile(PARSER_FILE, "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /^\s*(export\s+)?(const\s+)?enum\s/m);
  assert.doesNotMatch(source, /^\s*(export\s+)?namespace\s/m);
  assert.doesNotMatch(source, /constructor\(\s*(public|private|protected|readonly)\s/);
});
