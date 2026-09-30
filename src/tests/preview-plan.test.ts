import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type PreviewPlan = { deploy: boolean; kind: string; reason: string };
type PlanModule = {
  planPreview: (args: {
    action: string;
    body?: string | null;
    previousBody?: string | null;
    rerun?: boolean;
  }) => PreviewPlan;
};

// A runtime path keeps tsc from pulling the workflow script, outside src, into the build.
const PLAN_MODULE = new URL("../../scripts/preview/plan.mjs", import.meta.url).href;
const PARSER_FILE = new URL("../conductor/TestPlanParser.ts", import.meta.url);
const { planPreview } = await import(PLAN_MODULE) as PlanModule;

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

test("a body with runnable Testing steps deploys", () => {
  assert.deepEqual(planPreview({ action: "opened", body: RUNNABLE }), {
    deploy: true, kind: "ok", reason: "",
  });
  assert.equal(planPreview({ action: "synchronize", body: RUNNABLE }).deploy, true);
});

test("a body with no Testing section or an empty one never deploys", () => {
  assert.deepEqual(planPreview({ action: "opened", body: UNTESTED }), {
    deploy: false, kind: "absent", reason: "",
  });
  assert.equal(planPreview({ action: "opened", body: null }).kind, "absent");
  const empty = planPreview({ action: "opened", body: `${UNTESTED}\n## Testing\n\n` });
  assert.deepEqual(empty, { deploy: false, kind: "empty", reason: "" });
});

test("a malformed Testing section never deploys and carries the parser's reason", () => {
  const plan = planPreview({ action: "opened", body: MALFORMED });
  assert.equal(plan.deploy, false);
  assert.equal(plan.kind, "malformed");
  assert.match(plan.reason, /Step 1/);
});

test("an edit deploys only when it gave the body its Testing steps", () => {
  const gained = planPreview({ action: "edited", body: RUNNABLE, previousBody: UNTESTED });
  assert.equal(gained.deploy, true);
  const fixed = planPreview({ action: "edited", body: RUNNABLE, previousBody: MALFORMED });
  assert.equal(fixed.deploy, true);
  const reworded = planPreview({
    action: "edited", body: RUNNABLE.replace("a change", "a reworded change"),
    previousBody: RUNNABLE,
  });
  assert.deepEqual(reworded, { deploy: false, kind: "ok", reason: "" });
  const removed = planPreview({ action: "edited", body: UNTESTED, previousBody: RUNNABLE });
  assert.deepEqual(removed, { deploy: false, kind: "absent", reason: "" });
});

test("a re-run deploys a body with Testing steps whatever event started it", () => {
  const rerun = planPreview({
    action: "edited", body: RUNNABLE, previousBody: RUNNABLE, rerun: true,
  });
  assert.equal(rerun.deploy, true);
  const untested = planPreview({ action: "edited", body: UNTESTED, rerun: true });
  assert.equal(untested.deploy, false);
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
