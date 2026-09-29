import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifySnapshot,
  judgeStep,
  parseMirrorMessage,
  type IMessageSnapshot,
  type IObservedOutput,
} from "../conductor/ConductorObservation.js";
import { buildRunReport, fenceFor } from "../conductor/ConductorReport.js";
import {
  checkStepButton,
  loadRun,
  saveRun,
  type IConductorRun,
} from "../conductor/ConductorState.js";
import type { ITestStep } from "../conductor/TestPlanParser.js";
import { formatMirrorMessage } from "../functions/EphemeralMirror.js";

const USER = "100";
const PREVIEW_BOT = "800";
const CONTEXT = {
  selfId: "900",
  allowedUserId: USER,
  testChannelId: "700",
  mirrorChannelId: "700",
};

function snapshot(overrides: Partial<IMessageSnapshot>): IMessageSnapshot {
  return {
    id: "1",
    channelId: "700",
    authorId: PREVIEW_BOT,
    authorIsBot: true,
    webhookId: null,
    createdTimestamp: 0,
    editedTimestamp: null,
    content: "",
    interactionUserId: null,
    embeds: [],
    components: [],
    ...overrides,
  };
}

function mirrorPost(id: string, at: number, source: string, content: string): IMessageSnapshot {
  return snapshot({
    id,
    createdTimestamp: at,
    content: formatMirrorMessage({
      kind: "reply",
      source,
      user: USER,
      channelId: "700",
      content,
    }),
  });
}

function makeStep(overrides: Partial<ITestStep>): ITestStep {
  return {
    number: 1,
    label: "label",
    command: "/collection add",
    expected: "a \"Search for a game\" button",
    ephemeral: true,
    expectedTexts: ["Search for a game"],
    ...overrides,
  };
}

function observe(snapshots: IMessageSnapshot[]): IObservedOutput[] {
  return snapshots
    .map((entry) => classifySnapshot(entry, CONTEXT))
    .filter((entry): entry is IObservedOutput => entry !== null);
}

test("reads back what the ephemeral mirror writes", () => {
  const post = mirrorPost("1", 10, "/collection", "hi");
  const parsed = parseMirrorMessage(post.content);
  assert.equal(parsed?.user, USER);
  assert.equal(parsed?.source, "/collection");
});

test("recovers user and source from a mirror post truncated at the length cap", () => {
  const long = "x".repeat(3000);
  const post = mirrorPost("1", 10, "/collection", long);
  assert.ok(post.content.length <= 2000);
  const parsed = parseMirrorMessage(post.content);
  assert.equal(parsed?.user, USER);
  assert.equal(parsed?.source, "/collection");
});

test("attributes ephemeral output to the step whose window it landed in", () => {
  const outputs = observe([
    mirrorPost("early", 50, "/collection", "Search for a game"),
    mirrorPost("mine", 150, "/collection", "Pick one: Search for a game"),
    mirrorPost("late", 250, "/collection", "Search for a game"),
  ]);
  const result = judgeStep(makeStep({}), outputs, { start: 100, end: 200 });
  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.observed.map((entry) => entry.messageId), ["mine"]);
});

test("does not credit a slash step with a different command's mirrored reply", () => {
  const outputs = observe([mirrorPost("other", 150, "/profile", "Search for a game")]);
  const result = judgeStep(makeStep({}), outputs, { start: 100, end: 200 });
  assert.equal(result.verdict, "fail");
  assert.deepEqual(result.unattributed.map((entry) => entry.messageId), ["other"]);
});

test("credits a component step with the component's mirrored update", () => {
  const outputs = observe([mirrorPost("u", 150, "component:search:1", "Gloomhaven")]);
  const componentStep = makeStep({
    command: "click \"Search for a game\"",
    expectedTexts: ["Gloomhaven"],
  });
  const result = judgeStep(componentStep, outputs, { start: 100, end: 200 });
  assert.equal(result.verdict, "pass");
});

