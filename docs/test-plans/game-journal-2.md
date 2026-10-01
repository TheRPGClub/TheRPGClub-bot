# game-journal test plan, part 2: browsing, search, and delete

A full pass over `/game-journal` browsing and search: your own list, the `private`,
`member`, and `all` options, the member and game pickers, entry paging, `query` search
with its `game` filter and result paging, and deleting entries from the `/game-journal`
Manage Journal menu. Adding and editing from that menu is in part 3; the Now Playing
journal flows are in part 1.

It runs against real data: it adds Chrono Trigger to your Now Playing list to start a
journal, writes two entries, deletes them from `/game-journal`, and removes Chrono Trigger
from Now Playing at the end.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Preconditions: any member can run it. Your Now Playing list must have fewer than 10 titles
and must not hold Chrono Trigger, and you must have no Chrono Trigger journal entries.
No journal entry of yours may contain the word "Conductor" outside this run.

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
enter "Conductor search entry" in "Title (optional)", enter "Zeal palace notes." in "Entry", submit
```
Expected: picking the option opens the entry form. A public journal post,
"Game Journal" for "Chrono Trigger", with "Conductor search entry" and "1 entry".
Ephemeral: no

### Step 4: Add a second entry
```
click "Add Entry"
enter "Conductor second entry" in "Title (optional)", enter "Magus notes." in "Entry", submit
```
Expected: the Add Entry button is on the ephemeral manage row that followed step 3. A new
ephemeral manage row with button: "Edit Entry" and button: "Delete Entry".
Ephemeral: yes

### Step 5: Show your journal list
```
/game-journal
```
Expected: a public list, title: "Game Journals", with a header button labelled with your
name, "Chrono Trigger" and "2 entries", and a picker
Select a game to read its journal.
Ephemeral: no

### Step 6: Show your journal list privately
```
/game-journal private:true
```
Expected: the same list, visible only to you, with "Game Journals" and "Chrono Trigger".
Ephemeral: yes

### Step 7: View a member with no journals
```
/game-journal member:@RPGClubbot (Preview)
```
Expected: a public reply, "has no game journals.".
Ephemeral: no

### Step 8: View everyone who keeps journals
```
/game-journal all:true
```
Expected: a public list, "Game Journal Users", with a line for you counting your
"total" entries, and a picker Select a member to view their journals.
Ephemeral: no

### Step 9: Pick yourself from the everyone list
```
select your own name from "Select a member to view their journals"
```
Expected: the message changes in place to your list, "Game Journals", with
"Chrono Trigger". No second message is posted.
Ephemeral: no

### Step 10: Open the Chrono Trigger journal
```
select "Chrono Trigger" from "Select a game to read its journal"
```
Expected: the message changes in place to the "Game Journal" for "Chrono Trigger", showing
"Conductor second entry", "Magus notes." and "2 entries", with
button: "Previous Entry".
Ephemeral: no

### Step 11: Page to the older entry
```
click "Previous Entry"
```
Expected: the same message changes in place to "Conductor search entry" and
"Zeal palace notes.", with button: "Next Entry".
Ephemeral: no

### Step 12: Search your journal entries
```
/game-journal query:Conductor
```
Expected: a public reply, "Game Journal Search", "Query:", "Chrono Trigger",
"Result 1 of 2", and button: "Next Result".
Ephemeral: no

### Step 13: Page to the next search result
```
click "Next Result"
```
Expected: the search message changes in place to "Result 2 of 2" with
button: "Previous Result".
Ephemeral: no

### Step 14: Search inside one game
```
/game-journal query:Zeal game:Chrono Trigger
```
Expected: pick the game from autocomplete. A public reply,
"Game Journal Search" for "Chrono Trigger", with "Conductor search entry" and "Result 1 of 1".
Ephemeral: no

### Step 15: Search privately for text no entry holds
```
/game-journal query:zzqqxx private:true
```
Expected: an ephemeral reply, "No journal entries matched", and "0 results".
Ephemeral: yes

### Step 16: Open Manage Journal from the journal view
```
click your name in the header of the journal message from step 11
```
Expected: an ephemeral reply, "Manage Journal", with button: "Add Entry",
button: "Edit Entry", and button: "Delete Entry".
Ephemeral: yes

### Step 17: Open Delete Entry
```
click "Delete Entry"
```
Expected: the Manage Journal message changes to "Delete Journal Entry" with
option: "Conductor second entry" and option: "Conductor search entry".
Ephemeral: yes

### Step 18: Pick the first entry
```
select "Conductor search entry"
```
Expected: the message changes to "Confirm Delete" naming "Conductor search entry", with
button: "Delete" and button: "Cancel".
Ephemeral: yes

### Step 19: Delete it
```
click "Delete"
```
Expected: the message changes to "Manage Journal" with "Deleted" and
"Conductor search entry", and button: "Delete Entry".
Ephemeral: yes

### Step 20: Open Delete Entry for the second entry
```
click "Delete Entry"
```
Expected: the message changes to "Delete Journal Entry" with
option: "Conductor second entry" and not: "Conductor search entry".
Ephemeral: yes

### Step 21: Pick the second entry
```
select "Conductor second entry"
```
Expected: the message changes to "Confirm Delete" naming "Conductor second entry".
Ephemeral: yes

### Step 22: Delete it
```
click "Delete"
```
Expected: the message changes to "Manage Journal" with "Deleted" and
"Conductor second entry".
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
