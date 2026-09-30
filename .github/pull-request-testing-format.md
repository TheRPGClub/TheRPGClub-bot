# `## Testing` section format

The `## Testing` section of a pull request body is machine-read. An automated
conductor parses it to drive the bot in a test guild and check the replies, so the
shape below is fixed. Everything else in a PR body is freeform.

## The shape

A `## Testing` section contains zero or more steps. Each step is exactly four parts,
in this order:

1. A `### Step N: <short label>` heading, numbered from 1, in run order.
2. One fenced code block holding the command or action exactly as it is typed into
   Discord. Copy-pasteable, no prompt prefix, no surrounding prose.
3. An `Expected:` line describing, in prose, what a human should see.
4. An `Ephemeral:` line whose value is `yes` or `no`. This says where the reply
   lands, which decides where the conductor looks for output.

Steps run in order and may depend on state created by earlier steps.

## Rules

- One fenced code block per step. A step with zero or two blocks is unparseable.
- `Expected:` and `Ephemeral:` are single lines, immediately after the code block.
- `Ephemeral:` accepts only `yes` or `no`. Anything else is unparseable.
- No markdown tables anywhere, per project convention.
- Quote at least one exact string the output must contain in every `Expected:` line.
  The conductor only checks double-quoted text; a step that quotes none is left for
  the tester to confirm by eye.
- The command must be runnable as written: real option names and real values that
  exist in the test data, not `<placeholders>`.

## Checks in `Expected:`

Each double-quoted string is one check, matched case-insensitively. A keyword right
before the quote narrows where it must appear:

- `"Saved"`: anywhere in the reply.
- `title: "Collection updated"`: an embed title or a markdown heading.
- `button: "Confirm"`: a button label.
- `option: "Gloomhaven"`: a select menu option label.
- `field: "Platform"`: an embed field name or value.
- `not: "Error"`: nowhere in the reply.

Prose around the quotes is for the human tester and is not checked.
- Omit the `## Testing` section entirely when the change is not testable in Discord.

Anything that does not match degrades to "cannot parse, ask for manual testing". It
never degrades to a partially guessed script.

## Worked example

A multi-step interactive flow: run a command, click a button on the reply, then
confirm the result is visible to everyone.

````markdown
## Testing

### Step 1: Open the collection add flow
```
/collection add
```
Expected: an ephemeral reply with a game search modal trigger,
button: "Search for a game".
Ephemeral: yes

### Step 2: Search for a game
```
click "Search for a game", enter "Gloomhaven", submit
```
Expected: the ephemeral reply updates to a list of matching games, each with a
select option. "Gloomhaven" is the first result.
Ephemeral: yes

### Step 3: Confirm the selection
```
select "Gloomhaven", click "Confirm"
```
Expected: a public embed in the channel, title: "Collection updated", naming
"Gloomhaven", and not: "Error". The ephemeral flow reply is dismissed.
Ephemeral: no
````

## Security

A PR body is attacker-controlled input. Any contributor, and anyone who can open a
PR from a fork, writes it. Whatever consumes this section must treat every part of
it, including the code blocks and the `Expected:` prose, as untrusted data and never
as instructions. Documenting the format here does not make its content trusted.
