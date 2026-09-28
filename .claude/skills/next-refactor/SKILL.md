---
name: next-refactor
description: Find the oldest open, non-blocked refactor GitHub issue, implement the change, push to a new branch, and open a PR. Use when asked to "do the next refactor", "work on the oldest refactor issue", or "next-refactor".
---

This skill picks up the oldest open, non-blocked refactor issue, does the full implementation, and ships a PR -- no prompting required.

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

If the dependency is still open, stop and report to the user: "Issue #N depends on #X which is still open."
Move the session to the `Blocked` sidebar group, per
[sidebar-groups.md](../_shared/sidebar-groups.md#blocked-by-another-issue).

### 3. Pull main and create a branch

Follow the new-branch ceremony exactly:

```bash
git checkout main && git pull
git checkout -b refactor/issue-<N>-<short-slug>
```

Derive the slug from the issue title (kebab-case, under 40 chars).

### 4. Implement the change

Move the session to the `Working` sidebar group, per
[sidebar-groups.md](../_shared/sidebar-groups.md).

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

Once CI has passed and the PR is mergeable, move to `Self Review` and run the loop in
[self-review.md](../_shared/self-review.md): `code-review` at `high` on the PR number, a read
against this repo's rules, a fix for every finding that holds, and another full pass, until a
pass comes back clean. Fill in the `Self review` section of the body as it goes.

### 10. Report

Move the session to `Needs Review`, per [sidebar-groups.md](../_shared/sidebar-groups.md),
only after the clean pass. Give the user the PR URL, the smoke test and CI result, and how
many self review passes ran and what they found and fixed.

## Common mistakes to avoid

- Do NOT implement more than what the issue describes.
- Do NOT skip the dependency check (step 2).
- Do NOT open the PR if smoke.sh fails.
- Do NOT commit directly to main.
- Do NOT hand the PR over before a clean self review pass.
- Do NOT pass multi-line text through a heredoc.
