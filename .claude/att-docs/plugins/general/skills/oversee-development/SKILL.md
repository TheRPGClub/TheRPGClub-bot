---
name: oversee-development
description: >-
  Work the open issue backlog oldest first, one issue at a time per session, unattended,
  opening one review-ready pull request per issue and never merging anything. Use when asked
  to run through the backlog, work issues while the user is away, or keep implementing issues
  on a loop - "/oversee-development", "work the backlog", "keep going through the issues".
---

# Oversee Development

Runs the backlog as a conductor. The conductor implements every issue itself, in the
foreground, by running the `/implement` skill through the Skill tool. It never hands an issue
to a subagent, so the user sees each issue's work in the session as it happens and can step
in. The queue and the ledger hold the state between issues, so a session that is compacted
partway through the backlog carries on from them rather than from the transcript.

Arguments, all optional:

- `/oversee-development` runs until the queue is empty or a stop condition hits
- `/oversee-development 5` runs the next five issues, then reports and stops
- `/oversee-development voice` restricts the queue to issues carrying one label
- `/oversee-development resume` re-reads the ledger and continues, queue as-is

`oversee.sh` below is the script in this skill's folder, the base directory the Skill tool
prints when the skill loads. Run it by that absolute path.

## What this never does

Never merges, never pushes to `main`, never closes an issue, and never deletes a branch or a
worktree. Every issue ends as an open, non-draft pull request with a self review recorded in
its body and no conflict against `main`, waiting for the user. `gh pr merge` is not part of
this workflow at any point, including when a pull request looks obviously safe and including
when the user is asleep.

## State

Two files under `.claude/oversee/` in the main checkout, driven by `oversee.sh`. They are
gitignored and shared by every worktree, and they are the memory of this skill: the
transcript is not. A session that is compacted, interrupted, or killed resumes from these
files with nothing else.

```bash
oversee.sh init [label]            # build the queue, once
oversee.sh refresh [label]         # rebuild it from the live backlog
oversee.sh next                    # refresh, then what to work or why nothing is
oversee.sh start <issue> <branch>
oversee.sh adopt <issue>           # claim an orphaned in-flight issue
oversee.sh withdraw <issue>        # take back this session's own start
oversee.sh finish <issue> <done|stalled|skipped> <pr|-> <note>
oversee.sh swap <issue> <from> <to>  # move a label, read back
oversee.sh status                  # counts and the tail of the ledger
```

`start` tags its ledger row with the session's id and process id, from
`CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID`. That tag is how several conductor sessions share
one queue: each holds its own in-flight issue and passes over the others'.

An issue's area is the word before the colon in its title (`voice: speechctl commands ...`
is area `voice`). Two issues in one area never run together, because they edit the same
folder: `next` defers the second until the first one's pull request is merged or closed.
A title with no such prefix has no area and is never deferred.

`next` prints one of these:

- `NEXT <issue> <area> <title>` work it
- `INFLIGHT <issue> ... branch <name> mine` this session's unfinished issue, resume it
  before anything else
- `INFLIGHT <issue> ... branch <name> orphan` an unfinished issue whose session has exited,
  adopt and resume it
- `ELSEWHERE <issue> ... branch <name>` in flight in another live session, printed for the
  record; its area is held until it finishes
- `DEFER <issue> ... area held by <PR or issue>` skipped this pass, printed for the record
- `BLOCKED` everything left is deferred behind an unmerged pull request or an issue in
  flight elsewhere
- `EMPTY` queue exhausted

## 1. Resume before anything else

Always start here, on every invocation, including the first.

```bash
oversee.sh status
oversee.sh next
```

`INFLIGHT` means a previous session never recorded the issue as finished. For an `orphan`
row, run `oversee.sh adopt <issue>` first, so no third session adopts it too. Do not restart
the issue: find out how far it got, with two cheap calls and no file reading.

```bash
gh pr list --head <branch> --state all --json number,state
git ls-remote origin "refs/heads/<branch>"
```

- A pull request exists: `finish <issue> done <pr> "resumed"`, move on.
- Branch pushed, no pull request: finish it with `/implement`, resuming from the existing
  branch rather than cutting a new one.
- No branch at all: `finish <issue> skipped - "session died before branching"`, swap the
  `In Progress` label off with `oversee.sh swap`, and let the queue serve it again later.

## 2. Build the queue

When `status` reports zero queued entries:

```bash
oversee.sh init          # or: oversee.sh init voice
```

`next` rebuilds the queue from the live backlog on every call, through `refresh`, so an
issue filed since the last call is in the queue it serves from. When the backlog read fails,
`next` says so on stderr and serves the last queue. The rebuild keeps every open issue the
ledger already names, whatever its labels: an issue in flight or waiting on an open pull
request still holds its area though `In Progress` would drop it.

A `skipped` issue is served again once what skipped it has cleared:

- a note starting `not workable at start:` names a label or a closed state, so the issue
  comes back once the live backlog lists it without an excluded label
- any other note comes back once every issue or pull request number it names is closed
- a note that names no other issue or pull request stays skipped, since nothing `next` can
  read says the reason is gone
- no skip comes back on a call whose backlog read failed

`done` and `stalled` rows and in-flight rows are never served again. When `next` prints
`BLOCKED` or `EMPTY`, that is the stop in step 5.

This reads issue numbers, titles, and labels. Nothing else. An issue's body is read by
`/implement` when that issue comes up, never all of them at once.

The queue drops issues labeled `In Progress`, `Blocked`, `Tracker`, `Already Done`,
`DO NOT MERGE`, `question`, `wontfix`, `duplicate`, and `invalid`, and orders what is left
oldest issue first, by issue number.

