// Sticky PR comment reporting preview status. Loaded by actions/github-script steps in
// .github/workflows/pr-preview.yml, which pass in their `github` and `context` objects.

export const PREVIEW_COMMENT_MARKER = "<!-- rpgclub-pr-preview -->";
const FORMAT_DOC = ".github/pull-request-testing-format.md";

/**
 * The parser's reason quotes the attacker-controlled body, so it is escaped. Mirrors
 * inlineText in src/conductor/ConductorReport.ts, which this plain-JS module cannot
 * import.
 */
function inlineText(text) {
  return text.replace(/\s+/g, " ").replace(/[`*_<>[\]|#@]/g, "\\$&").trim();
}

/** Previews deploy only on request, through the user-invoked `/test-guild` skill. */
function redeploy(pr) {
  return `\`/test-guild ${pr}\` in Claude Code`;
}

const STATES = {
  building: (d) => `:hourglass: Building \`${d.sha}\` for the test guild.`,
  running: (d) =>
    `:green_circle: Running \`${d.sha}\` in the test guild as the dev bot ` +
    `(container \`${d.container}\`). Guild-scoped commands are registered.\n\n` +
    `To walk through this PR's Testing steps, run \`/conduct pr:${d.pr}\` in the ` +
    "test guild.",
  failed: (d) => `:red_circle: Preview of \`${d.sha}\` failed to start.`,
  superseded: (d) =>
    `:white_circle: Deploy of \`${d.sha}\` was cancelled, by a newer preview run, a stop, ` +
    "or the job timeout. The workflow run says which.",
  replaced: (d) =>
    `:white_circle: Preview stopped: #${d.by} took the test guild. ` +
    `Run ${redeploy(d.pr)} to bring this one back.`,
  stale: (d) =>
    `:yellow_circle: Still running \`${d.running}\` in the test guild, behind this ` +
    `PR's head \`${d.sha}\`. Pushes never redeploy on their own. ` +
    `Run ${redeploy(d.pr)} to test the new head.`,
  removed: () => ":white_circle: Preview torn down.",
  untested: (d) =>
    ":white_circle: No preview: this PR has no Testing steps for `/conduct` to run. " +
    `Add a \`## Testing\` section in [the Testing format](${d.formatUrl}), then ` +
    `run ${redeploy(d.pr)} to deploy one.`,
  malformed: (d) =>
    ":warning: No preview: the Testing section could not be parsed, so there is " +
    `nothing for \`/conduct\` to run. Reason: ${inlineText(d.reason ?? "")}\n\n` +
    `Fix it to match [the Testing format](${d.formatUrl}), then ` +
    `run ${redeploy(d.pr)} to deploy a preview.`,
};

/**
 * `onlyIfExists` updates the comment when the PR already has one and otherwise posts
 * nothing, so a PR that never had a preview is not told it has none.
 *
 * @param {{ github: any, context: any, pr: number, state: keyof STATES,
 *   sha?: string, running?: string, container?: string, by?: number, reason?: string,
 *   onlyIfExists?: boolean }} args
 */
export async function upsertPreviewComment({
  github, context, pr, state, onlyIfExists = false, ...details
}) {
  const { owner, repo } = context.repo;
  const repoUrl = `${context.serverUrl}/${owner}/${repo}`;
  const runUrl = `${repoUrl}/actions/runs/${context.runId}`;
  const formatUrl = `${repoUrl}/blob/main/${FORMAT_DOC}`;
  const sha = (details.sha ?? "").slice(0, 7);
  const running = (details.running ?? "").slice(0, 7);
  const body = [
    PREVIEW_COMMENT_MARKER,
    "### PR preview",
    STATES[state]({ ...details, sha, running, pr, formatUrl }),
    "",
    `[Workflow run](${runUrl})`,
  ].join("\n");

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pr,
    per_page: 100,
  });
  const existing = comments.find(
    (c) =>
      c.user?.login === "github-actions[bot]" && c.body?.startsWith(PREVIEW_COMMENT_MARKER),
  );
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
  } else if (!onlyIfExists) {
    await github.rest.issues.createComment({ owner, repo, issue_number: pr, body });
  }
}

/** True when the PR is still open, so a finished deploy should stay up. */
export async function isPullRequestOpen({ github, context, pr }) {
  const { owner, repo } = context.repo;
  const { data } = await github.rest.pulls.get({ owner, repo, pull_number: pr });
  return data.state === "open";
}
