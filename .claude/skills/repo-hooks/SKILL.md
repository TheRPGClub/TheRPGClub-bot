---
name: repo-hooks
description: >-
  The four session hooks this repository takes from Overmind: the PR testing gate, the
  merge-watch reminder, the unit test on edit, and Prettier on save. Use when changing
  this repository's values for them or working out why one fired or stayed quiet.
---

# Repo hooks

## Base

Read
[the general skill](../../att-docs/plugins/general/skills/repo-hooks/SKILL.md)
first and follow it, except where this file overrides it. The general skill is the
vendored copy pinned by `.claude/att-docs.lock`; never edit it here.

## Paths

- `<config>`: [extension.json](extension.json). It sets the `prTestingGate` checker to
  `scripts/check-pr-testing.ts`, the `mergeWatchReminder` ledger tool to
  `scripts/catchup.py`, the `testOnEdit` folder to `src/tests`, and an empty
  `prettierOnSave` section.
- Registration: `.claude/settings.local.json` registers the vendored
  `.claude/att-docs/plugins/general/hooks/run.sh` once per hook. The `general@att-docs`
  plugin is disabled for this project, so nothing fires twice and its same-name skills
  do not load beside the extensions here.

## Overrides

None. A rule this file does not name is the general skill's rule.

## Repository notes

- This repository has no Prettier config, so `prettierOnSave` formats nothing until one
  is added.
- [implement](../implement/SKILL.md): the manual `npm run check:pr-testing` and
  `catchup.py add-pr` steps the gate and reminder back up.