## 3. The loop, one issue at a time per session

One issue worked at a time within a session, finished before the next. That keeps each pull
request reviewable. Other conductor sessions may work the same queue alongside, each with its
own one issue; `next` keeps them apart by passing over every issue in flight elsewhere and
deferring any issue in the same area.

For each `NEXT`:

```bash
oversee.sh start <issue> <type>/issue-<issue>-<short-description>
```

`start` reads the issue's state and labels again, since the queue is a snapshot. When the
issue has closed or picked up an excluded label since, it records the issue as `skipped` and
exits non-zero: run `next` again rather than starting the issue. It also exits non-zero,
writing nothing, when another live session already started the issue: two sessions can read
the same `NEXT`, and the ledger lock lets only the first `start` through. Run `next` again
then too.

A session that started an issue and cannot work it after all, before any label or branch,
takes the start back with `oversee.sh withdraw <issue>`. That puts the issue back the way it
was before the start, so the queue serves it again, where `finish ... skipped` would record
a verdict on the issue.

Then run `/implement <issue>` in this session with the Skill tool, on the branch `start`
recorded. Never spawn a subagent for it, background or foreground. Follow that skill
exactly, including its self review of the pull request before the handoff. The self review
runs at most three passes, and only a real bug sends it round again: an unattended run that
keeps reviewing past that spends the time the next issue needed. When the work the issue
asks for is already on main, cut no branch and take the Already done path below.

When `/implement` hands the pull request off, the issue ends in one of these:

- `done`: an open pull request, self reviewed
- `stalled`: the work cannot be finished, see step 4
- `already-done`: the work is on main already, see below

A point where `/implement` asks the user a question is a pause rather than an end, and is
never recorded with `finish`. Ask with `AskUserQuestion`, carry on with `/implement` on the
answer, and record the issue only once it ends `done`, `stalled`, or `already-done`.

Record it in one ledger line, a note under 120 characters, and move on:

```bash
oversee.sh finish <issue> <status> <pr|-> "<note>"
```

A `done` issue with a pull request number is ready for the user. Put the
`Manual Review Needed` label on that pull request before running `next`, through the issues
endpoint (`gh pr edit` fails here on the classic projects lookup). The output is the
read-back, and the label is on when its name comes back:

```bash
gh api -X POST repos/{owner}/{repo}/issues/<pr>/labels \
  -f "labels[]=Manual Review Needed" --jq '[.[].name] | join(", ")'
```

When the user leaves feedback on one of the open pull requests, take the label off that pull
request at once, before starting the requested work. Do the work, and put the label back only
when it is ready again.

### Already done

An `already-done` issue has its work on main already. The conductor never closes it. It
labels the issue `Already Done` and says where the work went. Write a comment to
`$CLAUDE_JOB_DIR/tmp/done-<N>.md` (or the session scratchpad) naming the commits or pull
request that delivered it, with one line on what each delivers. Then:

```bash
oversee.sh swap <N> "In Progress" "Already Done"
gh issue comment <N> --body-file <path>/done-<N>.md
oversee.sh finish <N> done <pr|-> "already done: <note>"
```

The read-back is the gate: `Already Done` is one of the labels the queue drops, so an issue
that never got it would be served again.

Once an issue is recorded, do not go back to its branch or diff. The pull request body
carries the detail, and the user reads it at review time.

## 4. Park, do not block

An issue that cannot be finished, because what it needs is outside its scope or outside the
repository, ends `stalled` and the queue keeps moving. Write a one-line note on where it
stuck, plus the branch name, to a file with the Write tool, then:

```bash
oversee.sh swap <N> "In Progress" Blocked
gh issue comment <N> --body-file <path>/stalled-<N>.md
oversee.sh finish <N> stalled - "<note>"
```

The read-back is the gate: a park that dropped `In Progress` but never landed `Blocked` puts
the issue back in the queue it just stalled out of, and one that kept `In Progress` holds
the area against every other session.

A stalled issue may still have an open pull request, if `/implement` landed part of the work
and left the rest. That is a normal outcome, and the pull request number goes in the ledger
row either way.

## 5. Stop conditions

Stop the loop, write the final report, and stop starting issues when any of these is true:

- `next` prints `EMPTY` or `BLOCKED`, which it does only after reading the live backlog
- the `/oversee-development <n>` limit is reached
- three issues stall in a row, which means something systemic rather than three hard issues:
  a service is down or a credential expired
- `gh` stops authenticating

`BLOCKED` is not an error. It means every remaining issue is in an area an unmerged pull
request from this run already changed, or is in flight in another session. The next move
belongs to the user: review and merge, then run `/oversee-development resume`.

## 6. Report

One block at the end, short enough to read on a phone:

```
worked <n> issues, <d> done, <s> stalled
open for review: #112 (issue 110), #113 (issue 108), ...
stalled: issue 109, needs a credential the session does not hold
blocked: 4 issues behind open PRs in voice
```

Then `oversee.sh status` is the durable version of the same thing, and it survives this
session ending.

## Token discipline

**The queue reads titles, never bodies.** An issue's body is read when that issue comes up
and not before.

**Never an agent.** Every issue runs in the foreground of this session through the Skill
tool. The Agent tool, a background task, and a workflow are not ways to work an issue here,
however long the queue.

**Record an issue in the ledger before running `next`**, so a compaction between issues
loses nothing the next one needs.

**Nothing carries past an issue that the ledger cannot hold.** If a fact matters past the
current issue, it goes in the ledger note, the pull request body, an issue comment, or a
memory file.
