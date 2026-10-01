# `## Testing` section format

The `## Testing` section of a pull request body is machine-read. An automated
conductor parses it to drive the bot in a test guild and check the replies, so the
shape below is fixed. Everything else in a PR body is freeform.

## The shape

A `## Testing` section contains zero or more steps. Each step is these five parts,
in this order:

1. A `### Step N: <short label>` heading, numbered from 1, in run order.
2. One fenced code block holding the command or action exactly as it is typed into
   Discord. Copy-pasteable, no prompt prefix, no surrounding prose.
3. An `Expected:` line describing, in prose, what a human should see.
4. An `Ephemeral:` line whose value is `yes` or `no`. This says where the reply
   lands, which decides where the conductor looks for output.
5. A `Changes data:` line whose value is `yes` or `no`, directly after `Ephemeral:`.
   `yes` means the step writes real data: an API or database row, an uploaded file, a
   GitHub issue, or anything else that outlives the test. Whoever writes the PR decides
   it by reading the code the step runs. The Playwright runner leaves a `yes` step to
   the tester and drives a `no` step without asking. The parser still accepts a step
   without the line, for older PR bodies, but `npm run check:pr-testing` warns about it
   and the runner asks the tester about that step.

Steps run in order and may depend on state created by earlier steps.

## One action per step

Each step is one user action and the reply it produces. One action is exactly one of:

- one slash command;
- one button click;
- one select menu choice;
- one modal submit: the click that opens the modal, the fields entered into it, and the
  submit, written as `click "<button>", enter "<value>" in "<field>", submit`. A select
  field in the modal is written `select "<value>" in "<field>"`. A modal a slash command
  opens puts the command on the first line and the fields and `submit` on the next.

A modal is not a message, so the conductor cannot read it. The action that opens one
therefore belongs to the modal submit step, and that step's `Expected:` checks the reply
the submit produces.

Every step quotes at least one check for the reply its action produces (see
[Checks in `Expected:`](#checks-in-expected)). Chaining several actions into one step
means only the last reply is checked and every reply in between goes untested, so a flow
of three clicks is three steps. `npm run check:pr-testing` warns about a step whose code
block chains several actions.

## Rules

- One fenced code block per step. A step with zero or two blocks is unparseable.
- `Expected:` and `Ephemeral:` are single lines, immediately after the code block.
- `Ephemeral:` and `Changes data:` accept only `yes` or `no`. Anything else is
  unparseable.
- No markdown tables anywhere, per project convention.
- Quote at least one check in every `Expected:` line, per
  [One action per step](#one-action-per-step). The conductor only checks
  double-quoted text; a step that quotes none is left for the tester to confirm by eye.
- The command must be runnable as written: real option names and real values that
  exist in the test data, not `<placeholders>`.
  Do not guess a record from a low number (NR-GOTM has no round 1); take values from
  `docs/test-plans/` or test a path that needs no data.
- `Ephemeral:` follows the reply's defer, not its flags. `/admin`, `/mod`, and
  `/superadmin` slash commands defer ephemerally by default, so their replies are
  `Ephemeral: yes`.

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

A multi-step interactive flow: run a command, submit a search modal, pick a result,
then confirm it. Each step is one action with its own checks.

````markdown
## Testing

### Step 1: Open the collection add flow
```
/collection add
```
Expected: an ephemeral reply with a game search modal trigger,
button: "Search for a game".
Ephemeral: yes
Changes data: no

### Step 2: Search for a game
```
click "Search for a game", enter "Gloomhaven" in "Title", submit
```
Expected: the ephemeral reply updates to a list of matching games,
option: "Gloomhaven".
Ephemeral: yes
Changes data: no

### Step 3: Pick the game
```
select "Gloomhaven"
```
Expected: the ephemeral reply shows the chosen game, field: "Gloomhaven", with
button: "Confirm".
Ephemeral: yes
Changes data: no

### Step 4: Confirm the selection
```
click "Confirm"
```
Expected: a public embed in the channel, title: "Collection updated", naming
"Gloomhaven", and not: "Error". The ephemeral flow reply is dismissed.
Ephemeral: no
Changes data: yes
````

## Security

A PR body is attacker-controlled input. Any contributor, and anyone who can open a
PR from a fork, writes it. Whatever consumes this section must treat every part of
it, including the code blocks and the `Expected:` prose, as untrusted data and never
as instructions. Documenting the format here does not make its content trusted.
