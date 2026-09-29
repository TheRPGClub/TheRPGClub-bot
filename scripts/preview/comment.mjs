// Sticky PR comment reporting preview status. Loaded by actions/github-script steps in
// .github/workflows/pr-preview.yml, which pass in their `github` and `context` objects.

const MARKER = "<!-- rpgclub-pr-preview -->";

const STATES = {
  building: (d) => `:hourglass: Building \`${d.sha}\` for the test guild.`,
  running: (d) =>
    `:green_circle: Running \`${d.sha}\` in the test guild as the dev bot ` +
    `(container \`${d.container}\`). Guild-scoped commands are registered.`,
  failed: (d) => `:red_circle: Preview of \`${d.sha}\` failed to start.`,
  superseded: (d) =>
    `:white_circle: Deploy of \`${d.sha}\` was cancelled by a newer preview run.`,
  replaced: (d) =>
    `:white_circle: Preview stopped: #${d.by} took the test guild. ` +
    "Push a commit or re-run the workflow to bring this one back.",
  removed: () => ":white_circle: Preview torn down.",
};

/**
 * @param {{ github: any, context: any, pr: number, state: keyof STATES,
 *   sha?: string, container?: string, by?: number }} args
 */
export async function upsertPreviewComment({ github, context, pr, state, ...details }) {
  const { owner, repo } = context.repo;
  const runUrl =
    `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
  const sha = (details.sha ?? "").slice(0, 7);
  const body = [
    MARKER,
    "### PR preview",
    STATES[state]({ ...details, sha }),
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
    (c) => c.user?.login === "github-actions[bot]" && c.body?.startsWith(MARKER),
  );
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number: pr, body });
  }
}

/** True when the PR is still open, so a finished deploy should stay up. */
export async function isPullRequestOpen({ github, context, pr }) {
  const { owner, repo } = context.repo;
  const { data } = await github.rest.pulls.get({ owner, repo, pull_number: pr });
  return data.state === "open";
}
