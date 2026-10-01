# /backlog test plan, part 1: add, edit, remove

A full pass over `/backlog add`, `edit`, and `remove`, every option they take, and the error
replies for bad input. The list view, its Filter panel, and the start playing picker are in
`backlog-2.md`. It runs against real data: it adds Chrono Trigger and Final Fantasy VI to
your backlog, edits the Chrono Trigger entry, and removes both again at the end.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Any member can run it; no admin or owner role is needed. Before running it, make sure your
backlog holds neither Chrono Trigger nor Final Fantasy VI. Every reply in this plan is
ephemeral except the public list checks in steps 1, 23, and 24.

## Testing

### Step 1: Filter your backlog by a title nobody has
```
/backlog list title:zzqqxx
```
Expected: a public reply, "No backlog entries matched your filter.", and not: "Error".
Ephemeral: no

### Step 2: Add a title that GameDB and IGDB cannot find
```
/backlog add title:zzqqxxzzqqxx
```
Expected: type the title by hand, do not use autocomplete. An ephemeral error,
"Could not find that title in GameDB or IGDB."
Ephemeral: yes

### Step 3: Add a title with no exact GameDB match
```
/backlog add title:Chrono Trigge
```
Expected: type the title by hand, do not use autocomplete. An ephemeral reply,
"No exact GameDB match found for" and "Select the correct IGDB game to import:", with an
IGDB game picker. Leave the picker alone; picking a game would import it into GameDB.
Ephemeral: yes

### Step 4: Add with a platform that does not exist
```
/backlog add title:Chrono Trigger platform:zzqqxx
```
Expected: pick the title from autocomplete and type the platform by hand. An ephemeral
error, "Invalid platform selection."
Ephemeral: yes

### Step 5: Add Chrono Trigger with a platform and a note
```
/backlog add title:Chrono Trigger platform:SNES note:Conductor backlog test
```
Expected: pick the title and platform from autocomplete. An ephemeral reply,
"Added" and "Chrono Trigger" and "to your backlog.", and not: "Failed to add backlog entry".
Ephemeral: yes

### Step 6: Add Chrono Trigger again
```
/backlog add title:Chrono Trigger platform:SNES
```
Expected: pick both values from autocomplete. An ephemeral error,
"Failed to add backlog entry" and "That game is already in your backlog."
Ephemeral: yes

### Step 7: Add Final Fantasy VI with no platform
```
/backlog add title:Final Fantasy VI
```
Expected: pick the title from autocomplete. An ephemeral reply, "Added" and
"Final Fantasy VI" and "to your backlog.", with no platform in parentheses.
Ephemeral: yes

### Step 8: Edit an entry without changing anything
```
/backlog edit entry:Chrono Trigger
```
Expected: pick the Chrono Trigger entry from autocomplete. An ephemeral error,
"Provide at least one field to update."
Ephemeral: yes

### Step 9: Edit an entry typed by hand
```
/backlog edit entry:zzqqxx note:Should not save
```
Expected: type the entry by hand, do not use autocomplete. An ephemeral error,
"Invalid backlog entry selection."
Ephemeral: yes

### Step 10: Edit an entry that is not yours
```
/backlog edit entry:backlog:999999999 note:Should not save
```
Expected: type the entry by hand. An ephemeral error, "Backlog entry was not found."
Ephemeral: yes

### Step 11: Edit with a platform that does not exist
```
/backlog edit entry:Chrono Trigger platform:zzqqxx
```
Expected: pick the entry from autocomplete and type the platform by hand. An ephemeral
error, "Invalid platform selection."
Ephemeral: yes

### Step 12: Change the note and sort order
```
/backlog edit entry:Chrono Trigger note:Edited by conductor sort_order:1
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Updated" and
"Chrono Trigger" and "in your backlog.", and not: "Failed to update backlog entry".
Ephemeral: yes

### Step 13: Check the edited note in your list
```
/backlog list title:Chrono Trigger private:true
```
Expected: an ephemeral list, title: "Game Backlog", with "Chrono Trigger" and the note
"Edited by conductor", and "Filter: title~Chrono Trigger".
Ephemeral: yes

### Step 14: Change the platform of the entry
```
/backlog edit entry:Final Fantasy VI platform:SNES
```
Expected: pick the entry and the platform from autocomplete. An ephemeral reply,
"Updated" and "Final Fantasy VI" and "in your backlog.", and not: "No platform".
Ephemeral: yes

### Step 15: Clear the note
```
/backlog edit entry:Chrono Trigger clear_note:true
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Updated" and
"Chrono Trigger" and "in your backlog."
Ephemeral: yes

### Step 16: Check the note is gone
```
/backlog list title:Chrono Trigger private:true
```
Expected: an ephemeral list, title: "Game Backlog", with "Chrono Trigger" and
not: "Edited by conductor".
Ephemeral: yes

### Step 17: Clear the note and set a new one at once
```
/backlog edit entry:Chrono Trigger note:Ignored note clear_note:true
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Updated" and
"Chrono Trigger". clear_note wins, so the note stays empty.
Ephemeral: yes

### Step 18: Check clear_note won
```
/backlog list title:Chrono Trigger private:true
```
Expected: an ephemeral list with "Chrono Trigger" and not: "Ignored note".
Ephemeral: yes

### Step 19: Remove an entry typed by hand
```
/backlog remove entry:zzqqxx
```
Expected: type the entry by hand, do not use autocomplete. An ephemeral error,
"Invalid backlog entry selection."
Ephemeral: yes

### Step 20: Remove an entry that is not yours
```
/backlog remove entry:backlog:999999999
```
Expected: type the entry by hand. An ephemeral error, "Backlog entry was not found."
Ephemeral: yes

### Step 21: Remove Chrono Trigger
```
/backlog remove entry:Chrono Trigger
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Removed" and
"Chrono Trigger" and "from your backlog."
Ephemeral: yes

### Step 22: Remove Final Fantasy VI
```
/backlog remove entry:Final Fantasy VI
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Removed" and
"Final Fantasy VI" and "from your backlog."
Ephemeral: yes

### Step 23: Check Chrono Trigger is gone
```
/backlog list title:Chrono Trigger
```
Expected: a public reply, "No backlog entries matched your filter."
Ephemeral: no

### Step 24: Check Final Fantasy VI is gone
```
/backlog list title:Final Fantasy VI
```
Expected: a public reply, "No backlog entries matched your filter."
Ephemeral: no
