import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifySnapshot,
  confirmedResult,
  failedResult,
  judgeStep,
  parseMirrorMessage,
  type IMessageSnapshot,
  type IObservedOutput,
} from "../conductor/ConductorObservation.js";
import {
  buildCurrentStepMessage,
  buildNoteModalCustomId,
  parseNoteModalCustomId,
} from "../conductor/ConductorMessages.js";
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
    applicationId: null,
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
    ...overrides,
  };
}

function observe(snapshots: IMessageSnapshot[]): IObservedOutput[] {
  return snapshots
    .map((entry) => classifySnapshot(entry, CONTEXT))
    .filter((entry): entry is IObservedOutput => entry !== null);
}

test("drops the conductor's own step prompt posted in the test channel", () => {
  const prompt = snapshot({
    authorId: CONTEXT.selfId,
    content: "Run this in <#700>:\nPress **Check** once the output has appeared.",
  });
  assert.equal(classifySnapshot(prompt, CONTEXT), null);
});

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
    expected: "\"Gloomhaven\"",
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
  assert.match(result.reason, /No output observed in the ephemeral mirror channel\./);
  assert.match(result.reason, /A public reply arrived instead/);
  assert.deepEqual(result.unattributed.map((entry) => entry.messageId), ["pub"]);
});

test("a click step never owns a slash command's late mirrored reply", () => {
  const outputs = observe([mirrorPost("late", 150, "/collection", "Gloomhaven")]);
  const clickStep = makeStep({ command: "click \"Search\"", expected: "\"Gloomhaven\"" });
  const result = judgeStep(clickStep, outputs, { start: 100, end: 200 });
  assert.equal(result.verdict, "fail");
  assert.deepEqual(result.unattributed.map((entry) => entry.messageId), ["late"]);
});

test("does not accept mirrored ephemeral output for a public step", () => {
  const outputs = observe([mirrorPost("m", 150, "/collection", "Search for a game")]);
  const result = judgeStep(makeStep({ ephemeral: false }), outputs, { start: 100, end: 200 });
  assert.equal(result.verdict, "fail");
  assert.match(result.reason, /No output observed in the test channel/);
});

test("matches public embed titles and credits a message edited inside the window", () => {
  const outputs = observe([snapshot({
    id: "edited",
    createdTimestamp: 10,
    editedTimestamp: 150,
    interactionUserId: USER,
    embeds: [{ title: "Collection updated", fields: [{ name: "Game", value: "Gloomhaven" }] }],
  })]);
  const publicStep = makeStep({ ephemeral: false, expected: "\"collection UPDATED\"" });
  const result = judgeStep(publicStep, outputs, { start: 100, end: 200 });
  assert.equal(result.verdict, "pass");
});

test("credits a public interaction reply, which Discord sends through the app's webhook", () => {
  const outputs = observe([snapshot({
    id: "reply",
    createdTimestamp: 150,
    webhookId: "app",
    applicationId: "app",
    interactionUserId: USER,
    content: "## Now Playing Search",
  })]);
  const publicStep = makeStep({ ephemeral: false, expected: "\"Now Playing Search\"" });
  const result = judgeStep(publicStep, outputs, { start: 100, end: 200 });
  assert.equal(result.verdict, "pass");
});

