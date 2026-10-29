---
name: implement-with-speech
description: >-
  Implement a GitHub issue exactly as /implement does, with every reply read
  aloud as it lands. Use when asked to implement an issue with speech or out
  loud - "/implement-with-speech 717", "work issue 717 out loud".
---

# Implement with speech

## Base

Read
[the general skill](../../att-docs/plugins/general/skills/implement-with-speech/SKILL.md)
first and follow it, except where this file overrides it. The general skill is the
vendored copy pinned by `.claude/att-docs.lock`; never edit it here.

## Paths

- `<speech-mechanism>`: the `voice` plugin's `speak-attention.sh` hooks, installed at user
  scope. They turn speech on when this skill starts and read each reply aloud in the
  background.
  This repository registers no hooks of its own.
- `<voice-relay>`: the voice bridge, which carries each reply to the phone. Its values
  for this repository are in
  [extension.json](../voice-bridge-hooks/extension.json).
- `<reading-rules>`: the `voice-bridge-hooks` skill, and the reading rules in the
  general skill.

## Overrides

None. The `implement` skill that this one calls is this repository's own extension in
[implement](../implement/SKILL.md).

## Repository notes

- [voice-bridge-hooks](../voice-bridge-hooks/SKILL.md): how the hooks are wired here.
