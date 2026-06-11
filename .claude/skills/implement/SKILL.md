---
name: implement
description: Fetch a GitHub issue, implement the described change, push to a new branch, and open a PR. Use when asked to "implement #N", "/implement N", or "work on issue #N".
---

This skill picks up any open GitHub issue by number, implements the described change end-to-end, and ships a PR -- no prompting required.

The issue number is passed as the skill argument (e.g. `/implement 717`).

## Steps (always run in order)

### 1. Fetch the issue

```bash
gh issue view <N> --json number,title,body,labels,state
```

Read the body carefully. It describes what needs to change and often names specific files, patterns, or acceptance criteria. If the issue is closed or does not exist, stop and report that to the user.

### 2. Check dependencies

If the issue body mentions "Depends on issue #X" or "Blocked by #X", verify that issue is closed:

```bash
gh issue view <X> --json state,title
```

If the dependency is still open, stop and report: "Issue #N depends on #X which is still open."

### 3. Pull main and create a branch

```bash
git checkout main && git pull
```

Derive a branch name from the issue number and title. Use the label to pick the prefix:
- `refactor` label -> `refactor/issue-<N>-<slug>`
- `bug` label -> `fix/issue-<N>-<slug>`
- `enhancement` or `feature` label -> `feat/issue-<N>-<slug>`
- anything else -> `chore/issue-<N>-<slug>`

Slug: kebab-case from the issue title, under 40 characters.

```bash
git checkout -b <branch-name>
```

### 4. Implement the change

Read the relevant source files before editing. Use targeted reads (specific line ranges or grep) -- do not read entire large files.

Apply all changes described in the issue body. Stay inside the scope the issue defines:
- Do not refactor code the issue does not mention.
- Do not add error handling for scenarios the issue does not address.
- Do not add comments unless the WHY is non-obvious.
- Keep lines under 100 characters.

After editing, type-check:

```bash
npx tsc --noEmit 2>&1 | head -40
```

Fix any type errors before continuing.

### 5. Smoke test

```bash
bash .claude/skills/run-rpgclubbot/smoke.sh
```

All tests must pass and lint must be clean. Fix any failures before continuing. Do not open a PR if smoke.sh fails.

### 6. Commit

Stage only the files you changed. Never use `git add -A` or `git add .` blindly.

Choose the commit type from the issue label:
- `refactor` -> `refactor:`
- `bug` -> `fix:`
- `enhancement` / `feature` -> `feat:`
- anything else -> `chore:`

```bash
git add <changed files>
git commit -m "$(cat <<'EOF'
<type>: <short description matching issue title>

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

PR title: match the issue title, prefixed with the commit type (`refactor:`, `fix:`, `feat:`, `chore:`).

PR body format:
```
## Summary
- <1-3 bullets describing what changed and why>

## Test plan
- [ ] Type-check passes (`npx tsc --noEmit`)
- [ ] Smoke test passes (`bash .claude/skills/run-rpgclubbot/smoke.sh`)
- [ ] <any acceptance criteria from the issue body>

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
- Do NOT open a PR if smoke.sh fails.
- Do NOT commit directly to main.
- Do NOT put multiple issue numbers on one `Closes` line.
