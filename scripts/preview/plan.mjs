// Decides from a PR body whether a preview is worth deploying, using the same parser
// `/conduct` runs, so the workflow and the conductor agree on what counts as Testing
// steps. Loaded by actions/github-script steps in .github/workflows/pr-preview.yml, whose
// Node 24 runtime strips the parser's types natively, and by tsx in the unit tests.

import { parseTestPlan } from "../../src/conductor/TestPlanParser.ts";

/**
 * `deploy` is true when the body has a runnable plan and this event is the one that
 * should build it. An `edited` event only deploys when the edit gave the body its plan:
 * an edit elsewhere in a body that already had one would evict another PR's preview for
 * a build that is already running.
 *
 * @param {{ action: string, body?: string | null, previousBody?: string | null }} args
 * @returns {{ deploy: boolean, kind: "ok" | "absent" | "empty" | "malformed",
 *   reason: string }}
 */
export function planPreview({ action, body, previousBody }) {
  const plan = parseTestPlan(body);
  const reason = plan.kind === "malformed" ? plan.reason : "";
  if (plan.kind !== "ok") return { deploy: false, kind: plan.kind, reason };
  const hadPlan = action === "edited" && parseTestPlan(previousBody).kind === "ok";
  return { deploy: !hadPlan, kind: plan.kind, reason };
}

/**
 * True when a finished deploy should stay up: the PR is still open and its current
 * body still has a runnable plan. Either can change while the image builds.
 */
export async function isPreviewStillWanted({ github, context, pr }) {
  const { owner, repo } = context.repo;
  const { data } = await github.rest.pulls.get({ owner, repo, pull_number: pr });
  return data.state === "open" && parseTestPlan(data.body).kind === "ok";
}
