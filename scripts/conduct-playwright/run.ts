// Runs a PR's driveable Testing steps in Discord web with Playwright, while the tester
// watches the headed browser. The conductor still posts and judges every step and writes
// the PR report; this only performs each `drive` step's one action and presses Check.
// `hand-off` steps are left for the tester and listed in the summary.
//
// Usage: npm run -s conduct:playwright -- <pr> [--hand-off 3,5] [--local]
// It never runs headless or in CI; see "Playwright runner" in docs/conductor.md.

import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createInterface } from "readline/promises";

import {
  chromium,
  errors,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";

import { TEST_GUILD_IDS, TEST_GUILD_SNOWFLAKE } from "../../src/config/testGuild.ts";
import { parseDriveAction, type DriveAction } from "../../src/conductor/DriveActions.ts";
import { buildDrivePlan, type IDriveStep } from "../../src/conductor/DrivePlan.ts";
import {
  currentStep,
  findStepMessage,
  HandOff,
  messageList,
  newestText,
  passkeyButton,
  pendingVerdict,
  performAction,
  reportUrl,
  scrollToBottom,
  startConductRun,
  TIMING,
  waitForReply,
} from "./discord.ts";

interface IRunStep extends IDriveStep {
  parsed: DriveAction | null;
}

interface IOutcome {
  number: number;
  result: "passed" | "handed back" | "hand-off";
  detail: string;
}

const USAGE = "Usage: npm run -s conduct:playwright -- <pr> [--hand-off 3,5] [--local]";
/** The runner's own code and what it imports; it must not lag main unless `--local`. */
const RUNNER_PATHS = [
  "scripts/conduct-playwright",
  "src/conductor",
  "src/config/previewMode.ts",
  "src/config/testGuild.ts",
  "src/config/users.ts",
];
/** Each run's throwaway Chrome profile lives under here and is deleted when it ends. */
const PROFILE_PARENT = os.tmpdir();
const PROFILE_NAME_PREFIX = "rpgclub-conductor-profile-";

/** Deletes a profile, retrying while Chrome may still be writing to it; never throws. */
function removeProfileDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.error(`Could not delete the browser profile at ${dir}; delete it by hand.`);
  }
}

/**
 * Deletes profiles an earlier run left behind (a closed terminal, SIGKILL, a crash).
 * They hold a signed-in Discord session, so none outlives the next run.
 */
function sweepLeftoverProfiles(): void {
  for (const name of fs.readdirSync(PROFILE_PARENT)) {
    if (name.startsWith(PROFILE_NAME_PREFIX)) removeProfileDir(path.join(PROFILE_PARENT, name));
  }
}

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

/** Ends a run once the browser is open, so the trace is still saved and the summary shown. */
class Stop extends Error {}

function parseNumbers(text: string): number[] {
  return text.split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isInteger);
}

interface IArgs {
  pr: number;
  handOff: number[] | null;
  local: boolean;
}

