# /backlog test plan, part 2: list, filter, start playing

A full pass over `/backlog list`, its Filter panel (Edit Title, Apply, Clear, Cancel) on
both a public and a private list, and the start playing picker under the list. Add, edit,
and remove are in `backlog-1.md`. It runs against real data: it adds Chrono Trigger and
Final Fantasy VI to your backlog, moves Chrono Trigger to your Now Playing list, then
removes it from Now Playing and removes Final Fantasy VI from your backlog.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Any member can run it; no admin or owner role is needed. Before running it, make sure your
backlog holds neither Chrono Trigger nor Final Fantasy VI, and your Now Playing list has
fewer than 10 titles and does not hold Chrono Trigger. The Filter panel and the start
playing replies are ephemeral; Apply and Clear edit the list message they came from.

## Testing

### Step 1: Add Chrono Trigger with a platform
```
/backlog add title:Chrono Trigger platform:SNES note:Conductor backlog test
```
Expected: pick the title and platform from autocomplete. An ephemeral reply, "Added" and
"Chrono Trigger" and "to your backlog."
Ephemeral: yes

### Step 2: Add Final Fantasy VI with no platform
```
/backlog add title:Final Fantasy VI
```
Expected: pick the title from autocomplete. An ephemeral reply, "Added" and
"Final Fantasy VI" and "to your backlog."
Ephemeral: yes

### Step 3: Show your backlog privately
```
/backlog list private:true
```
Expected: an ephemeral list, title: "Game Backlog", with "total entries", button: "Filter",
and a picker with the placeholder Start playing a game from this page.
Ephemeral: yes

### Step 4: Open the Filter panel on the private list
```
click "Filter"
```
Expected: a new ephemeral panel, "Filter backlog" and "Title: (any)", with
button: "Edit Title", button: "Apply", button: "Clear", and button: "Cancel".
Ephemeral: yes

### Step 5: Set a title filter
```
click "Edit Title", enter "Final Fantasy VI" in "Title contains", submit
```
Expected: the panel changes to "Filter backlog" and "Title: Final Fantasy VI".
Ephemeral: yes

### Step 6: Apply the filter to the private list
```
click "Apply"
```
Expected: the private list from step 3 changes in place to "Filter: title~Final Fantasy VI"
with "Final Fantasy VI", and not: "Could not apply filter". The panel goes away.
Ephemeral: yes

### Step 7: Show Chrono Trigger publicly
```
/backlog list title:Chrono Trigger
```
Expected: a public list, title: "Game Backlog", with "Chrono Trigger",
"Filter: title~Chrono Trigger", and button: "Filter".
Ephemeral: no

### Step 8: Open the Filter panel on the public list
```
click "Filter"
```
Expected: an ephemeral panel, "Filter backlog", carrying the list's filter,
"Title: Chrono Trigger".
Ephemeral: yes

### Step 9: Clear the filter
```
click "Clear"
```
Expected: the public list from step 7 changes in place to the whole backlog, with
"Game Backlog", "Final Fantasy VI", and not: "Filter: title~". The panel goes away.
Ephemeral: no

### Step 10: Open the Filter panel again
```
click "Filter"
```
Expected: an ephemeral panel, "Filter backlog" and "Title: (any)".
Ephemeral: yes

### Step 11: Set a title filter on the public list
```
click "Edit Title", enter "Final Fantasy VI" in "Title contains", submit
```
Expected: the panel changes to "Title: Final Fantasy VI".
Ephemeral: yes

### Step 12: Apply the filter to the public list
```
click "Apply"
```
Expected: the public list changes in place to "Filter: title~Final Fantasy VI" with
"Final Fantasy VI" and not: "Chrono Trigger". The panel goes away.
Ephemeral: no

### Step 13: Open the Filter panel to cancel it
```
click "Filter"
```
Expected: an ephemeral panel, "Filter backlog" and "Title: Final Fantasy VI".
Ephemeral: yes

### Step 14: Cancel the Filter panel
```
click "Cancel"
```
Expected: the panel goes away and the public list is unchanged, still showing
"Filter: title~Final Fantasy VI", and not: "Could not apply filter".
Ephemeral: no

### Step 15: Start playing a game that has no platform
```
select "Final Fantasy VI" in "Start playing a game from this page"
```
Expected: use the picker on the public list from step 12. An ephemeral reply,
"Select the platform for" and "Final Fantasy VI", with a platform picker. Leave it alone.
Ephemeral: yes

### Step 16: Show Chrono Trigger publicly again
```
/backlog list title:Chrono Trigger
```
Expected: a public list, title: "Game Backlog", with "Chrono Trigger".
Ephemeral: no

### Step 17: Start playing Chrono Trigger
```
select "Chrono Trigger" in "Start playing a game from this page"
```
Expected: use the picker on the list from step 16. An ephemeral reply, "Added" and
"Chrono Trigger" and "to your Now Playing list.", and not: "Failed to add to Now Playing".
Ephemeral: yes

### Step 18: Check Chrono Trigger left the backlog
```
/backlog list title:Chrono Trigger
```
Expected: a public reply, "No backlog entries matched your filter."
Ephemeral: no

### Step 19: Check Chrono Trigger is on Now Playing
```
/now-playing list
```
Expected: your public list, "Now Playing", with "Chrono Trigger".
Ephemeral: no

### Step 20: Open the Now Playing manage menu
```
click your name in the header of the list from step 19
```
Expected: an ephemeral manage row with button: "Remove Game".
Ephemeral: yes

### Step 21: Open Remove Game
```
click "Remove Game"
```
Expected: the manage message changes to "Now Playing Remove" with
"Select a game below to remove it from your list." and "Chrono Trigger".
Ephemeral: yes

### Step 22: Remove Chrono Trigger from Now Playing
```
select "Chrono Trigger (SNES)"
```
Expected: the remove screen updates in place, "Select a game below to remove it from your
list.", and Chrono Trigger is gone from it (check by eye).
Ephemeral: yes

### Step 23: Remove Final Fantasy VI from the backlog
```
/backlog remove entry:Final Fantasy VI
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Removed" and
"Final Fantasy VI" and "from your backlog."
Ephemeral: yes

### Step 24: Check the backlog is back to where it started
```
/backlog list title:Final Fantasy VI
```
Expected: a public reply, "No backlog entries matched your filter."
Ephemeral: no
