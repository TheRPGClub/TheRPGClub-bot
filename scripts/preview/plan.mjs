// Decides from a PR whether a preview can be deployed, using the same parser `/conduct`
// runs, so the workflow and the conductor agree on what counts as Testing steps. Loaded
// by actions/github-script steps in .github/workflows/pr-preview.yml, whose Node 24
// runtime strips the parser's types natively, and by tsx in the unit tests.

import { parseTestPlan } from "../../src/conductor/TestPlanParser.ts";

/**
 * Classifies a PR body's Testing section, with the parser's reason for `malformed`.
 *
 * @param {string | null | undefined} body
 * @returns {{ kind: "ok" | "absent" | "empty" | "malformed", reason: string }}
 */
export function testingSteps(body) {
  const plan = parseTestPlan(body);
  return { kind: plan.kind, reason: plan.kind === "malformed" ? plan.reason : "" };
}

/**
 * Whether a manual deploy of a PR may go ahead. Previews are only ever deployed on
 * request (`/test-guild` in Claude Code dispatches the workflow), so this is the one
 * gate: `refusal` is empty when the deploy may run, and says why when it may not.
 *
 * @param {{ pr: { number: number, state: string, body?: string | null,
 *   head: { repo?: { full_name?: string } | null } }, repository: string }} args
 * @returns {{ refusal: string, kind: string, reason: string }}
 */
export function deployRefusal({ pr, repository }) {
  const { kind, reason } = testingSteps(pr.body);
  let refusal = "";
  if (pr.state !== "open") refusal = `PR #${pr.number} is ${pr.state}.`;
  else if (pr.head.repo?.full_name !== repository) {
    refusal = `PR #${pr.number} is from a fork, which never runs on the preview runner.`;
  } else if (kind === "malformed") {
    refusal = `PR #${pr.number}'s Testing section could not be parsed: ${reason}`;
  } else if (kind !== "ok") {
    refusal = `PR #${pr.number} has no Testing steps for \`/conduct\` to run.`;
  }
  return { refusal, kind, reason };
}

/**
 * Whether a finished deploy should stay up: `wanted` is `yes`, or why not, with the
 * parser's reason for `malformed`. The PR can close, or its body lose its Testing
 * steps, while the image builds.
 *
 * @returns {Promise<{ wanted: "yes" | "closed" | "untested" | "malformed",
 *   reason: string }>}
 */
export async function previewWanted({ github, context, pr }) {
  const { owner, repo } = context.repo;
  const { data } = await github.rest.pulls.get({ owner, repo, pull_number: pr });
  if (data.state !== "open") return { wanted: "closed", reason: "" };
  const { kind, reason } = testingSteps(data.body);
  if (kind === "ok") return { wanted: "yes", reason: "" };
  if (kind === "malformed") return { wanted: "malformed", reason };
  return { wanted: "untested", reason: "" };
}
