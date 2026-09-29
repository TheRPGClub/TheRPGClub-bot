---
name: open-pr
description: >-
  Open a pull request following the full CLAUDE.md PR ceremony: lint, build body with one
  Closes #X per line, create PR, verify closing-issue linkage and mergeability, then self
  review it before handing it over. Use when asked to "open a PR", "create PR", or "submit
  PR for issue #N".
---

This skill encodes the mandatory PR ceremony from CLAUDE.md. Run it every time a PR needs to
be opened. Do not skip steps.

The PR body and any other multi-line text are written to the scratchpad with the Write tool
and passed by path, never through a heredoc, per [shell-text.md](../_shared/shell-text.md).

## Sidebar moves

The session files itself in the Code tab sidebar at each step below. These
moves are part of the steps, not optional extras, and skipping one leaves the
user unable to see where the session stands.

Before the first move, load the tools in one call:

```
ToolSearch select:mcp__ccd_sidebar__list_groups,mcp__ccd_sidebar__create_group,mcp__ccd_sidebar__move_sessions
```

Each move: `mcp__ccd_sidebar__list_groups`, take the id of the group by name
(create it with `mcp__ccd_sidebar__create_group` when missing), then
`mcp__ccd_sidebar__move_sessions` with `session_ids: ["self"]` and that id.
Ids are never stored; look them up every time. A tool that fails is reported
in one line and skipped, per
[sidebar-groups.md](../_shared/sidebar-groups.md#rules).

- Step 6, as the self review starts: `Self Review`.
- Step 7, after a clean self review pass: `Needs Review`. Also any turn that ends idle
  between passes, per [sidebar-groups.md](../_shared/sidebar-groups.md).
- Called by a skill that runs the self review loop itself: no moves here. The
  calling skill makes them.
- Review comments, a CI failure, or a user answer to act on: `Working`, then
  back through `Self Review` to `Needs Review` once the fix is pushed.
- The pull request merged or closed: the group sidebar-groups.md names for a
  merge, usually `Completed`.

## Steps (always run in order)

### 1. Lint

```bash
npx oxlint --fix
```

If violations are reported, fix them before proceeding. The fixes must be committed to the
branch as part of the PR.

### 2. Confirm branch

The PR must be opened from a feature or fix branch, never from `main`. Verify the current
branch:

```bash
git branch --show-current
```

If on `main`, stop and tell the user.

### 3. Build the PR body

Each issue being closed must get its own `Closes #X` line. Comma-separated closes on a single
line are **not** reliably picked up by GitHub.

Write the body to `<scratchpad>/pr-body.md`:

```
## Summary
<1-3 bullet points describing what changed and why>

## Test plan
<bulleted checklist of how to verify the change>

## Self review
<filled in by step 6>

Closes #N
Closes #M

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then open the PR:

```bash
gh pr create --title "<title>" --body-file <scratchpad>/pr-body.md
```

### 4. Verify closing-issue linkage

Record the PR in the session's ledger with `scripts/catchup.py add-pr` and keep one
`wait` running, per
[run-watch.md](../_shared/run-watch.md#waiting-on-a-pull-request), so the merge
reaches the session without the user reporting it.

After the PR is created, capture the PR number from the `gh pr create` output and verify:

```bash
gh pr view <N> --json closingIssuesReferences
```

Older `gh` releases reject that field as an unknown JSON field. Read it through GraphQL
instead:

```bash
gh api graphql -F o='{owner}' -F r='{repo}' -F n=<N> -f query='
  query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){
  pullRequest(number:$n){closingIssuesReferences(first:20){nodes{number}}}}}'
```

Expected output contains each linked issue number. If an issue is missing, GitHub did not
pick up the `Closes` line. Check formatting and patch the PR body.

### 5. Check mergeability

Read mergeability and resolve any conflict now, per
[pr-mergeability.md](../_shared/pr-mergeability.md). A conflict is this session's to
resolve, not something to hand back to the user.

### 6. Self review

Once CI has passed and the PR is mergeable, move to `Self Review` (see
[Sidebar moves](#sidebar-moves)) and run the loop in [self-review.md](../_shared/self-review.md)
until a pass comes back clean. Fill in the `Self review` section of the body as it goes.

When the skill that called open-pr runs the self review loop itself (for example
`/next-refactor`), open-pr ends after step 5 and skips steps 6 and 7. The calling skill runs
the loop, moves to `Needs Review`, and reports once its loop ends clean.

### 7. Report and file the session in the sidebar

Move the session to `Needs Review` (see [Sidebar moves](#sidebar-moves)) only after the clean
self review pass. When the pull request later merges or closes, that section says which
group comes next.

Report the linkage result, the mergeability result, how many self review passes ran and
what they found and fixed, and the PR URL.

## Common mistakes to avoid

- Do NOT put multiple issue numbers on one `Closes` line (`Closes #1, #2` is unreliable).
- Do NOT skip the linkage verification step.
- Do NOT open the PR before lint passes.
- Do NOT open a PR from `main`.
- Do NOT move to `Needs Review` before a clean self review pass while the session is still
  working. A turn that ends idle between passes is the one exception.
- Do NOT skip a sidebar move. Each one in [Sidebar moves](#sidebar-moves) is
  part of its step.
- Do NOT pass multi-line text through a heredoc.
