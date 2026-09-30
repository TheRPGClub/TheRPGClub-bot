/**
 * The one active run, persisted to a JSON file so a conductor restart resumes
 * where the tester left off. Button custom IDs carry the run and step, and are
 * checked against this file before anything happens.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IStepResult } from "./ConductorObservation.js";
import type { ITestStep } from "./TestPlanParser.js";

export type ConductorRunStatus = "running" | "finished" | "aborted";

export interface IConductorRun {
  /** The `/conduct` interaction's snowflake: unique and stable across restarts. */
  runId: string;
  pr: number;
  headSha: string;
  steps: ITestStep[];
  /**
   * The channel `/conduct` ran in, where every step, result, and report link is posted.
   * Missing only in state saved before runs were posted publicly.
   */
  channelId?: string;
  /** Index into `steps` of the step awaiting its check. */
  current: number;
  /** Discord timestamp of the channel message that handed out the current step. */
  windowStart: number;
  results: IStepResult[];
  /**
   * A check awaiting the tester: a failure waits for "Check again" or "Continue as
   * failed", and output with nothing to look for waits for "Looks right" or
   * "Doesn't match".
   */
  pendingResult?: IStepResult | null;
  /** The tester's notes, by step number, quoted under each step in the report. */
  notes?: Record<number, string>;
  status: ConductorRunStatus;
  /** The report comment's URL, once posted. An approval retry links it. */
  reportUrl?: string;
  /** The head this run approved, so a retry never approves twice. */
  approvedSha?: string;
}

export async function loadRun(path: string): Promise<IConductorRun | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
  let parsed: IConductorRun | null;
  try {
    parsed = JSON.parse(raw) as IConductorRun | null;
  } catch {
    // A damaged file must not wedge every handler; the next /conduct overwrites it.
    console.error(`[conductor] ignoring unreadable run state at ${path}`);
    return null;
  }
  return parsed && typeof parsed.runId === "string" ? parsed : null;
}

/** Writes through a temp file and a rename, so a crash never leaves half a file. */
export async function saveRun(path: string, run: IConductorRun): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(run, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

export type StepButtonCheck =
  | { ok: true; run: IConductorRun }
  | { ok: false; reason: string };

/** A button is live only for the running run's current step. */
export function checkStepButton(
  run: IConductorRun | null,
  runId: string,
  stepIndex: number,
): StepButtonCheck {
  if (!run || run.runId !== runId) {
    return { ok: false, reason: "This run is no longer active." };
  }
  if (run.status !== "running") return { ok: false, reason: `This run is ${run.status}.` };
  if (stepIndex !== run.current) {
    return { ok: false, reason: `This is not the current step (step ${run.current + 1}).` };
  }
  return { ok: true, run };
}