function parseArgs(argv: string[]): IArgs {
  const pr = Number(argv[0]?.replace(/^#/, "").replace(/.*\/pull\//, ""));
  if (!Number.isInteger(pr) || pr <= 0) fail(USAGE);
  const flag = argv.indexOf("--hand-off");
  return {
    pr,
    handOff: flag >= 0 ? parseNumbers(argv[flag + 1] ?? "") : null,
    local: argv.includes("--local"),
  };
}

/** Runs git and returns its exit status and trimmed stdout; never throws. */
function git(args: string[]): { status: number | null; out: string } {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return { status: result.status, out: (result.stdout ?? "").trim() };
}

/**
 * The runner runs from whatever branch is checked out, so a PR branch cut before a runner
 * fix runs the old code (PR 1412 did). Refuses to start when origin/main has a runner
 * commit this checkout lacks. A branch that edits those paths on top of main passes.
 */
function assertRunnerCurrent(): void {
  if (git(["fetch", "--quiet", "origin", "main"]).status !== 0) {
    console.warn("Could not fetch origin/main; checking the runner against the last fetch.");
  }
  const latest = git(["log", "-1", "--format=%H", "origin/main", "--", ...RUNNER_PATHS]);
  if (latest.status !== 0 || !latest.out) {
    console.warn("Could not read origin/main; skipping the runner freshness check.");
    return;
  }
  const check = git(["merge-base", "--is-ancestor", latest.out, "HEAD"]);
  if (check.status === 1) {
    fail(
      `This checkout lacks origin/main's runner commit ${latest.out.slice(0, 7)}, so it ` +
        "would run an old runner. Merge main into this branch or run it from an up-to-date " +
        "main checkout, or pass --local to run this checkout's copy anyway.",
    );
  }
  if (check.status !== 0) {
    console.warn("Could not compare this checkout with origin/main; running anyway.");
  }
}

function readPr(pr: number): { state: string; body: string } {
  const json = execFileSync("gh", ["pr", "view", String(pr), "--json", "state,body"], {
    encoding: "utf8",
  });
  return JSON.parse(json) as { state: string; body: string };
}

/** The drive plan, with steps the runner cannot perform exactly turned into hand-offs. */
function buildRunSteps(steps: IDriveStep[]): IRunStep[] {
  return steps.map((step) => {
    const parsed = step.mode === "drive" ? parseDriveAction(step.command) : null;
    const reasons = [...step.reasons];
    if (step.readsFrom.length) {
      reasons.push(`reads a value from step ${step.readsFrom.join(", ")}`);
    }
    if (step.mode === "drive" && !parsed) reasons.push("the runner cannot read the action");
    return { ...step, parsed, reasons, mode: reasons.length ? "hand-off" : "drive" };
  });
}

function printPlan(steps: IRunStep[]): void {
  for (const step of steps) {
    const why = step.reasons.length ? ` (${step.reasons.join("; ")})` : "";
    console.log(`  ${step.number}. ${step.label} [${step.mode}]${why}`);
  }
}

/**
 * Each step says whether it writes real data with its `Changes data:` line, and a `yes`
 * step is already a hand-off. Only driven steps from an older PR body without the line
 * are asked about, once.
 */
async function askRealData(steps: IRunStep[]): Promise<number[]> {
  const driven = steps
    .filter((step) => step.mode === "drive" && step.changesData === undefined)
    .map((step) => step.number);
  if (!driven.length) return [];
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(
    `Which driven steps (${driven.join(", ")}) change real data? ` +
      "Their numbers, or Enter for none: ",
  );
  prompt.close();
  return parseNumbers(answer);
}

function handBack(steps: IRunStep[], numbers: number[]): void {
  for (const step of steps) {
    if (step.mode === "drive" && numbers.includes(step.number)) {
      step.mode = "hand-off";
      step.reasons.push("the tester handed it back");
    }
  }
}

async function poll<T>(page: Page, ms: number, read: () => Promise<T | null>): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(TIMING.pollMs);
  }
}

/** Waits for the conductor to move past step `n`: true once it has, or reported. */
async function waitForAdvance(page: Page, pr: number, n: number, ms: number): Promise<boolean> {
  const moved = await poll(page, ms, async () => {
    if (await reportUrl(page, pr)) return true;
    const header = await currentStep(page, pr);
    return header && header.number > n ? true : null;
  });
  return moved === true;
}

/** Presses the step's Check and reads the conductor's verdict. */
async function check(page: Page, pr: number, n: number): Promise<string | null> {
  const message = await findStepMessage(page, pr, n);
  if (!message) throw new HandOff(`the conductor's message for step ${n} is not in the channel`);
  await message.getByRole("button", { name: "Check", exact: true }).click();
  await scrollToBottom(page);
  const verdict = await poll(page, TIMING.verdictMs, async () =>
    await waitForAdvance(page, pr, n, 0) ? "passed" : pendingVerdict(page, pr, n),
  );
  if (verdict === "passed") return null;
  return verdict ?? "the conductor gave no verdict";
}

/** Waits for `locator` to show: false when it does not within `ms`. */
async function shows(locator: Locator, ms: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: "visible", timeout: ms });
    return true;
  } catch (err: unknown) {
    if (err instanceof errors.TimeoutError) return false;
    throw err;
  }
}

/** Opens the passkey prompt for the tester: true when the login page offered one. */
async function startPasskeySignIn(page: Page): Promise<boolean> {
  const button = passkeyButton(page);
  if (!await shows(button, TIMING.controlMs)) return false;
  await button.click();
  return true;
}

/**
 * Waits for the channel's messages, reloading the channel when Discord hangs after sign-in
 * (a spinner or a blank app that a refresh clears).
 */
