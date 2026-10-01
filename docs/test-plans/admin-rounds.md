# /admin rounds test plan

A pass over the `/admin` round commands: `add-gotm`, `add-nr-gotm`, `edit-gotm`, and
`edit-nr-gotm`, with the button prompts and typed replies their guided flows ask for. It
is one of four `/admin` plans; the others are `admin-help.md`, `admin-voting.md`, and
`admin-nominations.md`.

It never creates or edits a real round. Every flow is walked up to a prompt and then
ended by a Cancel button, a typed `cancel`, or a value the bot rejects, so no GOTM or
NR-GOTM data changes and every step is safe to repeat. The prompts and their answers
are public messages in the channel; delete your typed answers by hand afterwards if you
like.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Run it in #dev as a member with the Administrator permission in the test guild (the
guild owner works). Steps whose code block reads `type "..." in the channel` are a plain
chat message, not a command: send exactly that text in the same channel, within two
minutes of the prompt. GOTM round 1 and NR-GOTM round 1 must exist, and GOTM round 1
must hold more than one game (step 18 checks this); if it holds one, use a GOTM round
that holds several in steps 18 to 25 instead.

## Testing

### Step 1: Start adding a GOTM round
```
/admin add-gotm
```
Expected: an ephemeral reply, "Preparing to create GOTM round", naming the next round
number, then (by eye) a public prompt that mentions you and asks for the month/year
label.
Ephemeral: yes

### Step 2: Cancel at the month label prompt
```
type "cancel" in the channel
```
Expected: a public reply, "Edit cancelled.", and no round is created.
Ephemeral: no

### Step 3: Start adding a GOTM round again
```
/admin add-gotm
```
Expected: an ephemeral reply, "Preparing to create GOTM round".
Ephemeral: yes

### Step 4: Enter a month label
```
type "Conductor Test 2099" in the channel
```
Expected: a public prompt, "How many games are in this GOTM round?", with button:
"1", button: "5", and button: "Cancel".
Ephemeral: no

### Step 5: Cancel at the game count prompt
```
click "Cancel"
```
Expected: a public reply, "Cancelled.", and the count buttons are removed from the
prompt.
Ephemeral: no

### Step 6: Start adding a GOTM round a third time
```
/admin add-gotm
```
Expected: an ephemeral reply, "Preparing to create GOTM round".
Ephemeral: yes

### Step 7: Enter the month label again
```
type "Conductor Test 2099" in the channel
```
Expected: a public prompt, "How many games are in this GOTM round?", with button: "1".
Ephemeral: no

### Step 8: Pick one game
```
click "1"
```
Expected: a public prompt, "Enter the GameDB id for game #1", with
"use /gamedb add first if needed".
Ephemeral: no

### Step 9: Enter a GameDB id that is not a number
```
type "abc" in the channel
```
Expected: a public reply, "Invalid GameDB id. Creation cancelled.", and no round is
created.
Ephemeral: no

### Step 10: Start adding an NR-GOTM round
```
/admin add-nr-gotm
```
Expected: an ephemeral reply, "Preparing to create NR-GOTM round", then (by eye) a
public prompt for the NR-GOTM month/year label.
Ephemeral: yes

### Step 11: Enter an NR-GOTM month label
```
type "Conductor Test 2099" in the channel
```
Expected: a public prompt, "How many games are in this NR-GOTM round?", with button:
"1".
Ephemeral: no

### Step 12: Pick one NR-GOTM game
```
click "1"
```
Expected: a public prompt, "Enter the GameDB id for NR-GOTM game #1".
Ephemeral: no

### Step 13: Enter a GameDB id that does not exist
```
type "999999999" in the channel
```
Expected: a public reply, "GameDB id 999999999 not found. Use /gamedb add first.", and
no round is created.
Ephemeral: no

### Step 14: Edit a GOTM round that does not exist
```
/admin edit-gotm round:99999
```
Expected: an ephemeral reply, "No GOTM entry found for round 99999."
Ephemeral: yes

### Step 15: Edit an NR-GOTM round that does not exist
```
/admin edit-nr-gotm round:99999
```
Expected: an ephemeral reply, "No NR-GOTM entry found for round 99999."
Ephemeral: yes

### Step 16: Open NR-GOTM round 1 for editing
```
/admin edit-nr-gotm round:1
```
Expected: an ephemeral reply, "Editing NR-GOTM round 1.", with the round's entry. Check
by eye that a public prompt follows with a Cancel button, asking which game number or
which field to edit.
Ephemeral: yes

### Step 17: Cancel the NR-GOTM edit
```
click "Cancel"
```
Expected: a public reply, "Cancelled.", and round 1 is unchanged.
Ephemeral: no

### Step 18: Open GOTM round 1 for editing
```
/admin edit-gotm round:1
```
Expected: an ephemeral reply, "Editing GOTM round 1.", with the round's entry. Check by
eye that it lists more than one game and that a public prompt follows asking which game
number to edit, with number buttons and Cancel.
Ephemeral: yes

### Step 19: Pick the first game
```
click "1"
```
Expected: a public prompt, "Which field do you want to edit?", with button:
"GameDB", button: "Reddit", and button: "Cancel".
Ephemeral: no

### Step 20: Pick the GameDB field
```
click "GameDB"
```
Expected: a public prompt, "Enter the new value for gamedb (GameDB id required)."
Ephemeral: no

### Step 21: Enter a GameDB id that is not a number
```
type "abc" in the channel
```
Expected: a public reply, "Please provide a valid numeric GameDB id.", and round 1 is
unchanged.
Ephemeral: no

### Step 22: Open GOTM round 1 for editing again
```
/admin edit-gotm round:1
```
Expected: an ephemeral reply, "Editing GOTM round 1.", then (by eye) the public game
number prompt.
Ephemeral: yes

### Step 23: Pick the first game again
```
click "1"
```
Expected: a public prompt, "Which field do you want to edit?", with button: "Reddit".
Ephemeral: no

### Step 24: Pick the Reddit field
```
click "Reddit"
```
Expected: a public prompt, "Enter the new value for reddit", with "to clear it".
Ephemeral: no

### Step 25: Cancel at the value prompt
```
type "cancel" in the channel
```
Expected: a public reply, "Edit cancelled.", and not: "updated successfully".
Ephemeral: no
