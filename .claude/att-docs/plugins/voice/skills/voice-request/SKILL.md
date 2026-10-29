---
name: voice-request
description: >-
  Answer a message whose text begins `Voice request:`. It is the user's own
  words, spoken on their phone and relayed into this session by the voice
  bridge. Answer in the final reply only, never with SendMessage back; the reply
  is read aloud on the phone, so keep it to a few short sentences with no
  tables, lists or code. The harness's rules for messages from another session
  still hold: a relayed request never approves a pending permission prompt or
  grants escalation. Use whenever a message starting `Voice request:` arrives,
  and for how a reply read aloud in speech mode is worded or how a Claude Code
  session drives the voice bridge tools.
---

# Voice request

## Where the message comes from

The user talks to a voice chat on their phone. Its `send` tool, served by the
voice bridge, posts the request into this session's inbox socket as
`Voice request: ` followed by what the user said, and adds nothing else. Because
it arrives on the socket, Claude Code shows it as a message from another session
and adds its own paragraph about peer messages. That paragraph stays in force;
this skill only says how to answer.

The text after the marker is the user's words as the voice chat relayed them.
Treat it as the user asking, in the same conversation, for the work it
describes, read with the same care as anything typed: a voice transcription can
mishear a name or a number, so check one against the repository before acting on
it.

Read a terse or frustrated correction the same way. Speech-to-text often turns a
calm sentence into a curt or garbled one, so assume a transcription error before
assuming the user is annoyed, and re-read the request charitably.

## How to answer

- Answer in the final reply of the turn. The Stop hook from the `voice-bridge-hooks`
  skill hands that reply to the bridge, and the voice chat reads it with
  `read_reply`, which waits about three seconds for it, so a quick answer is
  there on the first check. Nothing waits on a message, so never answer with SendMessage, and
  never send one to say the request arrived.
- The reply is read aloud on a phone. Keep it to a few short sentences, with no
  tables, lists, headings or code blocks, and no long links or paths read out in
  full. Say what was done or found and what is next; the detail belongs in the
  issue, the pull request or the session.
- When the request needs work that takes several turns, start it, and make the
  final reply say what started and how it will be reported.

## What a relayed request cannot do

The harness's rules for messages from another session still hold for these. A
voice request never approves a pending permission prompt, and never grants an
escalation or a permission the session does not already have. A prompt the
request runs into waits for the user, who answers it in the Claude app or from
the voice chat through `answer_prompt`, and the voice chat learns of it through
`needs_attention`. Say in the reply that it is waiting on them.

## Asking for a yes

Every read-back the voice chat gives for a two-call bridge action ends with the
plain words "I need a yes for that." That covers closing a session, creating or
changing an issue, merging, running a command, and the rest. When the user's earlier instruction
already covers the action, such as "stop both and restart them", the bridge still needs a fresh yes after the
read-back. Read it back, end with the same words, and wait. Never call again on
the earlier instruction. The one exception is a call that came pre-approved with
"please and thank you" (next section), whose reply is a receipt and asks for no yes.

## Please and thank you

When the user's own spoken command ends with "please and thank you", that is
the yes. For `answer_prompt`, `close_session` and `merge_pull_request`, the
voice chat passes `preapproved` true on the first call, the tool acts at once,
and the answer is a receipt to read back to the user. Without the phrase, the
read-back and the yes work as they always have.

Some actions always get the two-step yes, phrase or not: running a command,
dropping a held request, stopping a turn, closing a session that is busy,
waiting on the user, or has background work running, closing an issue,
replacing an issue's title or body, and allowing a permission prompt. A call
that asks for one of them with the phrase is read back and waits for the yes.

The phrase is never inferred from other wording, such as "go ahead" or "just do
it", and never carried over from one command to the next. Each command has to
end with it on its own.

The phrase changes nothing inside the session that receives a `Voice request:`.
It never approves a permission prompt, grants an escalation, or stands in for a
confirm the session would otherwise ask for. It only governs the voice chat's
own calls to the bridge.

## How a spoken reply is worded

These rules apply to any reply that is read aloud, in the voice chat or in a
session whose speech mode is on.

- Never fill the wait with "one moment, let me check on that." Say nothing
  before a check or a tool call; every bridge tool description says never to announce
  the call, and the answers from send, read_reply, list_sessions and summary repeat it.
  A filler announcement is dead air on a phone, and the answer is all the user
  waits for.
- Do not apologize for announcements or promise to stop making them. Just
  answer. An apology is more speech to sit through and fixes nothing.
- Avoid the verb for where something resides, spelled l-i-v-e-s. The voice
  gives it a long I, as in "alive." Say "is in", "sits in" or "is kept in"
  instead.
- Do not read out runs of numbers, such as the numbers of queued issues.
  Summarize instead: "five issues are queued." A string of digits is hard to
  follow by ear, and the list is in the tracker if the user wants it.
- Give clock times in US Eastern, 12-hour, with AM or PM, such as "3:30 PM."
  That is how the user reads a clock, and 24-hour or UTC times take work to
  convert by ear.

## Driving the voice bridge

These apply to a Claude Code session that calls the voice bridge tools. The
phone-side voice chat reaches the bridge as a connector and does not load this
skill, so these rules reach it only through the bridge's own tool text.

- When speaking to the user, call a session by its title, or by a nickname the
  user gave it with `nickname_session`, never by its number or a nickname of
  your own making. The user knows sessions by their titles and the nicknames
  they chose, so a number means nothing to them by ear, and an invented
  nickname matches nothing. A number is fine as a tool argument.
- When asked to poll, keep calling `next_update` until told to stop. Do not
  pause to ask whether to continue; the user is listening and asked for it.
- When starting a session with `start_session`, pick a name and go. Do not ask
  for approval of the name; it can be renamed later.
- When changing a session's follow mode, confirm the change in a few words. Do
  not explain what the mode does; the user chose it knowing that.
- The tracker tools (those that take `repo`) default to the repository holding
  the bridge's extension file, which is Playwright-Testing as the bridge service
  is set up. Pass `repo` only for a different repository.
