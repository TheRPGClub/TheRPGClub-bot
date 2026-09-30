/**
 * Puts a finished run on the pull request: the report comment first, then the
 * approval when every step passed. The report goes first so a failed approval
 * never costs it. Records `reportUrl` and `approvedSha` on the run; the caller
 * saves the run and posts the returned notice.
 */
import {
  buildApprovalBody,
  decideApproval,
  runPassed,
  shortSha,
  type ApprovalDecision,
} from "./ConductorApproval.js";
import { conductorApiError } from "./ConductorErrors.js";
import { buildRunReport } from "./ConductorReport.js";
import type { IConductorRun } from "./ConductorState.js";
import type { GitHubPullClient } from "./GitHubPullClient.js";

export type PublishClient = Pick<
  GitHubPullClient,
  "approve" | "getPullRequest" | "getViewerLogin" | "postComment"
>;

/** Which call failed, so the notice can offer a button to retry it. */
export type PublishRetry = "report" | "approve";

export interface IPublishOutcome {
  /** The channel notice; empty when there is nothing to say. */
  text: string;
  retry?: PublishRetry;
}

/**
 * Approves a passed run's PR at the tested head. The head is read again first: a push
 * since the run started means the tested commit is no longer what would merge.
 */
export async function approveIfPassed(
  github: PublishClient,
  run: IConductorRun,
  reportUrl: string,
): Promise<IPublishOutcome> {
  if (!runPassed(run)) return { text: "" };
  let decision: ApprovalDecision;
  try {
    const [pull, viewer] = await Promise.all([
      github.getPullRequest(run.pr),
      github.getViewerLogin(),
    ]);
    decision = decideApproval(run, pull, viewer);
  } catch (err: unknown) {
    const label = `Reading PR #${run.pr} before approving it failed`;
    return { text: conductorApiError(label, err), retry: "approve" };
  }
  if (decision.kind === "not-passed") return { text: "" };
  if (decision.kind === "skip") return { text: decision.reason };

  let reviewUrl: string;
  try {
    reviewUrl = await github.approve(run.pr, run.headSha, buildApprovalBody(run, reportUrl));
  } catch (err: unknown) {
    const label = `Approving PR #${run.pr} failed`;
    return { text: conductorApiError(label, err), retry: "approve" };
  }
  run.approvedSha = run.headSha;
  return { text: `Approved PR #${run.pr} at \`${shortSha(run.headSha)}\`: ${reviewUrl}` };
}

export async function publishRunResult(
  github: PublishClient,
  run: IConductorRun,
): Promise<IPublishOutcome> {
  const report = buildRunReport({
    pr: run.pr,
    headSha: run.headSha,
    runId: run.runId,
    steps: run.steps,
    results: run.results,
    notes: run.notes,
    aborted: run.status === "aborted",
  });
  let url: string;
  try {
    url = await github.postComment(run.pr, report);
  } catch (err: unknown) {
    const label = `Posting the report to PR #${run.pr} failed`;
    return { text: conductorApiError(label, err), retry: "report" };
  }
  run.reportUrl = url;
  const approval = await approveIfPassed(github, run, url);
  const posted = `Report for PR #${run.pr} posted: ${url}`;
  return {
    text: approval.text ? `${posted}\n${approval.text}` : posted,
    retry: approval.retry,
  };
}
