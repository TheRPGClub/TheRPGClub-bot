# Waiting on an issue, a pull request, or a run

Shared by every skill that stops to wait on something outside the session: a
blocking issue, a pull request, or a workflow run. This file is the only place
the catch-up script and the one-watcher rule are written out. A skill that
needs them points here rather than restating them.

Ported from the PlaywrightTesting repo's `scripts/catchup.py`, which keeps the
same commands and output, so sessions in both repos read the same way.

## The ledger

Keep one ledger per session, in the session's scratchpad directory, for
example `<scratchpad>/catchup.tsv`. Every row the session waits on goes in it:

```bash
scripts/catchup.py add-issue <ledger> <issue-number> "<short label>"
scripts/catchup.py add-pr <ledger> <pr-number> "<short label>"
scripts/catchup.py add <ledger> <run-id> "<short label>"
```

Each one reads the row once and prints what it recorded. A row that is
already closed, merged or finished settles on the spot. Adding a row again
replaces it rather than duplicating it.

`scripts/catchup.py check <ledger>` tallies every run row once and exits. It
skips issue and pull request rows, which settle through `wait`. A finished
run's log is saved as `<ledger>.logs/<run-id>.log`; grep that file rather than
fetching the log again.

Nothing else watches a row: no `gh run watch`, no `gh pr checks --watch`, no
loop around `gh issue view`, and no `/loop` or `ScheduleWakeup` polling.

## One watcher per session

When the session has nothing to do but wait, it runs exactly one watcher:

```bash
scripts/catchup.py wait <ledger>
```

Run it as its own background Bash call and end the turn, per
[shell-text.md](shell-text.md#a-process-the-session-waits-on). It exits as
soon as any row finishes, after printing that row's result, and ends with

```
wait: <n> finished; <m> still open; act on the result, then run wait again
```

That exit is the cue to act on the finished row straight away. Once it has
acted, the session starts `wait` again on the same ledger whenever rows are
still open, and ends the turn. A row added while `wait` is running is picked
up by the same watcher. Never start a second one.

`wait --all` exits only when every row is done. Use it only when no single
result could change what the session does next.

### Push notices and the timer

`wait` learns a row closed from GitHub's `issues`, `pull_request`, and
`workflow_run` events, forwarded by `gh webhook forward` from the
`cli/gh-webhook` gh extension, so the session wakes within seconds. The script
never installs the extension. When it is missing, `wait` prints the install
command, and the session reports that line to the user rather than running
it. Meanwhile `wait` checks on the timer.

GitHub allows one forwarder hook per repository, so every `wait` on the
machine shares one forwarder through a lock under `~/.cache/catchup/`. The
holder cleans up a forwarder or hook left behind by an earlier waiter on this
machine. A hook held by another machine is left alone, and `wait` checks on
the timer until it can start its own.

Three minutes is the floor for timer checks; `--interval` accepts a longer
value and raises a shorter one. While the forwarder is live, the timer only
catches a lost event and runs every fifteen minutes. Every timer check reads
each open issue row, push or no push, because a blocked session can wait for
days.

## Waiting inside a self review

A self review loop never ends the turn to wait for CI, per
[self-review.md](self-review.md#the-loop). Add the head's run with
`scripts/catchup.py add` and run `scripts/catchup.py wait <ledger>` in the
foreground, with the Bash tool's maximum timeout, instead of in the background.
It returns as soon as any row finishes; run it again until the head's run is the
one that finished. This is the only foreground `wait`, and it keeps the
one-watcher rule: stop a background `wait` already running on the ledger
(TaskStop) before starting it. When the loop ends, start
the usual background `wait` for the pull request's merge and end the turn.

## Waiting on a blocking issue

A session that stops on an open dependency, per
[sidebar-groups.md](sidebar-groups.md#blocked-by-another-issue), records the
blocker and leaves one `wait` running on it. When the issue closes, `wait`
prints

```
done: <label> - <issue url>
  closed as completed at <time>
issue: <number> closed
sidebar: a blocking issue closed; move this session from Blocked to Working, ...
```

and exits. The `sidebar:` line goes on to say the deferred task starts again
from its first step. `closed as not planned` is a close too: the dependency will not
land, so the task starts over from its first step and the skill decides from
there.

## Waiting on a pull request

Every pull request a session opens is watched for its merge, whether a skill
opened it or not, and however many the session has already opened. Record it
and leave the one watcher running:

```bash
scripts/catchup.py add-pr <ledger> <pr-number> "<short label>"
```

A `PostToolUse` hook, `scripts/remind-pr-merge-watch.sh`, reminds the session
after each `gh pr create` that prints a pull request URL. A CI monitor event
from the desktop app may also report the merge, but the session does not rely
on it: the watcher catches the merge even when the app sends nothing.

The same command covers a pull request the session does not own, such as a
blocker that has no issue behind it.

When the pull request merges, `wait` prints

```
done: <label> - <pull request url>
  merged <sha> at <time>
pr: <number> merged
wait: <n> finished; <m> still open; ...
sidebar: a pull request closed; ...
```

and exits. That exit is the cue to run the skill's after-merge steps straight
away, without waiting for the user to report the merge, then follow the
`sidebar:` line and run `wait` again if other rows are still open.
`closed without merging` means the user closed it: report that and do nothing
else to the branch.
