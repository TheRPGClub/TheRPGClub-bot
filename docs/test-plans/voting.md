# Voting test plan

A pass over the live voting commands: `/vote` and `/generate-vote-image`, for both GOTM
and NR-GOTM. The vote panel's select, My Votes and Results buttons are shared with the
voting sandbox, and are covered by `voting-sandbox-1.md` and `voting-sandbox-2.md`, which
never touch a real round.

It only reads real data. `/vote` is run while voting is closed, so no real vote is cast,
and `/generate-vote-image` posts a collage of the current round's nominations in the
channel it runs in, without saving anything.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it:

- Run it as an admin (Administrator permission) who has the test guild's Members role.
  `/vote` refuses members without that role before it checks the round.
- The current round must be in its nominating phase, not voting. If voting is open,
  `/vote` shows the live panel instead, and a pick there casts a real vote.
- The current round must hold at least one GOTM and one NR-GOTM nomination, each with
  cover art in GameDB.

## Testing

### Step 1: Try to vote on GOTM while voting is closed
```
/vote type:GOTM
```
Expected: an ephemeral reply, "Voting is not open right now." and
"The next vote is scheduled for", and not: "Could not load the voting panel".
Ephemeral: yes

### Step 2: Try to vote on NR-GOTM while voting is closed
```
/vote type:NR-GOTM
```
Expected: an ephemeral reply, "Voting is not open right now." and
"The next vote is scheduled for".
Ephemeral: yes

### Step 3: Generate a vote image for an invalid round
```
/generate-vote-image vote_type:GOTM round:0
```
Expected: a public error, "No upcoming nomination round could be resolved".
Ephemeral: no

### Step 4: Generate a vote image for a round with no nominations
```
/generate-vote-image vote_type:GOTM round:99999
```
Expected: a public error, "No nominations found for [GOTM] Round 99999."
Ephemeral: no

### Step 5: Generate the GOTM vote image for the current round
```
/generate-vote-image vote_type:GOTM
```
Expected: a public reply, "Generated [GOTM] Round" and "nominations.", with a collage
image attached, and not: "missing cover art blobs".
Ephemeral: no

### Step 6: Generate the NR-GOTM vote image for the current round
```
/generate-vote-image vote_type:NR-GOTM
```
Expected: a public reply, "Generated [NR-GOTM] Round" with a collage image attached, and
not: "Image generation failed".
Ephemeral: no