async function waitForChannel(page: Page, channelUrl: string): Promise<void> {
  for (let reloads = 0; ; reloads += 1) {
    // A page other than the channel (such as @me) never shows its list, so skip the wait.
    const onChannel = page.url().startsWith(channelUrl);
    if (onChannel && await shows(messageList(page).first(), TIMING.channelLoadMs)) return;
    if (reloads === TIMING.channelReloads) break;
    console.log(
      `The channel did not load; reloading (${reloads + 1} of ${TIMING.channelReloads}).`,
    );
    try {
      // The app shell is enough; the message list wait above decides whether it loaded.
      await page.goto(channelUrl, { waitUntil: "domcontentloaded" });
    } catch (err: unknown) {
      if (!(err instanceof errors.TimeoutError)) throw err;
    }
  }
  throw new Stop(`The channel did not load after ${TIMING.channelReloads} reloads.`);
}

async function signIn(page: Page, channelUrl: string): Promise<void> {
  await page.goto(channelUrl);
  if (page.url().includes("/login")) {
    const prompted = await startPasskeySignIn(page);
    console.log(
      prompted
        ? "Opened the passkey sign-in. Pick your passkey in the browser window."
        : "Sign in to Discord in the browser window. The runner never types there.",
    );
    const done = await poll(page, TIMING.handOffMs, async () =>
      page.url().includes("/login") ? null : true,
    );
    if (!done) throw new Stop("Not signed in; stopping.");
  }
  await waitForChannel(page, channelUrl);
}

/** True when the channel shows a run for this PR that has not reported yet. */
async function runInProgress(page: Page, pr: number): Promise<boolean> {
  return Boolean(await currentStep(page, pr)) && !await reportUrl(page, pr);
}

/**
 * Starts the PR's run with `/conduct pr:<pr>` when the channel shows none in progress (no
 * step message, or only a finished run's report), then waits for its first step.
 */
async function ensureRun(page: Page, pr: number): Promise<void> {
  await scrollToBottom(page);
  if (await runInProgress(page, pr)) return;
  console.log(`No run for PR #${pr} is in progress; starting one with /conduct pr:${pr}.`);
  try {
    await startConductRun(page, pr);
  } catch (err: unknown) {
    if (!(err instanceof HandOff) && !(err instanceof errors.TimeoutError)) throw err;
    const why = err.message.split("\n")[0];
    throw new Stop(`Could not start the run (${why}). Run /conduct pr:${pr} here, then rerun.`);
  }
  const started = await poll(page, TIMING.verdictMs, async () =>
    await runInProgress(page, pr) ? true : null,
  );
  if (!started) {
    throw new Stop(
      `The conductor posted no step for PR #${pr}. Check its reply in the channel; ` +
        "another run may be in progress.",
    );
  }
}

async function walk(
  page: Page,
  pr: number,
  steps: IRunStep[],
  channelUrl: string,
  shots: string,
  outcomes: IOutcome[],
): Promise<void> {
  for (;;) {
    if (!page.url().startsWith(channelUrl)) throw new Stop(`The tab left ${channelUrl}.`);
    if (await reportUrl(page, pr)) return;
    const header = await poll(page, TIMING.handOffMs, () => currentStep(page, pr));
    if (!header) throw new Stop(`No run for PR #${pr} here. Start /conduct pr:${pr}.`);
    const step = steps.find((candidate) => candidate.number === header.number);
    if (!step || step.label !== header.label || header.total !== steps.length) {
      throw new Stop(`Step ${header.number} differs from the PR body, which changed.`);
    }
    if (outcomes.some((outcome) => outcome.number === step.number)) {
      if (!await waitForAdvance(page, pr, step.number, TIMING.handOffMs)) {
        throw new Stop(`Still on step ${step.number}. Rerun the runner to resume from it.`);
      }
      continue;
    }
    const outcome = await runStep(page, pr, step, shots);
    outcomes.push(outcome);
    console.log(`Step ${step.number}: ${outcome.result}. ${outcome.detail}`);
  }
}

