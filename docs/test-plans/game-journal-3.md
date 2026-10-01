# game-journal test plan, part 3: the Manage Journal menu

A full pass over the Manage Journal menu that the header button of a `/game-journal`
journal view opens: its help button, Add Entry, Edit Entry, the delete cancel path, the
delete confirm, and the empty state once every entry is gone. Browsing and search are in
part 2; the Now Playing journal flows are in part 1.

It runs against real data: it adds Chrono Trigger to your Now Playing list to start a
journal, writes, edits, and deletes two entries, and removes Chrono Trigger from Now
Playing at the end.

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
"Chrono Trigger" and button: "Journal".
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
enter "Conductor manage entry" in "Title (optional)", enter "Lavos notes." in "Entry", submit
```
Expected: picking the option opens the entry form. A public journal post, the
"Game Journal" for "Chrono Trigger", with "Conductor manage entry" and "1 entry".
Ephemeral: no

### Step 4: Show your journal list
```
/game-journal
```
Expected: a public list, title: "Game Journals", with "Chrono Trigger" and "1 entry".
Ephemeral: no

### Step 5: Open the Chrono Trigger journal
```
select "Chrono Trigger" from "Select a game to read its journal"
```
Expected: the message changes in place to the "Game Journal" for "Chrono Trigger", with
"Conductor manage entry" and "1 entry".
Ephemeral: no

### Step 6: Open Manage Journal
```
click your name in the header of the journal message from step 5
```
Expected: an ephemeral reply, "Manage Journal", with button: "Add Entry",
button: "Edit Entry", button: "Delete Entry", and button: "?".
Ephemeral: yes

### Step 7: Open the Manage Journal help
```
click "?"
```
Expected: a new ephemeral help reply for the journal screen, with
not: "No help available for this screen". This fails today: the button asks for a
journal-add help text that does not exist.
Ephemeral: yes

### Step 8: Add an entry from Manage Journal
```
click "Add Entry"
enter "Conductor added entry" in "Title (optional)", enter "Epoch notes." in "Entry", submit
```
Expected: the Manage Journal message is replaced in place by "Manage Journal" with
button: "Edit Entry". Check by eye that the journal message from step 5 now reads 2 entries.
Ephemeral: yes

### Step 9: Edit the newest entry
```
click "Edit Entry", enter "Conductor edited entry" in "Title (optional)", submit
```
Expected: the form opens prefilled with Conductor added entry. After submit the message
shows "Manage Journal" again with button: "Delete Entry".
Ephemeral: yes

### Step 10: Check the edit in a fresh view
```
/game-journal
```
Expected: a public list, "Game Journals", with "Chrono Trigger" and "2 entries".
Ephemeral: no

### Step 11: Open the journal again
```
select "Chrono Trigger" from "Select a game to read its journal"
```
Expected: the message changes in place to the journal, showing "Conductor edited entry",
"Epoch notes." and "2 entries", and not: "Conductor added entry".
Ephemeral: no

### Step 12: Open Manage Journal from the fresh view
```
click your name in the header of the journal message from step 11
```
Expected: an ephemeral reply, "Manage Journal", with button: "Delete Entry".
Ephemeral: yes

### Step 13: Open Delete Entry
```
click "Delete Entry"
```
Expected: the message changes to "Delete Journal Entry", "Select an entry to delete.",
with option: "Conductor edited entry" and option: "Conductor manage entry".
Ephemeral: yes

### Step 14: Pick the first entry
```
select "Conductor manage entry"
```
Expected: the message changes to "Confirm Delete" naming "Conductor manage entry", with
button: "Delete" and button: "Cancel".
Ephemeral: yes

### Step 15: Cancel the delete
```
click "Cancel"
```
Expected: the message changes to "Manage Journal" with
"Delete cancelled. Nothing was deleted." and button: "Delete Entry".
Ephemeral: yes

### Step 16: Open Delete Entry again
```
click "Delete Entry"
```
Expected: the message changes to "Delete Journal Entry" with
option: "Conductor manage entry", so the cancel kept it.
Ephemeral: yes

### Step 17: Pick the first entry again
```
select "Conductor manage entry"
```
Expected: the message changes to "Confirm Delete" naming "Conductor manage entry".
Ephemeral: yes

### Step 18: Delete it
```
click "Delete"
```
Expected: the message changes to "Manage Journal" with "Deleted" and
"Conductor manage entry".
Ephemeral: yes

### Step 19: Open Delete Entry for the edited entry
```
click "Delete Entry"
```
Expected: the message changes to "Delete Journal Entry" with
option: "Conductor edited entry" and not: "Conductor manage entry".
Ephemeral: yes

### Step 20: Pick the edited entry
```
select "Conductor edited entry"
```
Expected: the message changes to "Confirm Delete" naming "Conductor edited entry".
Ephemeral: yes

### Step 21: Delete it
```
click "Delete"
```
Expected: the message changes to "Manage Journal" with "Deleted" and
"Conductor edited entry".
Ephemeral: yes

### Step 22: Try Delete Entry with no entries left
```
click "Delete Entry"
```
Expected: the message changes to "No journal entries to delete." with
button: "Add Entry".
Ephemeral: yes

### Step 23: Open the Now Playing manage menu
```
click your name on the list from step 1
```
Expected: an ephemeral manage row with button: "Remove Game".
Ephemeral: yes

### Step 24: Open Remove Game
```
click "Remove Game"
```
Expected: the manage message changes to "Now Playing Remove" with "Chrono Trigger".
Ephemeral: yes

### Step 25: Remove Chrono Trigger
```
select "Chrono Trigger (SNES)"
```
Expected: the remove screen updates in place with
"Select a game below to remove it from your list." Check by eye that Chrono Trigger is gone.
Ephemeral: yes
