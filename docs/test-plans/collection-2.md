# /collection test plan, part 2: list, filter, start playing

A full pass over `/collection list` and every option it takes, its Filter Results panel
(Edit Text, Ownership, Apply, Clear, Cancel) on both a public and a private list, and the
start playing picker under the list. Add, edit, and remove are in `collection-1.md`. It runs
against real data: it adds Chrono Trigger and Final Fantasy VI to your collection, moves
Chrono Trigger to Now Playing, then takes it off Now Playing and removes both entries.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Any member can run it; no admin or owner role is needed. Before running it, make sure your
collection holds neither Chrono Trigger nor Final Fantasy VI, has fewer than 19 entries so
the whole list fits on one page, and your Now Playing list has fewer than 10 titles and does
not hold Chrono Trigger. The Filter panel and start playing replies are ephemeral; Apply
edits the list message the panel was opened from.

## Testing

### Step 1: Add Chrono Trigger as a physical copy
```
/collection add title:Chrono Trigger platform:SNES ownership_type:Physical
```
Expected: pick the title and platform from autocomplete. An ephemeral reply, "Added" and
"Chrono Trigger" and "to your collection."
Ephemeral: yes

### Step 2: Add Final Fantasy VI as a digital copy
```
/collection add title:Final Fantasy VI platform:SNES ownership_type:Digital
```
Expected: pick the title and platform from autocomplete. An ephemeral reply, "Added" and
"Final Fantasy VI" and "to your collection."
Ephemeral: yes

### Step 3: List your collection publicly by title
```
/collection list title:Chrono Trigger
```
Expected: a public list, title: "Game Collection", with "Chrono Trigger",
"Filters: title~Chrono Trigger", button: "Filter Results", and a picker with the
placeholder Start playing a game from this page.
Ephemeral: no

### Step 4: List privately by platform and ownership
```
/collection list platform:SNES ownership_type:Physical private:true
```
Expected: an ephemeral list, title: "Game Collection", with "Chrono Trigger",
"platform~SNES", "ownership=Physical", and not: "Final Fantasy VI".
Ephemeral: yes

### Step 5: List another member's collection
```
/collection list member:@RPGClubbot (Preview)
```
Expected: a public reply, "No collection entries matched your filters for that member."
Ephemeral: no

### Step 6: List with a title nobody owns
```
/collection list title:zzqqxx private:true
```
Expected: an ephemeral reply, "No collection entries matched your filters."
Ephemeral: yes

### Step 7: Open the Filter panel on the public list
```
click "Filter Results"
```
Expected: use the list from step 3. A new ephemeral panel, "Filter collection results",
"Title: Chrono Trigger", "Platform: (any)", with button: "Edit Text",
button: "Ownership: Any", button: "Apply", button: "Clear", and button: "Cancel".
Ephemeral: yes

### Step 8: Cycle the ownership filter
```
click "Ownership: Any"
```
Expected: the panel changes in place to "Ownership: Digital" and button: "Ownership: Digital",
and keeps "Title: Chrono Trigger".
Ephemeral: yes

### Step 9: Cycle the ownership filter again
```
click "Ownership: Digital"
```
Expected: the panel changes in place to "Ownership: Physical" and
button: "Ownership: Physical".
Ephemeral: yes

### Step 10: Set the title and platform text
```
click "Edit Text", enter "Chrono" in "Title contains", enter "SNES" in "Platform contains", submit
```
Expected: the panel shows "Title: Chrono", "Platform: SNES", and keeps
"Ownership: Physical".
Ephemeral: yes

### Step 11: Apply the filters to the public list
```
click "Apply"
```
Expected: the public list from step 3 changes in place to "title~Chrono",
"platform~SNES", "ownership=Physical", with "Chrono Trigger" and not: "Final Fantasy VI".
The panel goes away.
Ephemeral: no

### Step 12: Open the Filter panel again
```
click "Filter Results"
```
Expected: an ephemeral panel that carries the list's filters, "Title: Chrono",
"Platform: SNES", and "Ownership: Physical".
Ephemeral: yes

### Step 13: Clear the panel
```
click "Clear"
```
Expected: the panel changes in place to "Title: (any)", "Platform: (any)", and
button: "Ownership: Any". The list is not changed yet.
Ephemeral: yes

### Step 14: Apply the cleared filters
```
click "Apply"
```
Expected: the public list changes in place to your whole collection, "Game Collection",
with "Chrono Trigger" and "Final Fantasy VI", and not: "Filters:".
Ephemeral: no

### Step 15: Open the Filter panel to cancel it
```
click "Filter Results"
```
Expected: an ephemeral panel, "Filter collection results" and "Title: (any)".
Ephemeral: yes

### Step 16: Cancel the Filter panel
```
click "Cancel"
```
Expected: the panel goes away and the public list is unchanged, with "Final Fantasy VI",
and not: "Could not update that collection message".
Ephemeral: no

### Step 17: Open the Filter panel on the private list
```
click "Filter Results"
```
Expected: use the private list from step 4. An ephemeral panel, "Platform: SNES" and
"Ownership: Physical".
Ephemeral: yes

### Step 18: Apply the filters to the private list
```
click "Apply"
```
Expected: the private list from step 4 is redrawn in place with "Chrono Trigger" and
"ownership=Physical", and not: "Could not update that collection message".
Ephemeral: yes

### Step 19: Start playing Chrono Trigger from the list
```
select "Chrono Trigger" in "Start playing a game from this page"
```
Expected: use the picker on the public list from step 14. An ephemeral reply, "Added" and
"Chrono Trigger" and "to your Now Playing list.", and not: "Failed to add to Now Playing".
Ephemeral: yes

### Step 20: Check Chrono Trigger is on Now Playing
```
/now-playing list
```
Expected: your public list, "Now Playing", with "Chrono Trigger".
Ephemeral: no

### Step 21: Open the Now Playing manage menu
```
click your name in the header of the list from step 20
```
Expected: an ephemeral manage row with button: "Remove Game".
Ephemeral: yes

### Step 22: Open Remove Game
```
click "Remove Game"
```
Expected: the manage message changes to "Now Playing Remove" with
"Select a game below to remove it from your list." and "Chrono Trigger".
Ephemeral: yes

### Step 23: Remove Chrono Trigger from Now Playing
```
select "Chrono Trigger (SNES)"
```
Expected: the remove screen updates in place, "Select a game below to remove it from your
list.", and Chrono Trigger is gone from it (check by eye).
Ephemeral: yes

### Step 24: Remove Chrono Trigger from the collection
```
/collection remove entry:Chrono Trigger
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Removed" and
"Chrono Trigger" and "from your collection."
Ephemeral: yes

### Step 25: Remove Final Fantasy VI from the collection
```
/collection remove entry:Final Fantasy VI
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Removed" and
"Final Fantasy VI" and "from your collection."
Ephemeral: yes
