# Labeling an issue

Shared by `/implement` and any skill that claims an issue. The commands, the
read-back that proves a label landed, and what a failed one means are written
out here once. A skill that adds or removes a label points here rather than
restating it.

## The label is the claim, not a note about it

Several sessions run against this repository at once and none of them can see
what the others are doing. `In Progress` is what tells the next session an
issue is already being worked. An unlabeled issue in flight is two branches on
one issue, found at merge.

So labeling is a gate. It is not attempted, reported as failed, and moved past.

## Add, then read back

Every label change is two commands, and the second one is not optional:

```bash
gh issue edit <N> --add-label "<label>"
gh issue view <N> --json labels --jq '[.labels[].name] | join(", ")'
```

The read-back prints what actually stuck. The label the skill just applied is
in that list before anything else in the skill runs, and the list is stated in
the session, because a dropped label shows nowhere else.

A label that did not land stops the session: report the error and the label
list as it stands, and ask the user how to proceed with `AskUserQuestion`, per
[asking-the-user.md](asking-the-user.md). The two causes worth checking first
are a name that does not match an existing label exactly, and `gh` resolving a
different repository than the one the issue lives in.

## Never create a label

Only labels the repository already carries. Names are exact, spacing and case
included: `In Progress`, not `in-progress`. A skill that needs a label the repo
does not have reports that to the user and stops, rather than creating one.

## `In Progress` comes off

Whichever step of a skill ends the claim (a merge, a pull request closed
without merging, work abandoned) removes the label in that same exchange, read
back the same way:

```bash
gh issue edit <N> --remove-label "In Progress"
gh issue view <N> --json labels --jq '[.labels[].name] | join(", ")'
```

GitHub's auto-close on a merge keeps labels, so nothing strips it on its own. A
stale `In Progress` makes every other session stand down from an issue that
nobody is working.
