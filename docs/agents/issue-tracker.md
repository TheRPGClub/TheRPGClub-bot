# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <scratchpad>/issue-body.md`. Write the body to a file with the Write tool first; never pass multi-line text through a heredoc or an inline `--body` (see `.claude/skills/_shared/shell-text.md`).
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --limit 200 --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters (open is the default).
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking**). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body-file <file>`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`, then read the labels back as `.claude/skills/_shared/issue-labels.md` requires. That doc also governs `In Progress` (the claim label) and forbids creating labels.
- **Close**: `gh issue comment <number> --body-file <file>`, then `gh issue close <number>`, removing any `In Progress` label first per `issue-labels.md`
- **Blocking**: GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric database id (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, not the `#number`); the blocker may live in another repo. Read it back from `issue_dependencies_summary.total_blocked_by` on `gh api repos/<owner>/<repo>/issues/<n>` (`blocked_by` counts open blockers only; `gh issue list --json` returns neither).

This repo is `TheRPGClub/TheRPGClub-bot`. Use that name when writing `<owner>/<repo>`, even if `git remote -v` still shows an older name; `gh` resolves the repo automatically when run inside a clone.

## Cross-repo work

The club's work spans three repos, each with its own tracker: TheRPGClub/TheRPGClub-api, TheRPGClub/TheRPGClub-www and TheRPGClub/TheRPGClub-bot. A ticket lives in the repo whose code it changes. When a ticket is blocked by one in another repo, write the blocker as `<owner>/<repo>#<n>` in a `Blocked by:` line at the top of the body, and also add the native dependency (see **Blocking** above; it accepts a blocker from another repo by its database id), so both GitHub's blocked-by summary and a plain read of the body show the edge.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding

`/wayfinder` is not supported in this repo: its `wayfinder:*` labels don't exist, and `issue-labels.md` forbids creating labels. Run wayfinding maps in TheRPGClub-api instead.
