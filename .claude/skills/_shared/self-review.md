# Self review

Shared by `/implement`, `/next-refactor`, `/open-pr`, and any pull request a session opens
outside a skill.
Before a session hands a pull request to the user, it reviews the pull request
itself, fixes everything the review finds, and reviews it again, round after
round, until a pass finds nothing. The user's review starts from a pull request
the session has already read as a reviewer, not as its author, and found clean.

## When it starts

The self review starts as soon as the pull request is open and mergeable per
[pr-mergeability.md](pr-mergeability.md). It does not wait for CI first; CI
gates the end of the loop, per [The loop](#the-loop).

Move the session to the `Self Review` sidebar group as the review starts, per
[sidebar-groups.md](sidebar-groups.md).

The loop runs start to finish without handing anything to the user. The session
does not end its turn while a loop is unfinished, does not move to
`Needs Review`, and does not tell the user the pull request is ready or
reviewed. "Partly reviewed" is never a state to report.

## One pass

A pass always reads the whole pull request as it stands at the branch head,
not just the commits since the last pass. A fix can break something the fix
commit alone does not show.

1. Run the `code-review` skill on the pull request at `high`, with neither
   `--comment` nor `--fix`:

   ```
   Skill  skill: "code-review"  args: "high <pr-number>"
   ```

   Reviewing the pull request by number reads the diff as GitHub has it, which
   is the diff the user will read.
2. Read the diff once more against this repository's own rules, which a
   general review does not know:

   - `CLAUDE.md`: lines under 100 characters, no em dashes, no deprecated
     Discord.js or discordx APIs, channel, user, and tag ID constants in
     `src/config/`, API errors surfaced with the full request and response;
   - interactions use stable custom IDs and resume after a bot restart;
   - a raw component builder or constant a shared helper already covers;
   - `.oxlintrc.json` rules the lint run cannot see, such as intent;
   - the pull request body: `Closes #<N>` one per line, the `Testing` section
     in the shape `.github/pull-request-testing-format.md` sets, and the
     `Judgment calls` heading when the skill that opened it asks for one.
3. Check every finding before acting on it. Read the code the finding names. A
   finding holds when it names a concrete way the change goes wrong (a case
   that breaks, a restart that loses state, a rule skipped), a rule it breaks
   that can be quoted from `CLAUDE.md`, the lint config, or a skill, or a cost
   that can be pointed at (a duplicated helper, a magic number a config file
   already names). A finding that does not hold up, including a preference with
   no such cost behind it, is noted with the reason as a false positive.
   `code-review` at `high` is tuned to surface too much rather than too little,
   so this check is what lets the loop end.

## The loop

1. Run a pass.
2. No finding holds: the loop is over. Go to [When it ends](#when-it-ends).
3. Otherwise fix every finding that holds, on the branch, rerun the smoke test,
   and push. Each finding is fixed; none is set aside for the user to pick up
   at review. The session stays in `Self Review` while it fixes.
4. Go straight back to 1. The next pass does not wait for CI: the smoke test
   already ran locally, and the review reads the diff, not the checks.

CI gates only the end of the loop. After a clean pass, wait for CI on that head
in the foreground, per
[run-watch.md](run-watch.md#waiting-inside-a-self-review): a foreground
`scripts/catchup.py wait <ledger>` with the Bash tool's maximum timeout, run
again until the head's run has finished. Never end the turn to wait for it. A
failed run is a finding: fix it, push, and go back to 1.

There is no cap on the number of passes. The loop ends on a clean pass and on
nothing else.

A false positive a later pass raises again, against code that has not changed
since it was checked, does not count against a clean pass. Raised again against
code that has changed, it is checked again from scratch.

A finding that holds but whose fix is the user's call, such as a scope line the
issue does not draw, is put to the user per
[asking-the-user.md](asking-the-user.md) rather than guessed at. The session
sits in `Needs Review` while the question is open, the one case where the turn
ends mid-loop, goes back to `Self Review`
with the answer, applies it, and carries on with the loop.

The findings never go up as review comments on the pull request. Comments are
the user's review.

## The `Self review` section

The pull request body carries a `Self review` heading, updated after each pass.
It says how many passes ran and lists each finding by pass: what it was, and
the commit that fixed it or the reason it was a false positive. The last pass
is listed as clean. A first pass that found nothing reads "one pass, no
findings" rather than dropping the heading.

Patch the body from a scratchpad file, per [shell-text.md](shell-text.md):

```bash
gh api -X PATCH repos/{owner}/{repo}/pulls/<pr-number> -F body=@<scratchpad>/pr-body.md
```

## Commits after the handoff

Commits pushed after the handoff, for the user's review comments or anything
else, send the pull request back through the loop, starting with a full pass
once CI is green, in `Self Review`.

## When it ends

The review ends on a pass that finds nothing, with CI passed on the last push
and the pull request still reading as mergeable. A sibling branch can merge
while the review runs, so read mergeability again rather than trusting the
earlier read. A conflict resolved at that point is a new commit, so it goes
back through the loop. Then the session moves to `Needs Review` and reports.

The report says in a line or two how many passes ran and what they found and
fixed.
