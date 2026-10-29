---
name: implement-with-speech
description: >-
  Implement an issue exactly as the implement skill does, with every reply read aloud as
  it lands. Use when asked to implement an issue with speech or out loud.
---

# Implement with speech

| Placeholder | Meaning |
| --- | --- |
| `<speech-mechanism>` | What turns speech on when this skill starts, reads each reply aloud, and turns it off again |
| `<voice-relay>` | Any channel that also carries each reply to a voice client, if the repository has one |
| `<reading-rules>` | How the mechanism reads questions, links, acronyms, and durations |

This is `/implement` with speech on. Call the `Skill` tool with skill
`implement` and the arguments this skill was given, unchanged, and follow it as
written. Every rule, gate and step there applies here; nothing in this file
replaces one.

## Speech

Speech needs nothing from the session. `<speech-mechanism>` turns speech on
when this skill starts and from then on reads each reply aloud. So the session
never calls a speech tool, never writes a spoken copy of a reply, and never
waits for audio. The handoff to `implement` leaves the mode on.

## Voice relay

Where `<voice-relay>` carries replies to a voice client, it needs nothing from
the session either: no tool call, no message back, and no shorter copy for the
client.

## How replies are read

How questions, links, acronyms, and durations are read is the mechanism's
business, per `<reading-rules>`. A question asked through a tool is heard
without being repeated in the reply text, and a reply needs no spoken-friendly
rewrite of its links, acronyms, or durations.

## Say a thing once

Every reply is heard, so say a thing once. A turn that ends waiting on
background work (a test run, a dispatch, a review pass) ends on one line of a
few words, such as "Waiting on PR 214's checks." When a progress line already
went out in that turn and nothing has changed since, the turn ends with no
closing text, or with only what is new. Never a progress note before the wait
and then a closing message that restates it.
