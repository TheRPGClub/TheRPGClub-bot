/**
 * Markdown for the pull request comment. Observed payloads are untrusted, so
 * they only ever appear inside a code fence longer than any backtick run they
 * contain, and step text from the PR body is quoted the same way.
 */
import type { IObservedOutput, IStepResult, StepVerdict } from "./ConductorObservation.js";
import type { ITestStep } from "./TestPlanParser.js";

/** Marks conductor comments so they are recognizable in the PR timeline. */
export const CONDUCTOR_REPORT_MARKER = "<!-- rpgclub-conductor-report -->";

/** GitHub caps a comment at 65536 characters; leave room for the footer. */
export const MAX_REPORT_LENGTH = 60000;
const MAX_PAYLOAD_LENGTH = 3000;

const VERDICT_LABELS: Record<StepVerdict, string> = {
  pass: "PASS",
  fail: "FAIL",
  unverified: "NEEDS EYES",
};

export interface IReportInput {
  pr: number;
  headSha: string;
  runId: string;
  steps: ITestStep[];
  results: IStepResult[];
  aborted: boolean;
}

/** A fence one backtick longer than the longest run inside the text. */
export function fenceFor(text: string, language = ""): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

/** Keeps a PR-supplied label on one line and out of the markdown structure. */
function inlineText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[`*_<>[\]|#@]/g, "\\$&").trim();
}

function formatObserved(outputs: IObservedOutput[]): string {
  return outputs
    .map((output) => {
      const json = typeof output.payload === "string"
        ? output.payload
        : JSON.stringify(output.payload, null, 2);
      const header = `${output.place} message ${output.messageId}` +
        (output.source ? ` from ${output.source}` : "");
      return `${header}:\n${fenceFor(truncate(json ?? "null", MAX_PAYLOAD_LENGTH), "json")}`;
    })
    .join("\n\n");
}

function formatStep(step: ITestStep, result: IStepResult | undefined): string {
  const heading = `### Step ${step.number}: ${inlineText(step.label)}`;
  if (!result) return `${heading}\n\nNot run.`;

  const lines = [
    `${heading}: ${VERDICT_LABELS[result.verdict]}`,
    "",
    fenceFor(step.command),
    "",
    `Result: ${inlineText(result.reason)}`,
  ];
  if (result.verdict !== "pass") {
    if (result.observed.length) {
      lines.push("", "Observed:", "", formatObserved(result.observed));
    }
    if (result.unattributed.length) {
      lines.push("", "Other output in the window:", "", formatObserved(result.unattributed));
    }
  }
  return lines.join("\n");
}

function countVerdicts(results: IStepResult[]): string {
  const count = (verdict: StepVerdict): number =>
    results.filter((result) => result.verdict === verdict).length;
  return `${count("pass")} passed, ${count("fail")} failed, ` +
    `${count("unverified")} need eyes`;
}

export function buildRunReport(input: IReportInput): string {
  const status = input.aborted ? "Aborted" : "Finished";
  const header = [
    CONDUCTOR_REPORT_MARKER,
    "## Conductor test report",
    "",
    `${status} run \`${input.runId}\` against \`${input.headSha.slice(0, 7)}\`: ` +
      `${countVerdicts(input.results)}, of ${input.steps.length} step(s).`,
  ].join("\n");

  const byStep = new Map(input.results.map((result) => [result.stepNumber, result]));
  const body = input.steps.map((step) => formatStep(step, byStep.get(step.number)));
  return truncate([header, ...body].join("\n\n"), MAX_REPORT_LENGTH);
}

export function buildUnparseableReport(pr: number, reason: string): string {
  return [
    CONDUCTOR_REPORT_MARKER,
    "## Conductor test report",
    "",
    `The \`## Testing\` section of #${pr} could not be parsed, so no script was run. ` +
      "Please test this PR manually.",
    "",
    `Reason: ${inlineText(reason)}`,
    "",
    "Format: `.github/pull-request-testing-format.md`",
  ].join("\n");
}