test("does not accept public output for an ephemeral step", () => {
  const outputs = observe([snapshot({
    id: "pub",
    createdTimestamp: 150,
    content: "Search for a game",
    interactionUserId: USER,
  })]);
  const result = judgeStep(makeStep({}), outputs, { start: 100, end: 200 });
  assert.equal(result.verdict, "fail");
  assert.match(result.reason, /No output observed in the ephemeral mirror channel/);
});

test("matches public embed titles and credits a message edited inside the window", () => {
  const outputs = observe([snapshot({
    id: "edited",
    createdTimestamp: 10,
    editedTimestamp: 150,
    interactionUserId: USER,
    embeds: [{ title: "Collection updated", fields: [{ name: "Game", value: "Gloomhaven" }] }],
  })]);
  const publicStep = makeStep({ ephemeral: false, expectedTexts: ["collection UPDATED"] });
  const result = judgeStep(publicStep, outputs, { start: 100, end: 200 });
  assert.equal(result.verdict, "pass");
});

test("fails a step that produced no output, and names the missing text otherwise", () => {
  const none = judgeStep(makeStep({}), [], { start: 100, end: 200 });
  assert.equal(none.verdict, "fail");

  const outputs = observe([mirrorPost("m", 150, "/collection", "something else")]);
  const missing = judgeStep(makeStep({}), outputs, { start: 100, end: 200 });
  assert.equal(missing.verdict, "fail");
  assert.match(missing.reason, /"Search for a game"/);
});

test("leaves a step with nothing quoted for the tester instead of passing it", () => {
  const outputs = observe([mirrorPost("m", 150, "/collection", "anything")]);
  const result = judgeStep(makeStep({ expectedTexts: [] }), outputs, { start: 100, end: 200 });
  assert.equal(result.verdict, "unverified");
});

test("the report carries the observed payload for a failed step", () => {
  const outputs = observe([mirrorPost("m", 150, "/collection", "something else")]);
  const step = makeStep({});
  const report = buildRunReport({
    pr: 7,
    headSha: "abcdef1234",
    runId: "42",
    steps: [step, makeStep({ number: 2 })],
    results: [judgeStep(step, outputs, { start: 100, end: 200 })],
    aborted: true,
  });
  assert.match(report, /Step 1: label: FAIL/);
  assert.match(report, /something else/);
  assert.match(report, /Step 2: label\n\nNot run\./);
  assert.match(report, /Aborted run `42` against `abcdef1`/);
});

test("fenceFor outgrows any backtick run inside the payload", () => {
  const fenced = fenceFor("a ```` b", "json");
  assert.ok(fenced.startsWith("`````json\n"));
  assert.ok(fenced.endsWith("\n`````"));
});

function makeRun(overrides: Partial<IConductorRun> = {}): IConductorRun {
  return {
    runId: "42",
    pr: 7,
    headSha: "abc",
    steps: [makeStep({})],
    current: 0,
    windowStart: 100,
    results: [],
    status: "running",
    ...overrides,
  };
}

test("a step button is live only for the running run's current step", () => {
  assert.equal(checkStepButton(makeRun(), "42", 0).ok, true);
  assert.equal(checkStepButton(null, "42", 0).ok, false);
  assert.equal(checkStepButton(makeRun(), "41", 0).ok, false);
  assert.equal(checkStepButton(makeRun(), "42", 1).ok, false);
  assert.equal(checkStepButton(makeRun({ status: "aborted" }), "42", 0).ok, false);
});

test("run state survives a save and reload, as a restart would", async () => {
  const dir = await mkdtemp(join(tmpdir(), "conductor-state-"));
  try {
    const path = join(dir, "nested", "state.json");
    assert.equal(await loadRun(path), null);
    await saveRun(path, makeRun({ current: 0 }));
    assert.deepEqual(await loadRun(path), makeRun({ current: 0 }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
