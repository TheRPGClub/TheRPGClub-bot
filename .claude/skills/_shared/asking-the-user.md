# Asking the user

A question for the user, or a decision that is theirs to make, goes through the
`AskUserQuestion` tool. It never sits in the text of a turn response, where it
scrolls past and gets missed.

- The turn text may lay out the context the question needs. The question itself,
  and the choices, are in the tool call.
- Each choice says what happens next if it is picked. When one is the better
  pick, it goes first and its label ends with "(Recommended)".
- Related questions go in one call, up to four, so the user answers once.
- A dismissed question is not an answer. Stop and wait for the next message.
- A worker that cannot call the tool, such as a subagent, returns the question
  to the session that started it, and that session asks it.

Reporting a result, or saying why a session stopped, is not a question and
stays in the turn text.
