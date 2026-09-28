---
name: next-refactor
description: Find the oldest open, non-blocked refactor GitHub issue, implement the change, push to a new branch, and open a PR. Use when asked to "do the next refactor", "work on the oldest refactor issue", or "next-refactor".
---

This skill picks up the oldest open, non-blocked refactor issue, does the full implementation, and ships a PR -- no prompting required.

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

- Step 2 stops on an open dependency: `Blocked`. When it closes: `Working`.
- Step 4, as the implementation starts: `Working`.
- Step 9, as the self review starts: `Self Review`.
- Step 10, after a clean self review pass: `Needs Review`.
- Review comments, a CI failure, or a user answer to act on: `Working`, then
  back through `Self Review` to `Needs Review` once the fix is pushed.
- The pull request merged or closed: the group sidebar-groups.md names for a
  merge, usually `Completed`.

## Steps (always run in order)

### 1. Find the oldest open, non-blocked refactor issue

Exclude any issue carrying the `blocked` label -- those depend on other work and must not be picked up.

```bash
gh issue list --label refactor --state open --limit 50 \
  --json number,title,createdAt,labels \
  | jq 'map(select(any(.labels[]; .name == "blocked") | not))
        | sort_by(.createdAt) | .[0]'
```

If the result is `null`, every open refactor issue is blocked -- stop and report that to the user.

Capture the issue number and title. Then fetch the full body:

```bash
gh issue view <N> --json number,title,body,labels
```

Read the body carefully -- it describes exactly what needs to change and which files are involved.

### 2. Check dependencies

If the issue body mentions "Depends on issue #X", verify that issue is closed before proceeding:

```bash
gh issue view <X> --json state,title
```

If the dependency is still open, stop and report to the user: "Issue #N depends on #X which is
still open." Move the session to `Blocked` (see [Sidebar moves](#sidebar-moves)), record #X
with `scripts/catchup.py add-issue`, keep one `wait` running, and end the turn, per
[sidebar-groups.md](../_shared/sidebar-groups.md#blocked-by-another-issue).
When `wait` prints `issue: <X> closed`, move to `Working` and start this skill over at
step 1.

### 3. Branch from the latest main

The working tree must be clean first. `git status --short` printing anything
means another task's work is sitting here: stop and ask what to do with it,
never stash or discard it.

Branch from `origin/main` after a fetch. Do not `git checkout main && git pull`:
in a worktree, `main` is checked out by the main checkout and the checkout
fails.

```bash
git fetch origin --prune
git switch -c refactor/issue-<N>-<short-slug> origin/main
git log --oneline origin/main..HEAD
```

The last command must print nothing.

Derive the slug from the issue title (kebab-case, under 40 chars).

### 4. Implement the change

Move the session to `Working` (see [Sidebar moves](#sidebar-moves)).

Read the relevant source files before editing. Do not read entire large files -- use targeted reads (specific line ranges or grep) to locate the patterns described in the issue.

Apply all changes described in the issue body:

- Replace deprecated patterns with their shared-helper equivalents.
- Update reply payloads as directed (e.g. `embeds: [embed]` -> `components` + flags).
- Do not refactor anything beyond what the issue describes.
- Keep lines under 100 characters.
- Do not add comments unless the WHY is non-obvious.

After editing, run a quick type-check to catch obvious errors:

```bash
npx tsc --noEmit 2>&1 | head -40
```

Fix any type errors before continuing.

### 5. Smoke test

```bash
bash .claude/skills/run-rpgclubbot/smoke.sh
```

All tests must pass and lint must be clean. Fix any failures before continuing.

### 6. Commit

Stage only the files you changed. Write the message to `<scratchpad>/commit-msg.txt` with
the Write tool, never through a heredoc, per [shell-text.md](../_shared/shell-text.md):

```
refactor: <short description matching issue title>

Closes #N

<the Co-Authored-By line from the session's attribution instructions>
```

```bash
git add <changed files>
git commit -F <scratchpad>/commit-msg.txt
```

### 7. Push

```bash
git push -u origin HEAD
```

### 8. Open a PR

Run the open-pr skill through its mergeability check (step 5), linking to issue #N. Stop
there: this skill runs the self review loop itself in step 9, so open-pr skips its own self
review and its `Needs Review` move.

PR title: match the issue title (strip the "refactor: " prefix if present and re-add it cleanly).

PR body format, written to `<scratchpad>/pr-body.md`:
```
## Summary
- <1-3 bullets describing what was changed and why>

## Test plan
- [ ] Type-check passes (`npx tsc --noEmit`)
- [ ] Smoke test passes (`bash .claude/skills/run-rpgclubbot/smoke.sh`)
- [ ] No functional behavior changed -- refactor only

## Self review
<filled in by step 9>

Closes #N

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### 9. Review it yourself

Once CI has passed and the PR is mergeable, move to `Self Review` (see
[Sidebar moves](#sidebar-moves)) and run the loop in [self-review.md](../_shared/self-review.md):
`code-review` at `high` on the PR number, a read against this repo's rules, a fix for every
finding that holds, and another full pass, until a pass comes back clean. Fill in the
`Self review` section of the body as it goes.

### 10. Report

Move the session to `Needs Review` (see [Sidebar moves](#sidebar-moves)),
only after the clean pass. Give the user the PR URL, the smoke test and CI result, and how
many self review passes ran and what they found and fixed.

## Common mistakes to avoid

- Do NOT implement more than what the issue describes.
- Do NOT skip the dependency check (step 2).
- Do NOT open the PR if smoke.sh fails.
- Do NOT commit directly to main.
- Do NOT hand the PR over before a clean self review pass.
- Do NOT skip a sidebar move. Each one in [Sidebar moves](#sidebar-moves) is
  part of its step.
- Do NOT pass multi-line text through a heredoc.
