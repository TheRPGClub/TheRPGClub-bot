# Voting sandbox test plan, part 2

The rest of `/vote-sandbox`: the `start` options (`round`, `cap`, `gotm-nominations`,
`nr-gotm-nominations`, `source-round`), the one-day reminder, `deliver`, events that no
longer apply, the refusals for a phase or a game count that does not allow a step, a
three-way tie whose runoff ties again, broken with joint winners, a category with no
votes, and panels from a replaced or ended sandbox. Part 1 (`voting-sandbox-1.md`) covers the main walk.

It changes no real club data. The sandbox lives in one wizard session row for you, and
`source-round` only reads a real round's nominations. It does post in the test guild:
reminders in the nomination channels, panels, runoff panels and results in
announcements, tie prompts and "Sandbox Round N decided" summaries in the admin channel,
and a scheduled event for the round after each decided one. The plan ends its sandbox at the end.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it:

- The bot must run in test mode; `/vote-sandbox` only exists in the test guild.
- Run it as an admin (Administrator permission) who also has the test guild's Members
  role.
- Step 1 replaces any sandbox you already have.

## Testing

### Step 1: Start a small sandbox with custom options
```
/vote-sandbox start round:500 cap:1 gotm-nominations:1 nr-gotm-nominations:0
```
Expected: an ephemeral reply, "Started sandbox",
"Any earlier sandbox of yours was replaced", "Round 500", "vote cap 1",
"1 votable game(s)", and "0 votable game(s)".
Ephemeral: yes

### Step 2: Post the one-day nomination reminder
```
/vote-sandbox remind which:One day out
```
Expected: an ephemeral reply, "Queued the one-day nomination reminder.",
"nomination_reminder_1d", and "delivered". The reminder posts in both nomination channels.
Ephemeral: yes

### Step 3: Open voting
```
/vote-sandbox open
```
Expected: an ephemeral reply, "Opened voting.", "voting_opened", and "delivered". Check by
eye that only a GOTM panel posts in announcements, since NR-GOTM has no games.
Ephemeral: yes

### Step 4: Open voting a second time
```
/vote-sandbox open
```
Expected: an ephemeral error, "Could not open sandbox voting" and
"voting only opens from nominating."
Ephemeral: yes

### Step 5: Seed a tie with only one game
```
/vote-sandbox seed gotm:Two-way tie
```
Expected: an ephemeral error, "Could not seed the sandbox votes",
"GOTM has 1 votable game(s)", and "needs at least 2."
Ephemeral: yes

### Step 6: Vote on the Round 500 panel
```
click "Sandbox GOTM Game 1" on the Round 500 GOTM sandbox panel in announcements
```
Expected: an ephemeral reply, "Vote recorded for", "Sandbox GOTM Game 1", and
"Your GOTM votes for Round 500 (1/1)".
Ephemeral: yes

### Step 7: Close voting with a single vote
```
/vote-sandbox close
```
Expected: an ephemeral reply, "Closed voting.", "voting_closed", "round_decided", and
"Winner(s): Sandbox GOTM Game 1", with no tie prompt.
Ephemeral: yes

### Step 8: Vote after voting has closed
```
click "Sandbox GOTM Game 1" on the Round 500 GOTM sandbox panel again
```
Expected: an ephemeral error, "Voting for Round 500 closed", and not: "Vote recorded".
Ephemeral: yes

### Step 9: Check the final results
```
click "Results" on the Round 500 GOTM sandbox panel
```
Expected: an ephemeral reply, "GOTM Results - Round 500", "Sandbox GOTM Game 1", and
"Each member could vote for up to 1 game."
Ephemeral: yes

### Step 10: Fire a stale voting_opened event
```
/vote-sandbox event kind:voting_opened
```
Expected: an ephemeral reply, "without changing the round", "voting_opened", and
"skipped". No new panel posts.
Ephemeral: yes

### Step 11: Fire a stale tie_pending event
```
/vote-sandbox event kind:tie_pending
```
Expected: an ephemeral reply, "tie_pending" and "skipped". No tie prompt posts.
Ephemeral: yes

### Step 12: Retry delivery with nothing queued
```
/vote-sandbox deliver
```
Expected: an ephemeral reply, "Retried the queued events." and "Queued events: none."
Ephemeral: yes

