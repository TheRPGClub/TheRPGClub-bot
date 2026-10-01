// Runs a PR's driveable Testing steps in Discord web with Playwright, while the tester
// watches the headed browser. The conductor still posts and judges every step and writes
// the PR report; this only performs each `drive` step's one action and presses Check.
// `hand-off` steps are left for the tester and listed in the summary.
//
// Usage: npm run -s conduct:playwright -- <pr> [--hand-off 3,5]
// It never runs headless or in CI; see "Playwright runner" in docs/conductor.md.

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createInterface } from "readline/promises";

import { chromium, errors, type Page } from "playwright-core";

import { TEST_GUILD_IDS, TEST_GUILD_SNOWFLAKE } from "../../src/config/testGuild.ts";
import { parseDriveAction, type DriveAction } from "../../src/conductor/DriveActions.ts";
import { buildDrivePlan, type IDriveStep } from "../../src/conductor/DrivePlan.ts";
import {
  currentStep,
  HandOff,
  newestText,
  pendingVerdict,
  performAction,
  reportUrl,
  stepMessage,
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

const USAGE = "Usage: npm run -s conduct:playwright -- <pr> [--hand-off 3,5]";
const PROFILE_DIR = process.env.CONDUCT_PROFILE_DIR ??
  path.join(os.homedir(), ".cache", "rpgclub-conductor", "discord-profile");

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

/** Ends a run once the browser is open, so the trace is still saved and the summary shown. */
class Stop extends Error {}

function parseNumbers(text: string): number[] {
  return text.split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isInteger);
}

function parseArgs(argv: string[]): { pr: number; handOff: number[] | null } {
  const pr = Number(argv[0]?.replace(/^#/, "").replace(/.*\/pull\//, ""));
  if (!Number.isInteger(pr) || pr <= 0) fail(USAGE);
  const flag = argv.indexOf("--hand-off");
  return { pr, handOff: flag >= 0 ? parseNumbers(argv[flag + 1] ?? "") : null };
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
 * The plan cannot tell which steps write real data: the preview writes to whatever API
 * its env names (docs/pr-preview.md). The tester says once which to hand back.
 */
async function askRealData(steps: IRunStep[]): Promise<number[]> {
  const driven = steps.filter((step) => step.mode === "drive").map((step) => step.number);
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
  const message = stepMessage(page, pr, n);
  await message.getByRole("button", { name: "Check", exact: true }).click();
  const verdict = await poll(page, TIMING.verdictMs, async () =>
    await waitForAdvance(page, pr, n, 0) ? "passed" : pendingVerdict(page, pr, n),
  );
  if (verdict === "passed") return null;
  return verdict ?? "the conductor gave no verdict";
}

async function signIn(page: Page, channelUrl: string): Promise<void> {
  await page.goto(channelUrl);
  if (!page.url().includes("/login")) return;
  console.log("Sign in to Discord in the browser window. The runner never types there.");
  const done = await poll(page, TIMING.handOffMs, async () =>
    page.url().startsWith(channelUrl) ? true : null,
  );
  if (!done) throw new Stop("Not signed in; stopping.");
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
  // The system Chrome, installed with apt, and a profile only the tester signs in to.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    viewport: null,
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const outcomes: IOutcome[] = [];
  let report: string | null = null;
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await signIn(page, channelUrl);
    await walk(page, args.pr, steps, channelUrl, artifacts, outcomes);
    report = await reportUrl(page, args.pr);
  } catch (err: unknown) {
    if (!(err instanceof Stop)) throw err;
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await context.tracing.stop({ path: path.join(artifacts, "trace.zip") });
    await context.close();
    printSummary(outcomes, report, artifacts);
  }
}

await main();
