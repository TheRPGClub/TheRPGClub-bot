/**
 * Checks a pull request body's `## Testing` section with the parser `/conduct` runs, so a
 * body the conductor cannot read is caught before the PR is opened. The CLI wrapper is
 * `scripts/check-pr-testing.ts`.
 */

import { findUncheckedSteps, parseTestPlan } from "./TestPlanParser.js";

export interface IPrTestingCheck {
  /** False only when the section exists and does not parse. */
  ok: boolean;
  /** A human-readable report: the parsed steps, or why the section was rejected. */
  lines: string[];
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
      `Note: step(s) ${unchecked.join(", ")} quote no text to look for, ` +
        "so the tester must confirm them by eye.",
    );
  }
  return { ok: true, lines };
}
