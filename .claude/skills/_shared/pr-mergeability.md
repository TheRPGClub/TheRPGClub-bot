# The mergeability check

Shared by every skill that opens a pull request. Opening one is not the end of
the job: a branch cut before a sibling landed can conflict with `main` the
moment that sibling merges, and the pull request then sits there saying it
cannot be merged. Handing that to the user as ready costs them a round trip to
tell the session something it could have read for itself.

So the check runs immediately after `gh pr create`, without being asked:

```bash
gh pr view <number> --json mergeable,mergeStateStatus
```

- `MERGEABLE` with `CLEAN`: the work is done.
- `MERGEABLE` with `UNSTABLE` or `BLOCKED`: a CI check is pending or red. That
  is a CI problem to read with `gh pr checks <number>`, not a conflict.
- `UNKNOWN`: GitHub has not computed it yet. Read it again in a few seconds.
- `CONFLICTING` with `DIRTY`: the session resolves the conflicts now, on its
  own, before it reports anything.

## Resolving

```bash
git fetch origin
git merge origin/main
git diff --name-only --diff-filter=U
```

Read both sides of every hunk before writing the resolution. Two sessions
adding an entry to the same list (a config constant, a lint rule, a command
registration) is the common case, and the resolution is almost always the
union of the two, in the order the surrounding file already uses, rather than
either side winning. A resolution that drops the other session's work is a
silent revert of a merged branch.

Never rebase and never force-push: the branch is pushed, so its history stays
as it is. A merge commit is the correct shape.

A resolution is an edit like any other, so re-run the smoke test before
pushing:

```bash
bash .claude/skills/run-rpgclubbot/smoke.sh
git push
gh pr view <number> --json mergeable,mergeStateStatus
```

The second read is what proves the resolution took.

## What the report says

Name the branch that conflicted, the file, and what the union kept. A user who
merges the other side later needs to know the two lists were joined rather than
one of them chosen.
