# /admin rounds test plan

A pass over the `/admin` round commands: `add-gotm`, `add-nr-gotm`, `edit-gotm`, and
`edit-nr-gotm`, with the buttons and forms their flows use. It is one of four `/admin`
plans; the others are `admin-help.md`, `admin-voting.md`, and `admin-nominations.md`.

It never creates or edits a real round. Every form is submitted unchanged or with a value
the bot rejects, so no GOTM or NR-GOTM data changes and every step is safe to repeat.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Run it in #dev as a member with the Administrator permission in the test guild (the
guild owner works). The slash commands reply privately, because `/admin` defers
ephemerally; a submitted form replies publicly. GOTM round 1 must exist. NR-GOTM started
much later than GOTM, so NR-GOTM round 1 does not exist; the NR-GOTM steps use the add
flow and a round that is never real (99999) instead of a specific round.

## Testing

### Step 1: Start adding a GOTM round
```
/admin add-gotm
```
Expected: a private reply, "Ready to create GOTM round", naming the next round number,
with button: "Create GOTM round".
Ephemeral: yes
Changes data: no

### Step 2: Submit the GOTM form with a GameDB id that is not a number
```
click "Create GOTM round", enter "Conductor Test 2099" in "Month/year label", enter "abc" in "GameDB ids, one per line (1 to 5)", submit
```
Expected: a public reply, "was not created", "is not a valid GameDB id", and not:
"Created GOTM round".
Ephemeral: no
Changes data: no

### Step 3: Start adding an NR-GOTM round
```
/admin add-nr-gotm
```
Expected: a private reply, "Ready to create NR-GOTM round", with button:
"Create NR-GOTM round".
Ephemeral: yes
Changes data: no

### Step 4: Submit the NR-GOTM form with too many games
```
click "Create NR-GOTM round", enter "Conductor Test 2099" in "Month/year label", enter "1 2 3 4 5 6" in "GameDB ids, one per line (1 to 5)", submit
```
Expected: a public reply, "enter between 1 and 5 GameDB ids (got 6)", and not:
"Created NR-GOTM round".
Ephemeral: no
Changes data: no

### Step 5: Edit a GOTM round that does not exist
```
/admin edit-gotm round:99999
```
Expected: a private reply, "No GOTM entry found for round 99999."
Ephemeral: yes
Changes data: no

### Step 6: Edit an NR-GOTM round that does not exist
```
/admin edit-nr-gotm round:99999
```
Expected: a private reply, "No NR-GOTM entry found for round 99999."
Ephemeral: yes
Changes data: no

### Step 7: Open GOTM round 1 for editing
```
/admin edit-gotm round:1
```
Expected: a private reply, "Editing GOTM round 1", with the round's entry and
button: "Edit game #1".
Ephemeral: yes
Changes data: no

### Step 8: Submit the edit form unchanged
```
click "Edit game #1", submit
```
Expected: a public reply, "No changes made to GOTM round 1", and not: "updated
successfully".
Ephemeral: no
Changes data: no

### Step 9: Submit the edit form with a GameDB id that is not a number
```
click "Edit game #1", enter "abc" in "GameDB id", submit
```
Expected: a public reply, "was not updated", "is not a valid GameDB id", and not:
"updated successfully".
Ephemeral: no
Changes data: no
