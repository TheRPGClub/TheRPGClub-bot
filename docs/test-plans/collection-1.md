# /collection test plan, part 1: add, edit, remove, to-now-playing, to-completion

A full pass over `/collection add`, `edit`, `remove`, `to-now-playing`, and
`to-completion`, every option they take, and the error replies for bad input. The list and
its Filter panel are in `collection-2.md`, the overview in `collection-3.md`, and the CSV and
Steam imports in `collection-import.md`. It runs against real data: it adds Chrono Trigger
to your collection, moves it to Now Playing, logs a completion for it with the announcement
turned off, then deletes that completion and removes the collection entry.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Any member can run it; no admin or owner role is needed. Before running it, make sure your
collection has no Chrono Trigger entry, your Now Playing list has fewer than 10 titles and
does not hold Chrono Trigger, and you have no undated Chrono Trigger completion. Every
reply in this plan is ephemeral except the Now Playing list checks.

## Testing

### Step 1: Add a title that GameDB and IGDB cannot find
```
/collection add title:zzqqxxzzqqxx platform:SNES ownership_type:Physical
```
Expected: type the title by hand and pick the platform from autocomplete. An ephemeral
error, "Could not find that title in GameDB or IGDB."
Ephemeral: yes

### Step 2: Add a title with no exact GameDB match
```
/collection add title:Chrono Trigge platform:SNES ownership_type:Physical
```
Expected: type the title by hand. An ephemeral reply, "No exact GameDB match found for" and
"Select the correct IGDB game to import:", with an IGDB game picker. Leave the picker
alone; using it would import a game into GameDB.
Ephemeral: yes

### Step 3: Add with a platform that does not exist
```
/collection add title:Chrono Trigger platform:zzqqxx ownership_type:Physical
```
Expected: pick the title from autocomplete and type the platform by hand. An ephemeral
error, "Invalid platform selection."
Ephemeral: yes

### Step 4: Add Chrono Trigger
```
/collection add title:Chrono Trigger platform:SNES ownership_type:Physical note:Conductor test
```
Expected: pick the title and platform from autocomplete. An ephemeral reply, "Added" and
"Chrono Trigger" and "Physical" and "to your collection."
Ephemeral: yes

### Step 5: Add the same entry again
```
/collection add title:Chrono Trigger platform:SNES ownership_type:Physical
```
Expected: pick both values from autocomplete. An ephemeral error,
"That game/platform/ownership entry already exists in your collection."
Ephemeral: yes

### Step 6: Edit an entry without changing anything
```
/collection edit entry:Chrono Trigger
```
Expected: pick the Chrono Trigger entry from autocomplete. An ephemeral error,
"Provide at least one field to update."
Ephemeral: yes

### Step 7: Edit an entry typed by hand
```
/collection edit entry:zzqqxx note:Should not save
```
Expected: type the entry by hand, do not use autocomplete. An ephemeral error,
"Invalid collection entry selection."
Ephemeral: yes

### Step 8: Edit an entry that is not yours
```
/collection edit entry:collection:999999999 note:Should not save
```
Expected: type the entry by hand. An ephemeral error, "Collection entry was not found."
Ephemeral: yes

### Step 9: Edit with a platform that does not exist
```
/collection edit entry:Chrono Trigger platform:zzqqxx
```
Expected: pick the entry from autocomplete and type the platform by hand. An ephemeral
error, "Invalid platform selection."
Ephemeral: yes

### Step 10: Change the ownership type and note
```
/collection edit entry:Chrono Trigger ownership_type:Digital note:Edited by conductor
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Updated" and
"Chrono Trigger" and "Digital".
Ephemeral: yes

### Step 11: Clear the note
```
/collection edit entry:Chrono Trigger clear_note:true
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Updated" and
"Chrono Trigger" and "Digital".
Ephemeral: yes

### Step 12: Move an entry typed by hand to Now Playing
```
/collection to-now-playing entry:zzqqxx
```
Expected: type the entry by hand. An ephemeral error, "Invalid collection entry selection."
Ephemeral: yes

### Step 13: Move Chrono Trigger to Now Playing
```
/collection to-now-playing entry:Chrono Trigger note_override:Conductor now playing
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Added" and
"Chrono Trigger" and "to your now-playing list."
Ephemeral: yes

### Step 14: Move Chrono Trigger to Now Playing again
```
/collection to-now-playing entry:Chrono Trigger
```
Expected: pick the entry from autocomplete. An ephemeral error,
"That title is already in your Now Playing list."
Ephemeral: yes

### Step 15: Check Now Playing
```
/now-playing list
```
Expected: your public list, "Now Playing", with "Chrono Trigger".
Ephemeral: no

### Step 16: Log a completion with an impossible date
```
/collection to-completion entry:Chrono completion_type:Main Story completion_date:2026-02-30
```
Expected: pick the entry from autocomplete. An ephemeral error,
"Could not parse completion date."
Ephemeral: yes

### Step 17: Log a completion with negative playtime
```
/collection to-completion entry:Chrono completion_type:Main Story final_playtime_hours:-5
```
Expected: pick the entry from autocomplete. An ephemeral error,
"Final playtime must be a non-negative number."
Ephemeral: yes

### Step 18: Log a completion for an entry typed by hand
```
/collection to-completion entry:zzqqxx completion_type:Main Story
```
Expected: type the entry by hand. An ephemeral error, "Invalid collection entry selection."
Ephemeral: yes

### Step 19: Log the completion without an announcement
```
/collection to-completion entry:Chrono completion_type:Main Story final_playtime_hours:25
```
Expected: type Chrono and pick the Chrono Trigger entry from autocomplete. announce is left
out, so nothing is announced. An ephemeral reply, "Logged completion for" and
"Chrono Trigger" and "Main Story".
Ephemeral: yes

### Step 20: Check the completion took Chrono Trigger off Now Playing
```
/now-playing list
```
Expected: your public list, "Now Playing", with not: "Chrono Trigger". The option
remove_from_now_playing defaults to true.
Ephemeral: no

### Step 21: Open the completion delete picker
```
/game-completion delete title:Chrono Trigger
```
Expected: an ephemeral reply, title: "Completed Games", with a picker whose placeholder is
Select a completion to delete, and option: "Chrono Trigger".
Ephemeral: yes

### Step 22: Delete the completion logged in step 19
```
select the Chrono Trigger completion marked Main Story (No date)
```
Expected: an ephemeral reply, "Deleted completion #".
Ephemeral: yes

### Step 23: Remove an entry typed by hand
```
/collection remove entry:zzqqxx
```
Expected: type the entry by hand. An ephemeral error, "Invalid collection entry selection."
Ephemeral: yes

### Step 24: Remove an entry that is not yours
```
/collection remove entry:collection:999999999
```
Expected: type the entry by hand. An ephemeral error, "Collection entry was not found."
Ephemeral: yes

### Step 25: Remove Chrono Trigger
```
/collection remove entry:Chrono Trigger
```
Expected: pick the entry from autocomplete. An ephemeral reply, "Removed" and
"Chrono Trigger" and "from your collection."
Ephemeral: yes
