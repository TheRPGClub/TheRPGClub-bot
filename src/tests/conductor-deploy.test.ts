import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { readConductorRevision } from "../conductor/ConductorRevision.js";

type PlanModule = {
  CONDUCTOR_ENTRY: string;
  conductorSources: (root: string) => Set<string>;
  conductorChanges: (args: { changed: string[]; sources: Set<string> }) => string[];
};

// A runtime path keeps tsc from pulling the workflow script, outside src, into the build.
const PLAN_MODULE = new URL("../../scripts/conductor/plan.mjs", import.meta.url).href;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const plan = await import(PLAN_MODULE) as PlanModule;

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

test("conductorSources follows the conductor's relative imports into shared modules", () => {
  const sources = plan.conductorSources(ROOT);
  assert.ok(sources.has(plan.CONDUCTOR_ENTRY));
  assert.ok(sources.has("src/conductor/TestPlanParser.ts"));
  assert.ok(sources.has("src/conductor/ConductorRevision.ts"));
  assert.ok(sources.has("src/config/users.ts"), "a shared config module it imports");
  assert.ok(sources.has("src/functions/EphemeralMirror.ts"), "a shared function it imports");
});

test("conductorSources leaves out bot code the conductor never loads", () => {
  const sources = plan.conductorSources(ROOT);
  assert.ok(!sources.has("src/RPGClub_GameDB.ts"));
  assert.ok(![...sources].some((path) => path.startsWith("src/commands/")));
  assert.ok(![...sources].some((path) => path.startsWith("src/tests/")));
});

test("conductorChanges keeps conductor sources and runtime files only", () => {
  const sources = new Set(["src/conductor/main.ts", "src/config/users.ts"]);
  const changed = [
    "src/commands/profile.command.ts",
    "src/config/users.ts",
    "package-lock.json",
    "docs/conductor.md",
  ];
  assert.deepEqual(plan.conductorChanges({ changed, sources }), [
    "src/config/users.ts",
    "package-lock.json",
  ]);
});

test("conductorChanges finds nothing in a push that only touches the bot", () => {
  const sources = plan.conductorSources(ROOT);
  const changed = ["src/commands/profile.command.ts", "db/users.md"];
  assert.deepEqual(plan.conductorChanges({ changed, sources }), []);
});

test("readConductorRevision prefers the release's REVISION file", () => {
  const revision = readConductorRevision("/release", {
    readRevisionFile: () => `${SHA_A}\n`,
    gitHead: () => SHA_B,
  });
  assert.equal(revision, SHA_A);
});

test("readConductorRevision falls back to git in a checkout", () => {
  const revision = readConductorRevision("/checkout", {
    readRevisionFile: () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    gitHead: () => `${SHA_B}\n`,
  });
  assert.equal(revision, SHA_B);
});

test("readConductorRevision reports unknown when neither names a commit", () => {
  const revision = readConductorRevision("/nowhere", {
    readRevisionFile: () => "not a sha",
    gitHead: () => {
      throw new Error("not a git repository");
    },
  });
  assert.equal(revision, "unknown");
});
