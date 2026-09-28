---
name: new-branch
description: Start a new feature or fix branch from the latest main. Use when asked to "start a branch", "new branch", "begin work on", or "create branch for issue #N". Always run this before writing any code.
---

This skill encodes the mandatory branch-setup ceremony from CLAUDE.md. Every coding task must start here -- never write code directly on `main` or on a stale branch.

## Steps (always run in order)

### 1. Require a clean working tree

```bash
git status --short
```

This must print nothing. Anything it prints means another task's work is sitting here:
stop and ask the user what to do with it, never stash or discard it.

### 2. Determine the branch name

- If the user supplies a branch name, use it exactly.
- If the user supplies an issue number, derive the name as `feat/issue-<N>-<short-slug>` or `fix/issue-<N>-<short-slug>` based on the issue title from `gh issue view <N>`.
- If neither is given, derive a short kebab-case name from the task description (e.g. `feat/add-nominations-command`).

Branch naming conventions:
- `feat/<name>` for new features
- `fix/<name>` for bug fixes
- `docs/<name>` for documentation-only changes
- `refactor/<name>` for refactors with no functional change

### 3. Branch from the latest main

Branch from `origin/main` after a fetch. Do not `git checkout main && git pull`:
in a worktree, `main` is checked out by the main checkout and the checkout
fails.

```bash
git fetch origin --prune
git switch -c <branch-name> origin/main
git log --oneline origin/main..HEAD
```

The last command must print nothing.

### 4. Confirm ready

Run:

```bash
git status
git branch --show-current
```

Report the branch name and confirm the working tree is clean. The branch is now ready to receive work.

## Common mistakes to avoid

- Do NOT skip the `git fetch` -- a stale `origin/main` causes merge conflicts.
- Do NOT `git checkout main` -- it fails in a worktree.
- Do NOT create the branch from a non-main base unless the user explicitly requests it.
- Do NOT start writing code before this skill completes successfully.
