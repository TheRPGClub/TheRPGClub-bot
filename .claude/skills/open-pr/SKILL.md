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

## Steps (always run in order)

### 1. Lint

```bash
npx eslint --fix
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

After the PR is created, capture the PR number from the `gh pr create` output and verify:

```bash
gh pr view <N> --json closingIssuesReferences
```

Expected output contains each linked issue number. If an issue is missing, GitHub did not
pick up the `Closes` line. Check formatting and patch the PR body.

### 5. Check mergeability

Read mergeability and resolve any conflict now, per
[pr-mergeability.md](../_shared/pr-mergeability.md). A conflict is this session's to
resolve, not something to hand back to the user.

### 6. Self review

Once CI has passed and the PR is mergeable, move to `Self Review` and run the loop in
[self-review.md](../_shared/self-review.md) until a pass comes back clean. Fill in the
`Self review` section of the body as it goes.

Skip this step, and step 7's `Needs Review` move with it, when the skill that called
open-pr runs the self review loop itself (for example `/next-refactor`). That skill stops
here and hands the PR over once its own loop ends clean. Say in the report which skill ran
the loop.

### 7. Report and file the session in the sidebar

Move the session to the `Needs Review` sidebar group, per
[sidebar-groups.md](../_shared/sidebar-groups.md), only after the clean self review pass.
When the pull request later merges or closes, that file says which group comes next.

Report the linkage result, the mergeability result, how many self review passes ran and
what they found and fixed, and the PR URL.

## Common mistakes to avoid

- Do NOT put multiple issue numbers on one `Closes` line (`Closes #1, #2` is unreliable).
- Do NOT skip the linkage verification step.
- Do NOT open the PR before lint passes.
- Do NOT open a PR from `main`.
- Do NOT move to `Needs Review` before a clean self review pass.
- Do NOT pass multi-line text through a heredoc.
