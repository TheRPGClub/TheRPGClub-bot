/**
 * Checks a pull request body's `## Testing` section with the parser `/conduct` runs, so a
 * body the conductor cannot read is caught before the PR is opened. The CLI wrapper is
 * `scripts/check-pr-testing.ts`.
 */

import { findUncheckedSteps, parseTestPlan, type ITestStep } from "./TestPlanParser.js";

export interface IPrTestingCheck {
  /** False only when the section exists and does not parse. */
  ok: boolean;
  /** A human-readable report: the parsed steps, or why the section was rejected. */
  lines: string[];
}

/** Separators between actions a step's code block chains together. */
const ACTION_SEPARATOR = /,|;|\n|\bthen\b/i;
const QUOTED = /"[^"]*"/g;
/** Words that start a user action. Field entries and a `submit` finish a modal. */
const ACTION_VERBS = new Set(["click", "press", "select", "choose", "pick"]);

/** How many user actions a step's code block holds, per the one-action rule. */
export function countStepActions(command: string): number {
  let actions = 0;
  let modalOpen = false;
  for (const segment of command.replace(QUOTED, '""').split(ACTION_SEPARATOR)) {
    const text = segment.trim().toLowerCase();
    // A slash command's subcommand names (`/journal select`) are not actions.
    if (text.startsWith("/")) {
      actions += 1;
      modalOpen = false;
      continue;
    }
    for (const word of text.match(/[a-z]+/g) ?? []) {
      if (ACTION_VERBS.has(word)) {
        actions += 1;
        modalOpen = word === "click" || word === "press";
      } else if (word === "submit") {
        if (!modalOpen) actions += 1;
        modalOpen = false;
      }
    }
  }
  return actions;
}

/**
 * Step numbers whose code block chains several actions. Only the last reply of such a
 * step gets checked, so the format asks for one action per step.
 */
export function findChainedSteps(steps: ITestStep[]): number[] {
  return steps.filter((step) => countStepActions(step.command) > 1).map((step) => step.number);
}

export function checkPrTesting(body: string): IPrTestingCheck {
  const plan = parseTestPlan(body);
  if (plan.kind === "absent") {
    return { ok: true, lines: ["No ## Testing section; nothing for the conductor to run."] };
  }
  if (plan.kind === "empty") {
    return {
      ok: true,
      lines: ["The ## Testing section has no steps; the conductor treats it as absent."],
    };
  }
  if (plan.kind === "malformed") {
    return {
      ok: false,
      lines: [
        `The ## Testing section cannot be parsed: ${plan.reason}`,
        "See .github/pull-request-testing-format.md for the required shape.",
      ],
    };
  }

  const lines = [`The ## Testing section parses into ${plan.steps.length} step(s):`];
  for (const step of plan.steps) {
    const visibility = step.ephemeral ? "ephemeral" : "public";
    lines.push(`  Step ${step.number}: ${step.label} (${visibility})`);
    lines.push(`    Command: ${step.command.replace(/\n/g, " | ")}`);
    lines.push(`    Expected: ${step.expected}`);
  }
  const unchecked = findUncheckedSteps(plan.steps);
  if (unchecked.length) {
    lines.push(
      `Note: step(s) ${unchecked.join(", ")} have nothing the conductor can check ` +
        "(no quoted text that must appear), so the tester must confirm them by eye.",
    );
  }
  const chained = findChainedSteps(plan.steps);
  if (chained.length) {
    lines.push(
      `Warning: step(s) ${chained.join(", ")} chain several actions, so only the last ` +
        "reply gets checked. Split them into one command, click, select, or modal submit " +
        "per step.",
    );
  }
  return { ok: true, lines };
}
