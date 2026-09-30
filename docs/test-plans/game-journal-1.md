# game-journal test plan, part 1: journals from Now Playing

A full pass over the Game Journal flows reached from a Now Playing list: the Journal
button, the first-entry journal post, the owner manage row (Add Entry, Edit Entry, Delete
Entry), the View Game Journals picker, entry paging, and the delete help and confirm
screens. The `/game-journal` command itself is in parts 2 and 3.

It runs against real data: it adds Chrono Trigger to your Now Playing list, writes, edits,
and deletes two journal entries, and removes Chrono Trigger again at the end.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Preconditions: any member can run it. Your Now Playing list must have fewer than 10 titles
and must not hold Chrono Trigger, and you must have no Chrono Trigger journal entries.

## Testing

### Step 1: Add Chrono Trigger to Now Playing
```
/now-playing add title:Chrono Trigger platform:SNES
```
Expected: pick both values from autocomplete. Your public list is reposted with
"Chrono Trigger", button: "Mark Complete" and button: "Journal".
Ephemeral: no

### Step 2: Open the Journal picker
```
click "Journal"
```
Expected: an ephemeral picker, "Select a game to write an entry for.", with
option: "Chrono Trigger".
Ephemeral: yes

### Step 3: Write the first entry
```
click "Chrono Trigger" in "Select a game to journal"
enter "Conductor journal one" in "Title (optional)", enter "First test entry." in "Entry", submit
```
Expected: picking the option opens the entry form. A public journal post,
"Game Journal" for "Chrono Trigger", with "Conductor journal one", "First test entry." and
"1 entry". An ephemeral manage row follows it with Add Entry, Edit Entry, and Delete Entry.
Ephemeral: no

### Step 4: Add a second entry from the manage row
```
click "Add Entry"
enter "Conductor journal two" in "Title (optional)", enter "Second test entry." in "Entry", submit
```
Expected: a new ephemeral manage row with button: "Add Entry", button: "Edit Entry", and
button: "Delete Entry". Check by eye that the public journal post now reads 2 entries.
Ephemeral: yes

### Step 5: Edit the newest entry
```
click "Edit Entry", enter "Conductor journal two edited" in "Title (optional)", submit
```
Expected: the edit form opens prefilled with the newest entry. After submit, a new
ephemeral manage row with button: "Edit Entry" and button: "Delete Entry".
Ephemeral: yes

### Step 6: Show your list with the journal picker
```
/now-playing list
```
Expected: your public list, "Now Playing", with a View Game Journals picker,
option: "Chrono Trigger Game Journal", and button: "Journal".
Ephemeral: no

### Step 7: Open the journal from the picker
```
select "Chrono Trigger Game Journal" from "View Game Journals"
```
Expected: a public journal post, the "Game Journal" for "Chrono Trigger", showing
"Conductor journal two edited", "Second test entry.", "2 entries", and
button: "Previous Entry".
Ephemeral: no

### Step 8: Page to the older entry
```
click "Previous Entry"
```
Expected: a public journal post replaces the last one, showing "Conductor journal one"
and button: "Next Entry".
Ephemeral: no

### Step 9: Page back to the newest entry
```
click "Next Entry"
```
Expected: a public journal post showing "Conductor journal two edited" and
button: "Previous Entry".
Ephemeral: no

### Step 10: Open the owner manage row from the journal header
```
click your name in the header of the journal post from step 9
```
Expected: an ephemeral manage row with button: "Add Entry", button: "Edit Entry", and
button: "Delete Entry".
Ephemeral: yes

### Step 11: Open Delete Entry
```
click "Delete Entry"
```
Expected: the manage row changes to "Delete Journal Entry" with
"Select an entry to delete.", option: "Conductor journal two edited", and
option: "Conductor journal one".
Ephemeral: yes

### Step 12: Open the delete help
```
click "?"
```
Expected: a new ephemeral reply, "Delete Journal Entry - Help", with
"Deleted entries cannot be recovered.".
Ephemeral: yes

### Step 13: Pick the older entry
```
select "Conductor journal one"
```
Expected: the message changes to "Confirm Delete" naming "Conductor journal one", with
button: "Delete" and button: "Cancel".
Ephemeral: yes

### Step 14: Open the confirm help
```
click "?"
```
Expected: a new ephemeral reply, "Confirm Delete - Help".
Ephemeral: yes

### Step 15: Cancel the delete
```
click "Cancel"
```
Expected: the message changes to "Delete cancelled. Nothing was deleted." with
button: "Add Entry" and button: "Delete Entry".
Ephemeral: yes

### Step 16: Open Delete Entry again
```
click "Delete Entry"
```
Expected: the message changes to "Delete Journal Entry" with
option: "Conductor journal one".
Ephemeral: yes

### Step 17: Pick the older entry again
```
select "Conductor journal one"
```
Expected: the message changes to "Confirm Delete" naming "Conductor journal one".
Ephemeral: yes

### Step 18: Confirm the delete
```
click "Delete"
```
Expected: the message changes to a status line, "Deleted", naming
"Conductor journal one", with button: "Delete Entry".
Ephemeral: yes

### Step 19: Open Delete Entry for the last entry
```
click "Delete Entry"
```
Expected: the message changes to "Delete Journal Entry" with
option: "Conductor journal two edited" and not: "Conductor journal one".
Ephemeral: yes

### Step 20: Pick the last entry
```
select "Conductor journal two edited"
```
Expected: the message changes to "Confirm Delete" naming "Conductor journal two edited".
Ephemeral: yes

### Step 21: Delete the last entry
```
click "Delete"
```
Expected: the message changes to "Deleted" naming "Conductor journal two edited", with
button: "Add Entry". Check by eye that Edit Entry and Delete Entry are now disabled.
Ephemeral: yes

### Step 22: Open the Now Playing manage menu
```
click your name on the list from step 6
```
Expected: an ephemeral manage row with button: "Remove Game".
Ephemeral: yes

### Step 23: Open Remove Game
```
click "Remove Game"
```
Expected: the manage message changes to "Now Playing Remove" with
"Select a game below to remove it from your list." and "Chrono Trigger".
Ephemeral: yes

### Step 24: Remove Chrono Trigger
```
select "Chrono Trigger (SNES)"
```
Expected: the remove screen updates in place with
"Select a game below to remove it from your list." Check by eye that Chrono Trigger is gone.
Ephemeral: yes

### Step 25: Confirm the final list
```
/now-playing list
```
Expected: your public list, "Now Playing", with not: "Chrono Trigger".
Ephemeral: no
