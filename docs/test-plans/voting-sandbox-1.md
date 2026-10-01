# Voting sandbox test plan, part 1

A walk through a whole sandboxed GOTM / NR-GOTM voting round with `/vote-sandbox`: the
no-sandbox errors, `start`, `status`, `remind`, `open`, `seed`, `close`, `event`, and
`end`, the vote panel's game buttons, My Votes and Results controls, and a tie settled by
a member runoff. Part 2 (`voting-sandbox-2.md`) covers the start options, joint winners, the
refusals, and ended sandboxes.

It changes no real club data. The sandbox round, its nominations, votes and winners live
in one wizard session row for you, and nothing is written to a real voting round. It does
post in the test guild: nomination reminders in both nomination channels, the vote panels,
the runoff panel and the results in the announcements channel, and a "Sandbox Round 999
decided" summary in the admin channel. Deciding the round also creates a "Round 1000 Vote"
scheduled event in the test guild. The last step ends the sandbox.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it:

- The bot must run in test mode; `/vote-sandbox` only exists in the test guild.
- Run it as an admin (Administrator permission) who also has the test guild's Members
  role, which the panels enforce as the live ones do.
- Step 1 ends any sandbox you already have, so nothing needs to be cleared first.
- The sandbox nominates real GameDB games: past GOTM and NR-GOTM winners, earliest round
  first, so the same titles come back on every run. Step 5's reply lists them under
  "Nominations, in panel order", numbered. The steps below name a game by that number
  ("GOTM game 1" is the first GOTM title in the list); read its title from step 5's reply
  before clicking it.

## Testing

### Step 1: Clear any earlier sandbox
```
/vote-sandbox end
```
Expected: an ephemeral reply about your "voting sandbox", either ended or that you have
none, and not: "Could not end the voting sandbox".
Ephemeral: yes

### Step 2: Show the status with no sandbox
```
/vote-sandbox status
```
Expected: an ephemeral reply, "You have no voting sandbox. Run /vote-sandbox start."
Ephemeral: yes

### Step 3: Open voting with no sandbox
```
/vote-sandbox open
```
Expected: an ephemeral error, "Could not open sandbox voting" and
"You have no voting sandbox".
Ephemeral: yes

### Step 4: Deliver events with no sandbox
```
/vote-sandbox deliver
```
Expected: an ephemeral error, "Could not deliver the sandbox events" and
"You have no voting sandbox".
Ephemeral: yes

### Step 5: Start a sandbox with the defaults
```
/vote-sandbox start
```
Expected: an ephemeral reply, "Started sandbox",
"Nominations are past GOTM and NR-GOTM winners, earliest round first.", "Round 999",
"vote cap 2", "Queued events: none.", and "Nominations, in panel order" listing four
numbered GOTM and four numbered NR-GOTM titles, with not: "Sandbox GOTM Game".
Ephemeral: yes

### Step 6: Show the status
```
/vote-sandbox status
```
Expected: an ephemeral reply, "Voting sandbox", "Round 999", "nominating",
"4 votable game(s)", and "Queued events: none."
Ephemeral: yes

### Step 7: Seed votes before voting opens
```
/vote-sandbox seed gotm:Clear winner
```
Expected: an ephemeral error, "Could not seed the sandbox votes" and
"Seeding needs open voting; sandbox Round 999 is nominating."
Ephemeral: yes

### Step 8: Seed with no outcome
```
/vote-sandbox seed
```
Expected: an ephemeral error, "Pick an outcome for gotm, nr-gotm, or both."
Ephemeral: yes

### Step 9: Close voting before it opens
```
/vote-sandbox close
```
Expected: an ephemeral error, "Could not close sandbox voting" and
"only open voting can close."
Ephemeral: yes

### Step 10: Post the five-day nomination reminder
```
/vote-sandbox remind which:Five days out
```
Expected: an ephemeral reply, "Queued the five-day nomination reminder.",
"nomination_reminder_5d", "delivered", and "Queued events: none." The reminder,
headed "Round 999 nominations are open", posts in both nomination channels.
Ephemeral: yes

### Step 11: Open voting
```
/vote-sandbox open
```
Expected: an ephemeral reply, "Opened voting.",
"The panels post in the announcements channel.", "voting_opened", "delivered", and
"Queued events: none." A GOTM and an NR-GOTM
panel, each with the VOTING SANDBOX banner, post in the announcements channel.
Ephemeral: yes

### Step 12: Vote for a game
```
click GOTM game 1 (the first GOTM title in step 5's reply) on the GOTM sandbox panel in the announcements channel
```
Expected: an ephemeral reply, "Vote recorded for" naming GOTM game 1, and
"Your GOTM votes for Round 999 (1/2)".
Ephemeral: yes

### Step 13: Take the vote back
```
click GOTM game 1 on the GOTM sandbox panel again
```
Expected: an ephemeral reply, "Removed your vote for" naming GOTM game 1, and
"You have not voted yet."
Ephemeral: yes

