/**
 * Whether a finished run approves its pull request. Only a run that finished with
 * every step passing approves, and only while the head it tested is still the head.
 */
import type { IPullRequestInfo } from "./GitHubPullClient.js";
import type { IConductorRun } from "./ConductorState.js";

/** Marks conductor approvals so sessions can tell them from anyone else's review. */
export const CONDUCTOR_APPROVAL_MARKER = "<!-- rpgclub-conductor-approval -->";

export type ApprovalDecision =
  | { kind: "approve" }
  /** The run did not pass, so there is nothing to approve and nothing to say. */
  | { kind: "not-passed" }
  /** The run passed but cannot approve; `reason` is shown to the tester. */
  | { kind: "skip"; reason: string };

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Finished, with a result for every step, and every result a pass. */
export function runPassed(run: IConductorRun): boolean {
  return run.status === "finished" &&
    run.steps.length > 0 &&
    run.results.length === run.steps.length &&
    run.results.every((result) => result.verdict === "pass");
}

export function decideApproval(
  run: IConductorRun,
  pull: IPullRequestInfo,
  viewerLogin: string,
): ApprovalDecision {
  if (!runPassed(run)) return { kind: "not-passed" };
  if (run.approvedSha === run.headSha) {
    return { kind: "skip", reason: `PR #${run.pr} is already approved for this run.` };
  }
  if (pull.state !== "open") {
    return { kind: "skip", reason: `PR #${run.pr} is ${pull.state}, not open.` };
  }
  if (pull.headSha !== run.headSha) {
    return {
      kind: "skip",
      reason: `PR #${run.pr}'s head moved from \`${shortSha(run.headSha)}\` to ` +
        `\`${shortSha(pull.headSha)}\` since the run started, so the tested commit is ` +
        "no longer the head.",
    };
  }
  if (pull.authorLogin.toLowerCase() === viewerLogin.toLowerCase()) {
    return {
      kind: "skip",
      reason: `The conductor's GitHub token acts as ${viewerLogin}, who opened PR ` +
        `#${run.pr}, and GitHub does not let an author approve their own pull request.`,
    };
  }
  return { kind: "approve" };
}

export function buildApprovalBody(run: IConductorRun, reportUrl: string): string {
  return [
    CONDUCTOR_APPROVAL_MARKER,
    `Conductor run \`${run.runId}\` passed all ${run.steps.length} step(s) against ` +
      `\`${shortSha(run.headSha)}\`.`,
    "",
    `Report: ${reportUrl}`,
  ].join("\n");
}
