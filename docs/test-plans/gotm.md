# GOTM nominations and rounds test plan

A full pass over `/round`, `/noms`, `/nominate`, `/nominate-delete`, and `/round-history`,
for both GOTM and NR-GOTM, and the nomination details picker and round history pages
their replies lead to.

It runs against real data. Nominations are saved to the real round the club is
nominating for, so the plan nominates Chrono Trigger, swaps it for Chrono Cross, nominates
Portal 2 for NR-GOTM, and then withdraws both with `/nominate-delete`. Each nomination and
withdrawal also posts a notice in the test guild's GOTM or NR-GOTM nomination channel. The
round commands only read data.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it:

- Any member can run it; no admin role is needed.
- Nominations must be open for the current round (the round is in its nominating phase,
  not voting). If they are closed, every `/nominate` step replies that nominations for
  the round are closed instead.
- You must not already have a GOTM or an NR-GOTM nomination for the current round. The
  plan overwrites and then deletes whatever you hold, so a real nomination would be lost.
- The 2025 round history must hold at least 11 rounds, so it spans two pages.

## Testing

### Step 1: Show the current round publicly
```
/round
```
Expected: a public reply headed with the current round number and month, with a card per
winner, "GOTM | Round", and not: "Error fetching current round information".
Ephemeral: no

### Step 2: Show the current round privately
```
/round private:true
```
Expected: the same round as step 1, visible only to you, "GOTM | Round".
Ephemeral: yes

### Step 3: Show the GOTM nominations
```
/noms type:GOTM
```
Expected: a public list, title: "GOTM Nominations - Round", with each nomination or
"No nominations yet.", and the footer "voting will open on".
Ephemeral: no

### Step 4: Show the NR-GOTM nominations privately
```
/noms type:NR-GOTM private:true
```
Expected: an ephemeral list, title: "NR-GOTM Nominations - Round", and
"Nominate a game (or edit your existing nomination) with /nominate".
Ephemeral: yes

### Step 5: Delete a GOTM nomination you do not have
```
/nominate-delete type:GOTM
```
Expected: an ephemeral error, "You have no GOTM nomination for Round", "to delete".
Ephemeral: yes

### Step 6: Nominate a title GameDB cannot match
```
/nominate title:zzqqxx type:GOTM reason:Conductor test nomination
```
Expected: an ephemeral error, "I could not find a unique GameDB match for",
"Please use the title autocomplete or add the game to GameDB first."
Ephemeral: yes

### Step 7: Nominate Chrono Trigger for GOTM
```
/nominate title:Chrono Trigger type:GOTM reason:Conductor test nomination, withdrawn later
```
Expected: pick the title from autocomplete. An ephemeral reply,
"Recorded your GOTM nomination for Round" and "Chrono Trigger", and
not: "Could not save your nomination". A notice naming Chrono Trigger posts in the GOTM
nomination channel.
Ephemeral: yes

### Step 8: Nominate Chrono Trigger again with a new reason
```
/nominate title:Chrono Trigger type:GOTM reason:Conductor test, updated reason
```
Expected: pick the title from autocomplete. An ephemeral reply,
"Updated your GOTM nomination for Round", "Chrono Trigger" and "(no change to title)".
Ephemeral: yes

### Step 9: Replace the GOTM nomination with Chrono Cross
```
/nominate title:Chrono Cross type:GOTM reason:Conductor test, swapped title
```
Expected: pick the title from autocomplete. An ephemeral reply,
"Updated your GOTM nomination for Round", "Chrono Cross" and "(replaced".
Ephemeral: yes

### Step 10: See the new nomination in the GOTM list
```
/noms type:GOTM
```
Expected: a public list, title: "GOTM Nominations - Round", with "Chrono Cross" and
"Conductor test, swapped title", and a details picker with option: "Chrono Cross".
Ephemeral: no

### Step 11: Open the nomination details
```
select "Chrono Cross" from "View a Nomination's details..." on the step 10 list
```
Expected: an ephemeral GameDB profile for "Chrono Cross", and not: "Invalid GameDB id".
Ephemeral: yes

### Step 12: Nominate Portal 2 for NR-GOTM
```
/nominate title:Portal 2 type:NR-GOTM reason:Conductor test nomination, withdrawn later
```
Expected: pick the title from autocomplete. An ephemeral reply,
"Recorded your NR-GOTM nomination for Round" and "Portal 2". A notice posts in the
NR-GOTM nomination channel.
Ephemeral: yes

### Step 13: See the NR-GOTM list
```
/noms type:NR-GOTM
```
Expected: a public list, title: "NR-GOTM Nominations - Round", with "Portal 2" and
option: "Portal 2".
Ephemeral: no

### Step 14: Withdraw the NR-GOTM nomination
```
/nominate-delete type:NR-GOTM
```
Expected: an ephemeral reply, "Deleted your NR-GOTM nomination for Round" and "Portal 2".
A withdrawal notice posts in the NR-GOTM nomination channel.
Ephemeral: yes

### Step 15: Withdraw the GOTM nomination
```
/nominate-delete type:GOTM
```
Expected: an ephemeral reply, "Deleted your GOTM nomination for Round" and "Chrono Cross".
A withdrawal notice posts in the GOTM nomination channel.
Ephemeral: yes

### Step 16: Confirm the withdrawal
```
/nominate-delete type:GOTM
```
Expected: an ephemeral error, "You have no GOTM nomination for Round", showing the
nomination from step 9 is gone.
Ephemeral: yes

### Step 17: Query all of 2025's rounds
```
/round-history
select "Both" in "Category", select "2025" in "Year", select "Ascending" in "Sort", submit
```
Expected: a public reply, title: "Round History - 2025", with
"Category: Both | Year: 2025 | Sort: ASC", "Query: (none)", "Page 1/2", and
button: "Next".
Ephemeral: no

### Step 18: Go to the next page
```
click "Next"
```
Expected: the round history message changes in place to "Page 2/2" with
"Category: Both | Year: 2025 | Sort: ASC" and button: "Previous".
Ephemeral: no

### Step 19: Go back to the first page
```
click "Previous"
```
Expected: the round history message changes in place back to "Page 1/2", with
button: "Next".
Ephemeral: no

### Step 20: Query GOTM rounds privately with a title that matches nothing
```
/round-history private:true
select "GOTM" in "Category", select "2025" in "Year",
enter "zzqqxx" in "Query (optional title match)", submit
```
Expected: an ephemeral reply, title: "Round History - 2025",
"Category: GOTM | Year: 2025 | Sort: ASC", "zzqqxx", and
"No rounds matched your filters."
Ephemeral: yes

### Step 21: Query NR-GOTM rounds in descending order
```
/round-history
select "NR-GOTM" in "Category", select "2025" in "Year", select "Descending" in "Sort", submit
```
Expected: a public reply, title: "Round History - 2025",
"Category: NR-GOTM | Year: 2025 | Sort: DESC", and "NR-GOTM | Round". Check by eye that
the highest round comes first.
Ephemeral: no