### Step 14: Vote for a second game
```
click GOTM game 2 (the second GOTM title in step 5's reply) on the GOTM sandbox panel
```
Expected: an ephemeral reply, "Vote recorded for" naming GOTM game 2, and "(1/2)".
Ephemeral: yes

### Step 15: Vote up to the cap
```
click GOTM game 3 (the third GOTM title in step 5's reply) on the GOTM sandbox panel
```
Expected: an ephemeral reply, "Vote recorded for" naming GOTM game 3, and "(2/2)".
Ephemeral: yes

### Step 16: Vote past the cap
```
click GOTM game 4 (the fourth GOTM title in step 5's reply) on the GOTM sandbox panel
```
Expected: an ephemeral reply, "Vote recorded for" naming GOTM game 4, and
"You were at the vote cap (2), so your oldest vote", naming GOTM game 2, "was removed."
Ephemeral: yes

### Step 17: Check your NR-GOTM votes
```
click "My Votes" on the NR-GOTM sandbox panel
```
Expected: an ephemeral reply, "Your NR-GOTM votes for Round 999 (0/2)" and
"You have not voted yet."
Ephemeral: yes

### Step 18: Check the results while voting is open
```
click "Results" on the GOTM sandbox panel
```
Expected: an ephemeral reply, "GOTM Results - Round 999",
"Results are hidden while voting is open." and "cast so far."
Ephemeral: yes

### Step 19: Fire a stale nomination reminder
```
/vote-sandbox event kind:nomination_reminder_5d
```
Expected: an ephemeral reply, "without changing the round", "nomination_reminder_5d",
and "skipped". Nothing posts in the nomination channels, since nominations are closed.
Ephemeral: yes

### Step 20: Seed a GOTM winner and an NR-GOTM tie
```
/vote-sandbox seed gotm:Clear winner nr-gotm:Two-way tie
```
Expected: an ephemeral reply, "Seeded simulated votes", "GOTM: winner",
"NR-GOTM: two-way-tie", and ": 3" beside GOTM game 1, the seeded winner.
Ephemeral: yes

### Step 21: Close voting
```
/vote-sandbox close
```
Expected: an ephemeral reply, "Closed voting.", "voting_closed", "runoff_opened",
"Winner(s):" naming GOTM game 1, and
"In the runoff:" naming NR-GOTM games 1 and 2. The results post with the
TEST MODE banner in announcements, the GOTM winner with its GameDB cover, followed by an NR-GOTM runoff panel. No tie prompt
posts in the admin channel.
Ephemeral: yes

### Step 22: Check the revealed results
```
click "Results" on the GOTM sandbox panel
```
Expected: an ephemeral reply, "GOTM Results - Round 999" with GOTM game 1 on top, and
"Each member could vote for up to 2 games."
Ephemeral: yes

### Step 23: Old voting panel refuses a vote once the runoff is open
```
click NR-GOTM game 3 (the third NR-GOTM title in step 5's reply) on the OLD "NR-GOTM Vote - Round 999" panel in the announcements channel, not the runoff panel (the second link in step 11's reply, and the only NR-GOTM panel that still lists game 3)
```
Expected: this vote is meant to be refused. Step 21 closed the main vote and opened a
runoff, so the old panel points you to the runoff instead. An ephemeral reply,
"Voting for Round 999 has closed" and "Vote in the runoff".
Ephemeral: yes

### Step 24: Vote in the NR-GOTM runoff
```
click NR-GOTM game 2 (the second NR-GOTM title in step 5's reply) on the NEW "NR-GOTM Runoff - Round 999" panel in the announcements channel, which lists only games 1 and 2 (the last link in step 21's reply)
```
Expected: this vote is meant to land; step 26 needs it to pick game 2 as the winner. An
ephemeral reply, "Vote recorded for" naming NR-GOTM game 2, and
"NR-GOTM runoff votes for Round 999 (1/1)".
Ephemeral: yes

### Step 25: Check the hidden runoff results
```
click "Results" on the "NR-GOTM Runoff - Round 999" panel in the announcements channel (the last link in step 21's reply)
```
Expected: an ephemeral reply, "NR-GOTM runoff Results - Round 999",
"Results are hidden while voting is open", and "cast so far."
Ephemeral: yes

### Step 26: Close the runoff
```
/vote-sandbox close
```
Expected: an ephemeral reply, "Closed the runoff.", "runoff_closed", "round_decided", and
"Winner(s):" naming NR-GOTM game 2. The runoff results post with the TEST MODE banner in
announcements, naming NR-GOTM game 2 as the NR-GOTM winner with its GameDB cover, and a
"Sandbox Round 999 decided" summary posts in the admin channel.
Ephemeral: yes

### Step 27: Show the decided round
```
/vote-sandbox status
```
Expected: an ephemeral reply, "decided", "Winner(s):" naming GOTM game 1 and then
NR-GOTM game 2, and "Queued events: none."
Ephemeral: yes

### Step 28: End the sandbox
```
/vote-sandbox end
```
Expected: an ephemeral reply,
"Ended your voting sandbox. Its panels and tie prompts now refuse input."
Ephemeral: yes