### Step 13: Replace the sandbox with 30 GOTM games
```
/vote-sandbox start gotm-nominations:30 nr-gotm-nominations:0
```
Expected: an ephemeral reply, "Started sandbox", "Round 999", "30 votable game(s)", and
"...and 20 more".
Ephemeral: yes

### Step 14: Use a panel from the replaced sandbox
```
click "My Votes" on the Round 500 GOTM sandbox panel
```
Expected: an ephemeral error, "Could not load your votes" and
"belongs to a voting sandbox that has ended or been restarted".
Ephemeral: yes

### Step 15: Open voting on the 30-game sandbox
```
/vote-sandbox open
```
Expected: an ephemeral reply, "voting_opened" and "delivered". Check by eye that the new
GOTM panel has two "Cast or take back a vote..." menus in place of game buttons, since
30 games is past the 25 that fit as buttons.
Ephemeral: yes

### Step 16: Vote from the second menu
```
select "Sandbox GOTM Game 30" from the second menu on the Round 999 GOTM sandbox panel
```
Expected: an ephemeral reply, "Vote recorded for", "Sandbox GOTM Game 30", and "(1/2)".
Ephemeral: yes

### Step 17: Seed a three-way tie and no NR-GOTM votes
```
/vote-sandbox seed gotm:Three-way tie nr-gotm:No votes
```
Expected: an ephemeral reply, "Seeded simulated votes", "GOTM: three-way-tie", and
"NR-GOTM: no-votes".
Ephemeral: yes

### Step 18: Close voting into a runoff
```
/vote-sandbox close
```
Expected: an ephemeral reply, "Closed voting.", "runoff_opened", and
"In the runoff: Sandbox GOTM Game 1, Sandbox GOTM Game 2, Sandbox GOTM Game 3".
A GOTM runoff panel posts in announcements; no NR-GOTM runoff panel and no tie prompt.
Ephemeral: yes

### Step 19: Seed a runoff that ties again
```
/vote-sandbox seed gotm:Two-way tie
```
Expected: an ephemeral reply, "Seeded simulated runoff votes" and "GOTM: two-way-tie".
Ephemeral: yes

### Step 20: Close the runoff into a tie
```
/vote-sandbox close
```
Expected: an ephemeral reply, "Closed the runoff.", "runoff_closed", "tie_pending", and
"Tie pending: Sandbox GOTM Game 1, Sandbox GOTM Game 2". The runoff results in
announcements say the GOTM runoff "also ended in a tie", and a tie prompt headed
"runoff did not break the tie" posts in the admin channel for GOTM only.
Ephemeral: yes

### Step 21: Break the tie with joint winners
```
select "Sandbox GOTM Game 1" and "Sandbox GOTM Game 2" on the Round 999 tie prompt in the admin channel (the last link in step 20's reply)
```
Expected: in the admin channel the tie prompt changes in place to GOTM tie broken, naming
the GOTM joint winners, and a Sandbox Round 999 decided summary posts. In announcements,
under a TEST MODE banner, both games are announced as the GOTM winners. You also get a
private reply, which the conductor reads: "Sandbox tie broken", "Winner announced:",
"round_decided", and "Posted:".
Ephemeral: yes

### Step 22: Show the decided round
```
/vote-sandbox status
```
Expected: an ephemeral reply, "decided",
"Winner(s): Sandbox GOTM Game 1, Sandbox GOTM Game 2", and "Queued events: none."
Ephemeral: yes

### Step 23: Start a sandbox from a real round's nominations
```
/vote-sandbox start source-round:100
```
Expected: an ephemeral reply, "Started sandbox" and
"Nominations copied (read only) from Round 100". Nothing is written to Round 100.
Ephemeral: yes

### Step 24: Open voting on the copied round
```
/vote-sandbox open
```
Expected: an ephemeral reply, "voting_opened" and "delivered". The panels list Round
100's nominations, or fixture games for a category it had none for.
Ephemeral: yes

### Step 25: End the sandbox
```
/vote-sandbox end
```
Expected: an ephemeral reply,
"Ended your voting sandbox. Its panels and tie prompts now refuse input."
Ephemeral: yes

### Step 26: Use a panel from the ended sandbox
```
click "Results" on the GOTM sandbox panel from step 24
```
Expected: an ephemeral error, "Could not load the results" and
"belongs to a voting sandbox that has ended or been restarted".
Ephemeral: yes

### Step 27: End the sandbox again
```
/vote-sandbox end
```
Expected: an ephemeral reply, "You have no voting sandbox to end."
Ephemeral: yes