test("drops a post from some other webhook", () => {
  const foreign = snapshot({ id: "hook", createdTimestamp: 150, webhookId: "555" });
  assert.equal(classifySnapshot(foreign, CONTEXT), null);
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
  const result = judgeStep(makeStep({ expected: "a reply" }), outputs, { start: 100, end: 200 });
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

test("a long report drops whole steps rather than cutting inside a fence", () => {
  const big = "y".repeat(2900);
  const outputs = observe(Array.from({ length: 5 }, (_, index) =>
    mirrorPost(`m${index}`, 150 + index, "/collection", big)));
  const steps = Array.from({ length: 25 }, (_, index) => makeStep({ number: index + 1 }));
  const results = steps.map((step) =>
    judgeStep(step, outputs, { start: 100, end: 200 }));
  const report = buildRunReport({
    pr: 7, headSha: "abcdef1", runId: "42", steps, results, aborted: false,
  });
  assert.ok(report.length <= 60000);
  assert.match(report, /Report truncated: \d+ step\(s\) omitted for length\.$/);
  const fences = report.split("\n").filter((line) => /^`{3,}/.test(line));
  assert.equal(fences.length % 2, 0);
});

test("the report escapes a mirrored source before quoting it", () => {
  const outputs = observe([mirrorPost("m", 150, "component:@team", "other")]);
  const step = makeStep({ command: "click it" });
  const report = buildRunReport({
    pr: 7, headSha: "abcdef1", runId: "42", steps: [step],
    results: [judgeStep(step, outputs, { start: 100, end: 200 })], aborted: false,
  });
  assert.match(report, /from component:\\@team/);
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
    channelId: "700",
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

test("an unreadable state file reads as no run instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "conductor-state-"));
  try {
    const path = join(dir, "state.json");
    await writeFile(path, "{ not json");
    assert.equal(await loadRun(path), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

function publicReply(overrides: Partial<IMessageSnapshot>): IObservedOutput[] {
  return observe([snapshot({ id: "p", createdTimestamp: 150, interactionUserId: USER, ...overrides })]);
}

test("a scoped check only matches its own part of the payload", () => {
  // Raw API JSON, as `snapshotMessage` stores it: a row holding a button and a select.
  const button = { type: 2, label: "Keep", custom_id: "keep" };
  const select = { type: 3, custom_id: "pick", options: [{ label: "Gloomhaven", value: "1" }] };
  const outputs = publicReply({
    content: "## Collection updated\nPress Undo to revert.",
    components: [{ type: 1, components: [button, select] }],
    embeds: [{ fields: [{ name: "Platform", value: "PC" }] }],
  });
  const judge = (expected: string): string =>
    judgeStep(makeStep({ ephemeral: false, expected }), outputs, { start: 100, end: 200 })
      .verdict;
  assert.equal(judge("title: \"Collection updated\""), "pass");
  assert.equal(judge("button: \"Keep\" option: \"Gloomhaven\" field: \"PC\""), "pass");
  assert.equal(judge("button: \"Undo\""), "fail");
  assert.equal(judge("title: \"Keep\""), "fail");
});

test("fails a step when text it rules out appears, and names it", () => {
  const outputs = publicReply({ content: "Saved. Error: none" });
  const result = judgeStep(
    makeStep({ ephemeral: false, expected: "\"Saved\" and not: \"Error\"" }),
    outputs,
    { start: 100, end: 200 },
  );
  assert.equal(result.verdict, "fail");
  assert.match(result.reason, /should be absent: "Error"/);
});

test("a step that only rules text out still needs the tester's eyes", () => {
  const outputs = publicReply({ content: "Saved" });
  const result = judgeStep(
    makeStep({ ephemeral: false, expected: "no not: \"Error\"" }),
    outputs,
    { start: 100, end: 200 },
  );
  assert.equal(result.verdict, "unverified");
});

test("a truncated mirror post satisfies a scoped check by its text", () => {
  const outputs: IObservedOutput[] = [{
    place: "mirror",
    messageId: "t",
    at: 150,
    createdAt: 150,
    source: "/collection",
    payload: "{\"source\": \"/collection\", \"components\": [{\"label\": \"Keep\"...",
  }];
  const result = judgeStep(makeStep({ expected: "button: \"Keep\"" }), outputs, {
    start: 100,
    end: 200,
  });
  assert.equal(result.verdict, "pass");
});

test("the report quotes the tester's note under its step, run or not", () => {
  const step = makeStep({});
  const report = buildRunReport({
    pr: 7,
    headSha: "abcdef1234",
    runId: "42",
    steps: [step, makeStep({ number: 2 })],
    results: [judgeStep(step, [], { start: 100, end: 200 })],
    notes: { 1: "The modal never opened.", 2: "Skipped: needs ```data```" },
    aborted: true,
  });
  assert.match(report, /FAIL[\s\S]*Tester note:\n\n```\nThe modal never opened\.\n```/);
  assert.match(report, /Not run\.\n\nTester note:\n\n````\nSkipped: needs ```data```\n````/);
});

test("note modal IDs round-trip their run, step, and mode", () => {
  const id = buildNoteModalCustomId("123", 4, "fail");
  assert.deepEqual(parseNoteModalCustomId(id), { runId: "123", step: 4, mode: "fail" });
  assert.equal(parseNoteModalCustomId(`${id}x`), null);
});

test("a not: check skips a truncated mirror post, whose JSON keys would trip it", () => {
  const outputs: IObservedOutput[] = [{
    place: "mirror",
    messageId: "t",
    at: 150,
    createdAt: 150,
    source: "/collection",
    payload: "{\"kind\": \"reply\", \"content\": \"Saved...",
  }];
  const result = judgeStep(makeStep({ expected: "\"Saved\" not: \"reply\"" }), outputs, {
    start: 100,
    end: 200,
  });
  assert.equal(result.verdict, "pass");
});

test("the tester's answer turns unchecked output into a pass or a fail", () => {
  const outputs = publicReply({ content: "Saved" });
  const pending = judgeStep(makeStep({ ephemeral: false, expected: "a reply" }), outputs, {
    start: 100,
    end: 200,
  });
  assert.equal(pending.verdict, "unverified");
  assert.equal(confirmedResult(pending).verdict, "pass");
  assert.match(confirmedResult(pending).reason, /tester confirmed/);
  assert.equal(failedResult(pending).verdict, "fail");
  assert.match(failedResult(pending).reason, /does not match Expected/);

  const failed = judgeStep(makeStep({}), [], { start: 100, end: 200 });
  assert.equal(failedResult(failed), failed);
});

function customIdsOf(run: IConductorRun): string[] {
  const json = JSON.stringify(buildCurrentStepMessage(run, "700").components);
  return [...json.matchAll(/"custom_id":"([a-z-]+-v1):/g)].map((match) => match[1]);
}

test("the step message offers the buttons its pending check calls for", () => {
  const run: IConductorRun = {
    runId: "42",
    pr: 7,
    headSha: "abc",
    steps: [makeStep({})],
    current: 0,
    windowStart: 0,
    results: [],
    status: "running",
    notes: { 1: "Looked slow." },
  };
  assert.deepEqual(customIdsOf(run), ["conductor-check-v1", "conductor-note-v1",
    "conductor-abort-v1"]);
  assert.match(JSON.stringify(buildCurrentStepMessage(run, "700").components),
    /Your note: Looked slow\./);

  run.pendingResult = judgeStep(makeStep({}), [], { start: 100, end: 200 });
  assert.deepEqual(customIdsOf(run), ["conductor-check-v1", "conductor-accept-v1",
    "conductor-note-v1", "conductor-abort-v1"]);

  run.pendingResult = { ...run.pendingResult, verdict: "unverified" };
  assert.deepEqual(customIdsOf(run), ["conductor-confirm-v1", "conductor-accept-v1",
    "conductor-check-v1", "conductor-note-v1", "conductor-abort-v1"]);
});
