---
name: voice-bridge-hooks
description: >-
  The speech and voice tunnel hooks, run from the voice plugin with this repository's
  extension.json, which announce what a session needs, read replies aloud for
  /implement-with-speech, and feed the voice bridge the iPhone app follows. Use when
  changing those hooks or their scripts, or working out why a session spoke, stayed
  quiet, or never reached the phone - "why did the stop not speak", "the label
  announcement is wrong", "the phone missed that reply".
---

# Voice bridge hooks

## Base

Read
[the general skill](../../att-docs/plugins/voice/skills/voice-bridge-hooks/SKILL.md)
first and follow it, except where this file overrides it. The general skill is the
vendored copy pinned by `.claude/att-docs.lock`; never edit it here.

## Paths

- `<config>`: [extension.json](extension.json)
- `<hook-settings>`: the `voice` plugin's `hooks/hooks.json`, installed at user scope
  (`claude plugin install voice@att-docs --scope user`). This repository's
  `.claude/settings.json` registers none of them. If it did, the plugin's runner would
  step aside, which only adds churn.
- `<entry-points>`: the plugin's own scripts. This repository keeps no shims.
- `<review-label>`: `Ready for Review`, set in [extension.json](extension.json) because the
  hooks need the key. This repository has no such label and does not use a ready label
  (the sidebar move to `Needs Review` is the ready signal), so the label announcement
  never fires here.
- `<ready-line>`: `PULL REQUEST <N> IS READY FOR YOUR REVIEW`, the generic default
- `<ledger-module>`: not set. `scripts/catchup.py` has no `STATIC_CHECKS_NAME`, which the
  module field requires, so the hooks read only the ledger subcommands in the config.
- `<bridge>`: the voice plugin's `voice-bridge.mjs`, which runs from a checkout of the
  Overmind repository. Its systemd units are not part of this repository.

## Overrides

None. A rule this file does not name is the general skill's rule.

## Repository notes

- The bridge and its units run on the machine that hosts the bridge, not through this
  repository. Nothing here installs or restarts them.
- [implement-with-speech](../implement-with-speech/SKILL.md): speech mode and the voice
  relay as a session sees them.
