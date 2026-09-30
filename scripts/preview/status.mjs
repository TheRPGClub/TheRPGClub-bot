// Summarizes open PRs for the `/test-guild` skill: whether each has Testing steps
// `/conduct` can run, and what its sticky preview comment says. The preview container
// lives on the desktop runner, so the comment is the only view of it from a laptop.

import { PREVIEW_COMMENT_MARKER } from "./comment.mjs";
import { testingSteps } from "./plan.mjs";

/** Maps the status emoji `upsertPreviewComment` writes to the state it reports. */
const PREVIEW_STATES = [
  [":green_circle:", "running"],
  [":yellow_circle:", "behind"],
  [":hourglass:", "building"],
];

/**
 * The preview state the newest sticky comment reports: `running`, `behind` (running an
 * older commit than the PR head), `building`, or `none` for anything else.
 *
 * @param {Array<{ body?: string | null }> | null | undefined} comments
 * @returns {"running" | "behind" | "building" | "none"}
 */
export function previewState(comments) {
  const sticky = (comments ?? []).filter((c) => c.body?.startsWith(PREVIEW_COMMENT_MARKER));
  const status = sticky.at(-1)?.body?.split("\n")[2] ?? "";
  const match = PREVIEW_STATES.find(([emoji]) => status.startsWith(emoji));
  return match ? match[1] : "none";
}

/**
 * One row per open PR, as `gh pr list --json number,title,body,isCrossRepository,comments`
 * returns them.
 *
 * @param {Array<{ number: number, title: string, body?: string | null,
 *   isCrossRepository?: boolean, comments?: Array<{ body?: string | null }> }>} prs
 * @returns {Array<{ number: number, title: string, testing: string, fork: boolean,
 *   preview: string }>}
 */
export function summarizePullRequests(prs) {
  return prs
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      testing: testingSteps(pr.body).kind,
      fork: Boolean(pr.isCrossRepository),
      preview: previewState(pr.comments),
    }))
    .sort((a, b) => a.number - b.number);
}
