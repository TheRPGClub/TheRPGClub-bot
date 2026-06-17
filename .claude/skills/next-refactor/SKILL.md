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

### 3. Pull main and create a branch

Follow the new-branch ceremony exactly:

```bash
git checkout main && git pull
git checkout -b refactor/issue-<N>-<short-slug>
```

Derive the slug from the issue title (kebab-case, under 40 chars).

### 4. Implement the change

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

Stage only the files you changed:

```bash
git add <changed files>
git commit -m "$(cat <<'EOF'
refactor: <short description matching issue title>

Closes #N

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### 7. Push

```bash
git push -u origin HEAD
```

### 8. Open a PR

Run the open-pr skill, linking to issue #N.

PR title: match the issue title (strip the "refactor: " prefix if present and re-add it cleanly).

PR body format:
```
## Summary
- <1-3 bullets describing what was changed and why>

## Test plan
- [ ] Type-check passes (`npx tsc --noEmit`)
- [ ] Smoke test passes (`bash .claude/skills/run-rpgclubbot/smoke.sh`)
- [ ] No functional behavior changed -- refactor only

Closes #N

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

After opening, verify closing-issue linkage:

```bash
gh pr view <PR> --json closingIssuesReferences
```

Report the PR URL to the user.

## Common mistakes to avoid

- Do NOT implement more than what the issue describes.
- Do NOT skip the dependency check (step 2).
- Do NOT open the PR if smoke.sh fails.
- Do NOT commit directly to main.