async function runStep(page: Page, pr: number, step: IRunStep, shots: string): Promise<IOutcome> {
  if (step.mode === "hand-off" || !step.parsed) {
    console.log(`Step ${step.number} is yours: ${step.command}`);
    return { number: step.number, result: "hand-off", detail: step.reasons.join("; ") };
  }
  const pending = await pendingVerdict(page, pr, step.number);
  if (pending) {
    console.log(`Step ${step.number} is yours: it already shows ${pending}.`);
    return { number: step.number, result: "handed back", detail: pending };
  }
  const shot = path.join(shots, `step-${step.number}.png`);
  try {
    const before = await newestText(page);
    await performAction(page, step.parsed);
    await waitForReply(page, before, step.parsed.kind === "slash");
    await page.screenshot({ path: shot });
    const verdict = await check(page, pr, step.number);
    if (!verdict) return { number: step.number, result: "passed", detail: "" };
    return { number: step.number, result: "handed back", detail: verdict };
  } catch (err: unknown) {
    if (!(err instanceof HandOff) && !(err instanceof errors.TimeoutError)) throw err;
    await page.screenshot({ path: shot });
    // A Playwright timeout carries its whole call log; the first line says what failed.
    const why = err.message.split("\n")[0];
    console.log(`Step ${step.number} is yours: ${why}. Do it, then judge it.`);
    return { number: step.number, result: "handed back", detail: why };
  }
}

function printSummary(outcomes: IOutcome[], report: string | null, artifacts: string): void {
  console.log("\nSummary");
  for (const outcome of outcomes) {
    const detail = outcome.detail ? `: ${outcome.detail}` : "";
    console.log(`  step ${outcome.number} ${outcome.result}${detail}`);
  }
  const forTester = outcomes.filter((outcome) => outcome.result !== "passed");
  console.log(`For a person: ${forTester.map((o) => o.number).join(", ") || "none"}`);
  console.log(`Report: ${report ?? "not posted yet"}`);
  console.log(`Trace and screenshots: ${artifacts}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.local) assertRunnerCurrent();
  const pr = readPr(args.pr);
  if (pr.state !== "OPEN") fail(`PR #${args.pr} is ${pr.state}; nothing to test.`);
  const plan = buildDrivePlan(pr.body);
  if (plan.kind === "none") fail(plan.reason, 1);
  const testChannelId = TEST_GUILD_IDS.BOT_DEV_CHANNEL_ID;
  if (!testChannelId) fail("src/config/testGuild.ts has no BOT_DEV_CHANNEL_ID.");
  const channelUrl = `https://discord.com/channels/${TEST_GUILD_SNOWFLAKE}/${testChannelId}`;

  const steps = buildRunSteps(plan.steps);
  console.log(`PR #${args.pr} drive plan:`);
  printPlan(steps);
  handBack(steps, args.handOff ?? await askRealData(steps));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifacts = path.resolve("conduct-artifacts", `pr-${args.pr}-${stamp}`);
  fs.mkdirSync(artifacts, { recursive: true });
  // The system Chrome, installed with apt, in a brand new empty profile: no cookies, no
  // storage, no saved sign-in from an earlier run. The tester signs in every time.
  sweepLeftoverProfiles();
  const profile = fs.mkdtempSync(path.join(PROFILE_PARENT, PROFILE_NAME_PREFIX));
  const removeProfile = (): void => removeProfileDir(profile);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      removeProfile();
      process.exit(128 + os.constants.signals[signal]);
    });
  }
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chrome",
      headless: false,
      viewport: null,
    });
  } catch (err: unknown) {
    removeProfile();
    throw err;
  }
  let closed = false;
  context.on("close", () => {
    closed = true;
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const outcomes: IOutcome[] = [];
  let report: string | null = null;
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await signIn(page, channelUrl);
    await ensureRun(page, args.pr);
    await walk(page, args.pr, steps, channelUrl, artifacts, outcomes);
    report = await reportUrl(page, args.pr);
  } catch (err: unknown) {
    // A pending call can reject before the context's close event fires.
    const gone = closed || (err instanceof Error && err.name === "TargetClosedError");
    if (!(err instanceof Stop) && !gone) throw err;
    console.error(gone ? "The browser window was closed; stopping." : (err as Stop).message);
    process.exitCode = 1;
  } finally {
    try {
      await context.tracing.stop({ path: path.join(artifacts, "trace.zip") });
    } catch {
      console.error("The browser closed before the trace was saved.");
    }
    await context.close().catch(() => undefined);
    removeProfile();
    printSummary(outcomes, report, artifacts);
  }
}

await main();
