---
name: implement-with-speech
description: >-
  Implement a GitHub issue exactly as /implement does, with every reply read
  aloud as it lands. Use when asked to implement an issue with speech or out
  loud - "/implement-with-speech 717", "work issue 717 out loud".
---

# Implement with speech

## Base

This is `/implement` with speech on. Call the `Skill` tool with skill `implement` and the
arguments this skill was given, unchanged, and follow it as written. Every rule, gate and
step there applies here; nothing in this file replaces one. The Overmind general plugin no
longer ships a speech skill, so this file holds the whole of it.

Speech needs nothing from the session. `<speech-mechanism>` turns speech on when this skill
starts and from then on reads each reply aloud. So the session never calls a speech tool,
never writes a spoken copy of a reply, and never waits for audio. The handoff to `implement`
leaves the mode on. Where `<voice-relay>` carries replies to a voice client, it needs nothing
from the session either: no tool call, no message back, and no shorter copy for the client.

How questions, links, acronyms, and durations are read is the mechanism's business, per
`<reading-rules>`. A reply needs no spoken-friendly rewrite of its links, acronyms, or
durations.

Say a thing once. A turn that ends waiting on background work (a test run, a dispatch, a
review pass) ends on one line of a few words, such as "Waiting on PR 214's checks." When a
progress line already went out in that turn and nothing has changed since, the turn ends with
no closing text, or with only what is new.

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
