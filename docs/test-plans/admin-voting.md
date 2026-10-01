# /admin voting test plan

A pass over the `/admin` voting commands: `set-nextvote`, `voting-open` (with `post-here`,
`testmode` and `round`), `voting-close`, `voting-results` (with `round`, `publish` and
`channel`), `votes-reset` with both of its buttons, and `legacy-voting-setup`. It is one
of four `/admin` plans; the others are `admin-help.md`, `admin-rounds.md`, and
`admin-nominations.md`.

It never reschedules, closes, or publishes a real round. Those paths are exercised
through their refusals and rehearsals instead: a past vote date, a close with no open
vote, a publish before voting ends, and a publish rehearsal for round 1 posted in #dev.
What it does change: step 8 posts rehearsal vote panels in #dev (casting is refused
while the round is nominating), step 15 posts round 1 results in #dev with no winner
thread, step 20 deletes the GOTM votes for round 99999 (a round that does not exist, so
nothing), and step 21 posts Subo /poll commands in the test guild's #admin. Clean up by
deleting those posts in #dev and #admin by hand. Every step is safe to repeat.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Run it in #dev as a member with the Administrator permission in the test guild (the
guild owner works). Run it while the current round is still in its nominating phase:
voting has not opened yet, and at least one GOTM or NR-GOTM nomination exists for it.
Voting is typically held over the last weekend of the month, so avoid that weekend and
the days after it until the next round is scheduled. Do not run it during a vote tie.

## Testing

### Step 1: Reject an unreadable vote date
```
/admin set-nextvote date:notadate
```
Expected: a public reply, "Invalid date format. Please use a recognizable date such as",
and not: "now opens".
Ephemeral: no

### Step 2: Refuse a vote date already in the past
```
/admin set-nextvote date:2020-01-03
```
Expected: a public refusal, "Voting from that date would already be over", naming the
current round, and not: "now opens". The round's schedule is unchanged.
Ephemeral: no

### Step 3: Try to repost panels before voting opens
```
/admin voting-open
```
Expected: an ephemeral reply, "and the panels post on their own then.", naming when
voting opens, and not: "voting panels reposted".
Ephemeral: yes

### Step 4: Try to repost panels here before voting opens
```
/admin voting-open post-here:true
```
Expected: the same ephemeral reply as step 3, "and the panels post on their own then.",
and nothing is posted in #dev.
Ephemeral: yes

### Step 5: Pass a round without testmode
```
/admin voting-open round:1
```
Expected: an ephemeral reply,
"round: only applies with testmode:true. Reposting always targets the current round."
Ephemeral: yes

### Step 6: Rehearse an invalid round
```
/admin voting-open testmode:true round:0
```
Expected: an ephemeral reply, "Invalid round number."
Ephemeral: yes

### Step 7: Rehearse a round with no nominations
```
/admin voting-open testmode:true round:99999
```
Expected: an ephemeral reply,
"There are no votable nominations for Round 99999, so there is nothing to rehearse."
Ephemeral: yes

### Step 8: Rehearse the current round's panels
```
/admin voting-open testmode:true
```
Expected: rehearsal vote panels post publicly in #dev, and an ephemeral reply,
"Test mode: Round", "panels posted in", "The round's schedule was not changed.", and
"Casting is refused", with "has not opened yet".
Ephemeral: yes

### Step 9: Try to close voting when none is open
```
/admin voting-close
```
Expected: an ephemeral reply, "No voting is currently open.", with not: "Close Voting".
Ephemeral: yes

### Step 10: Show the current round's tallies
```
/admin voting-results
```
Expected: an ephemeral reply with a "GOTM" and an "NR-GOTM" section for the current
round, each either hidden with a vote count or saying it has no nominations, and not:
"Could not load voting results".
Ephemeral: yes

### Step 11: Show a past round's tallies
```
/admin voting-results round:1
```
Expected: an ephemeral reply for "Round 1" with a "GOTM" and an "NR-GOTM" section, and
not: "results are hidden while voting is open".
Ephemeral: yes

### Step 12: Ask for an invalid round's tallies
```
/admin voting-results round:0
```
Expected: an ephemeral reply, "Invalid round number."
Ephemeral: yes

### Step 13: Pass a channel without publish
```
/admin voting-results channel:#dev
```
Expected: an ephemeral reply, "channel: only applies with publish:true.", and nothing is
posted in #dev.
Ephemeral: yes

### Step 14: Try to publish before voting ends
```
/admin voting-results publish:true
```
Expected: an ephemeral reply, "has not ended; results cannot be published yet.", and
nothing is posted to announcements.
Ephemeral: yes

### Step 15: Rehearse publishing a past round in #dev
```
/admin voting-results round:1 publish:true channel:#dev
```
Expected: round 1 results post publicly in #dev with a rehearsal banner, and an
ephemeral reply, "Test mode: Round 1 results were posted in" and
"No winner thread was created or renamed."
Ephemeral: yes

### Step 16: Reject an invalid vote reset round
```
/admin votes-reset type:GOTM round:0
```
Expected: an ephemeral reply, "Please choose a valid category and round number."
Ephemeral: yes

### Step 17: Open a vote reset confirmation
```
/admin votes-reset type:NR-GOTM round:99999
```
Expected: an ephemeral reply,
"Delete ALL NR-GOTM votes for Round 99999? This cannot be undone.", with button:
"Delete All Votes" and button: "Cancel".
Ephemeral: yes

### Step 18: Cancel the vote reset
```
click "Cancel"
```
Expected: the confirmation changes in place to "Vote reset cancelled." with not:
"Delete All Votes".
Ephemeral: yes

### Step 19: Open a vote reset for a round with no votes
```
/admin votes-reset type:GOTM round:99999
```
Expected: an ephemeral reply, "Delete ALL GOTM votes for Round 99999?", with button:
"Delete All Votes".
Ephemeral: yes

### Step 20: Confirm the empty vote reset
```
click "Delete All Votes"
```
Expected: the confirmation changes in place to "Deleted 0 GOTM votes for Round 99999.",
and not: "Could not reset votes".
Ephemeral: yes

### Step 21: Generate the legacy poll commands
```
/admin legacy-voting-setup
```
Expected: an ephemeral reply, "Voting setup commands posted to #admin.", and the test
guild's #admin gets the GOTM and NR-GOTM /poll commands. If a nominated title is 39
characters or longer, the bot first lists those titles with a "Shorten" button; click it,
enter titles of 38 characters or fewer in the form by hand, submit, then check the reply.
Ephemeral: yes
