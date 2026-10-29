---
name: oversee-development
description: >-
  Work the open issue backlog oldest first, one issue at a time per session,
  unattended, opening one review-ready pull request per issue and never merging
  anything. Use when asked to run through the backlog, work issues while the user
  is away, or keep implementing issues on a loop - "/oversee-development", "work
  the backlog", "keep going through the issues".
---

# Oversee Development

## Base

Read
[the general skill](../../att-docs/plugins/general/skills/oversee-development/SKILL.md)
first and follow it, except where this file overrides it. The general skill is the
vendored copy pinned by `.claude/att-docs.lock`; never edit it here.

## Paths

- `oversee.sh`: `.claude/att-docs/plugins/general/skills/oversee-development/oversee.sh`.
  The Skill tool's base directory is this file's folder, which holds no script, so run
  it by that path from the worktree root.
- The issue skill the conductor runs: [implement](../implement/SKILL.md), this
  repository's extension.

## Overrides

None in text. Two things about this repository change what the general skill assumes.
Both are Repository notes below, and both need the user's decision before the skill is
run.

## Repository notes

- State location. `oversee.sh` writes its queue and ledger to `.claude/oversee/` in the
  main checkout at `/home/michael/Code/bot`, found through `git rev-parse
  --git-common-dir`. A session in a worktree therefore writes outside its working
  directory, which `CLAUDE.md` forbids. The script has no setting to move it, and the
  vendored copy is never edited. Running this skill needs the user's explicit approval
  for that write, or a script change upstream in Overmind.
- Labels. The script moves issues between `In Progress`, `Blocked`, and `Already Done`
  and never creates a label. This repository has `In Progress` and `Blocked on API`,
  but no `Blocked` or `Already Done`, so those swaps fail until the user creates them.
  [issue-labels.md](../_shared/issue-labels.md) forbids a session creating labels.
- Suite arguments (`/oversee-development CCA`) restrict the queue by label. This
  repository has no suite labels, so only the plain forms apply.
