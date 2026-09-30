import test from "node:test";
import assert from "node:assert/strict";

type Comment = { body?: string | null };
type StatusModule = {
  previewState: (comments?: Comment[] | null) => string;
  summarizePullRequests: (prs: Array<{
    number: number;
    title: string;
    body?: string | null;
    isCrossRepository?: boolean;
    comments?: Comment[];
  }>) => Array<{ number: number; testing: string; fork: boolean; preview: string }>;
};

// A runtime path keeps tsc from pulling the workflow script, outside src, into the build.
const STATUS_MODULE = new URL("../../scripts/preview/status.mjs", import.meta.url).href;
const { previewState, summarizePullRequests } = await import(STATUS_MODULE) as StatusModule;

const MARKER = "<!-- rpgclub-pr-preview -->";
const sticky = (status: string): Comment => ({
  body: [MARKER, "### PR preview", status, "", "[Workflow run](https://example)"].join("\n"),
});

test("previewState reads the status line of the sticky comment", () => {
  assert.equal(previewState([sticky(":green_circle: Running `abc1234`")]), "running");
  assert.equal(previewState([sticky(":yellow_circle: Still running `abc1234`")]), "behind");
  assert.equal(previewState([sticky(":hourglass: Building `abc1234`")]), "building");
  assert.equal(previewState([sticky(":white_circle: Preview torn down.")]), "none");
  assert.equal(previewState([sticky(":red_circle: Preview failed")]), "none");
});

test("previewState ignores other comments and PRs with none", () => {
  assert.equal(previewState(undefined), "none");
  assert.equal(previewState([{ body: ":green_circle: not the sticky comment" }]), "none");
  assert.equal(previewState([
    sticky(":green_circle: Running `abc1234`"),
    { body: "a later review comment" },
  ]), "running");
});

test("summarizePullRequests sorts by number and classifies each PR", () => {
  const rows = summarizePullRequests([
    { number: 9, title: "b", body: "## Summary\n- x\n", isCrossRepository: true },
    { number: 3, title: "a", body: null, comments: [sticky(":green_circle: Running")] },
  ]);
  assert.deepEqual(rows.map((row) => row.number), [3, 9]);
  assert.equal(rows[0].preview, "running");
  assert.equal(rows[0].testing, "absent");
  assert.equal(rows[1].fork, true);
});
