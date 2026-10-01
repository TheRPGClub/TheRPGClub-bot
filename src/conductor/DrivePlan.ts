/**
 * Sorts a PR's parsed `## Testing` steps into the ones Claude may perform in the tester's
 * Discord web session (`/conduct-auto`) and the ones handed back to the tester.
 *
 * The PR body is attacker-controlled, so this module only classifies. A step is driven
 * only when it is one recognized action whose result the conductor can check; anything
 * else, or anything that reaches past the test guild, stays with the tester. The CLI
 * wrapper is `scripts/conduct-drive-plan.ts`, and the mode is described in
 * `docs/conductor.md`.
 */

import { countStepActions, QUOTED } from "./PrTestingCheck.js";
import { findUncheckedSteps, parseTestPlan, type ITestStep } from "./TestPlanParser.js";

export type DriveActionKind = "slash" | "slash-modal" | "click" | "modal" | "select";

/**
 * Slash commands whose flows always write outside the test guild (GitHub issues). Their
 * steps, and the component steps that follow them, are always done by the tester. API
 * writes depend on the preview's env, so `/conduct-auto` asks the tester about those.
 */
export const EXTERNAL_EFFECT_COMMANDS: readonly string[] = ["todo", "suggestion"];

export interface IDriveStep {
  number: number;
  label: string;
  command: string;
  expected: string;
  ephemeral: boolean;
  /** `drive` when Claude may perform the action; `hand-off` when the tester does. */
  mode: "drive" | "hand-off";
  /** The recognized action, or null when the command is not one. */
  action: DriveActionKind | null;
  /** Why the step is handed off; empty for a driven step. */
  reasons: string[];
  /** Earlier steps whose reply supplies a value the command reads, as `from step N`. */
  readsFrom: number[];
}

export type DrivePlanResult =
  | { kind: "ok"; steps: IDriveStep[] }
  | { kind: "none"; reason: string };

const BY_EYE = /\bby eye\b/i;
const SECOND_ACCOUNT =
  /\b(?:second|another|other|alt|alternate)\s+(?:discord\s+)?(?:account|member|user|tester)\b/i;
const READS_FROM = /\bfrom step (\d+)\b/gi;
const SLASH_NAME = /^\/([\w-]+)/;
const CLICK_START = /^(?:click|press)\b/i;
const SELECT_START = /^(?:select|choose|pick)\b/i;
const SUBMIT = /\bsubmit\b/i;

/** The single action a command performs, or null when it is not a recognized one. */
export function detectAction(command: string): DriveActionKind | null {
  const lines = command.split("\n").map((line) => line.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  if (SLASH_NAME.test(first)) return lines.length > 1 ? "slash-modal" : "slash";
  if (lines.length > 1) return null;
  const unquoted = first.replace(QUOTED, '""');
  if (CLICK_START.test(first)) return SUBMIT.test(unquoted) ? "modal" : "click";
  if (SELECT_START.test(first)) return "select";
  return null;
}

function slashName(command: string): string | null {
  return SLASH_NAME.exec(command.trim())?.[1]?.toLowerCase() ?? null;
}

/** Classifies each step, carrying the latest slash command into its component steps. */
export function classifyDriveSteps(steps: ITestStep[]): IDriveStep[] {
  const unchecked = new Set(findUncheckedSteps(steps));
  let flowCommand: string | null = null;
  return steps.map((step) => {
    flowCommand = slashName(step.command) ?? flowCommand;
    const action = detectAction(step.command);
    const actionCount = countStepActions(step.command);
    const reasons: string[] = [];
    if (unchecked.has(step.number)) reasons.push("the conductor has nothing to check");
    if (BY_EYE.test(step.expected)) reasons.push("Expected asks for a check by eye");
    if (SECOND_ACCOUNT.test(`${step.label}\n${step.expected}`)) {
      reasons.push("needs a second account");
    }
    if (actionCount > 1) reasons.push(`chains ${actionCount} actions`);
    if (!action) reasons.push("not one recognized action");
    if (flowCommand && EXTERNAL_EFFECT_COMMANDS.includes(flowCommand)) {
      reasons.push(`/${flowCommand} changes data outside the test guild`);
    }
    const readsFrom = [...step.command.matchAll(READS_FROM)]
      .map((match) => Number(match[1]))
      .filter((n) => n > 0 && n < step.number);
    return {
      number: step.number,
      label: step.label,
      command: step.command,
      expected: step.expected,
      ephemeral: step.ephemeral,
      mode: reasons.length ? "hand-off" : "drive",
      action,
      reasons,
      readsFrom: [...new Set(readsFrom)],
    };
  });
}

/** Parses a PR body and classifies its steps, or says why there is nothing to drive. */
export function buildDrivePlan(body: string): DrivePlanResult {
  const plan = parseTestPlan(body);
  if (plan.kind === "absent" || plan.kind === "empty") {
    return { kind: "none", reason: "The PR has no Testing steps." };
  }
  if (plan.kind === "malformed") {
    return { kind: "none", reason: `The Testing section cannot be parsed: ${plan.reason}` };
  }
  return { kind: "ok", steps: classifyDriveSteps(plan.steps) };
}
