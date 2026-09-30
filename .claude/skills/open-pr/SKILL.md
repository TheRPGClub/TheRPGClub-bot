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
- Step 7, after a clean self review pass with CI green, and
  nothing else in progress: `Needs Review`. Never before; the loop does not end
  the turn mid-way.
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

A body with a `## Testing` section must follow
`.github/pull-request-testing-format.md`, including its `One action per step` rule: one
command, click, select, or modal submit per step, each quoting at least one check for the
reply it produces. A flow of three clicks is three steps. Check it with the parser
`/conduct` runs. Exit 1 means the conductor cannot read the section and exit 2 means the
body file could not be read. Fix whichever it names and run the check again until it
passes. A warning that a step chains several actions means splitting that step. Run it
again before any later body patch:

```bash
npm run check:pr-testing -- <scratchpad>/pr-body.md
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

Once the PR is mergeable, without waiting for CI, move to `Self Review` (see
[Sidebar moves](#sidebar-moves)) and run the loop in [self-review.md](../_shared/self-review.md)
until a pass comes back clean. Fill in the `Self review` section of the body as it goes.

### 7. Report and file the session in the sidebar

Move the session to `Needs Review` (see [Sidebar moves](#sidebar-moves)) only after the clean
self review pass. When the pull request later merges or closes, that section says which
group comes next.

Report the linkage result, the mergeability result, how many self review passes ran and
what they found and fixed, and the PR URL. When the PR has Testing steps, say that
`/test-guild <PR>` puts it in the test guild for `/conduct`. Only the user runs that
skill; never dispatch a deploy.

Never merge unasked. When a conductor report lands on the PR, read it per
[conductor-merge.md](../_shared/conductor-merge.md): a pass on the current head means
asking the user whether to merge, and a failed step goes back through the self review loop.

## Common mistakes to avoid

- Do NOT put multiple issue numbers on one `Closes` line (`Closes #1, #2` is unreliable).
- Do NOT skip the linkage verification step.
- Do NOT open the PR before lint passes.
- Do NOT open a PR from `main`.
- Do NOT move to `Needs Review` before a clean self review pass with CI green, or while
  the session has anything else in progress. There is no exception.
- Do NOT skip a sidebar move. Each one in [Sidebar moves](#sidebar-moves) is
  part of its step.
- Do NOT pass multi-line text through a heredoc.
