# /game-completion add, edit, and delete test plan

Part 1 of the `/game-completion` plans. It covers `add` (the exact match path, the GameDB
picker, the duplicate warning, and the IGDB fallback), `edit` with every option and its
errors, and `delete`. It runs against real data: it logs one Chrono Trigger completion
dated 2024-03-15, edits it, clears its fields, and deletes it again. Every add passes
announce:false, so nothing is posted to the completions channel.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.
Long commands wrap onto a second line here; type each one as a single command.

Before running it:

- Any member can run it; no admin rights are needed.
- You must not already have a Chrono Trigger completion. Step 21 deletes by title, and step
  22 checks that none is left.
- Chrono Trigger must not be in your Now Playing list, or add asks whether to remove it.

## Testing

### Step 1: Add with a date that does not exist
```
/game-completion add title:Chrono Trigger completion_type:Main Story platform:SNES
completion_date:2024-02-30 announce:false
```
Expected: pick the title and platform from autocomplete. A private reply,
"Could not parse completion date. Use YYYY-MM-DD, or 'today'/'unknown'."
Ephemeral: yes

### Step 2: Add with a negative playtime
```
/game-completion add title:Chrono Trigger completion_type:Main Story platform:SNES
final_playtime_hours:-5 announce:false
```
Expected: pick the title and platform from autocomplete. A private reply,
"Final playtime must be a non-negative number of hours."
Ephemeral: yes

### Step 3: Add with a platform that does not exist
```
/game-completion add title:Chrono Trigger completion_type:Main Story platform:zzqqxx announce:false
```
Expected: pick the title from autocomplete and type the platform by hand. A private reply,
"Invalid platform selection."
Ephemeral: yes

### Step 4: Add a title neither GameDB nor IGDB knows
```
/game-completion add title:Zzqqxxvv completion_type:Main Story platform:SNES announce:false
```
Expected: pick the Keep typing option for the title and the platform from autocomplete. A
private reply, "No GameDB or IGDB matches found for" and "Zzqqxxvv".
Ephemeral: yes

### Step 5: Log Chrono Trigger
```
/game-completion add title:Chrono Trigger completion_type:Main Story platform:SNES
completion_date:2024-03-15 final_playtime_hours:25 note:Conductor test completion
announce:false
```
Expected: pick the title and platform from autocomplete. A private reply,
"Logged completion for", "Chrono Trigger", and "Main Story - 25 hours". Nothing is posted
in the completions channel.
Ephemeral: yes

### Step 6: Add with a partial title
```
/game-completion add title:Chrono Trig completion_type:Main Story platform:SNES
completion_date:2024-03-15 announce:false
```
Expected: pick the Keep typing option for the title. A private reply,
"Select the game for", with option: "Chrono Trigger" and
option: "Import another game from IGDB".
Ephemeral: yes

### Step 7: Pick Chrono Trigger again
```
select "Chrono Trigger" in "Select a game to log completion"
```
Expected: a private follow-up warns about the step 5 completion, "within the last week",
"Add another completion anyway?", with button: "Add Another" and button: "Cancel".
Ephemeral: yes

### Step 8: Decline the duplicate
```
click "Cancel"
```
Expected: the warning changes to "Cancelled." and no second completion is logged.
Ephemeral: yes

### Step 9: Start another partial title add
```
/game-completion add title:Chrono Trig completion_type:Main Story platform:SNES announce:false
```
Expected: pick the Keep typing option for the title. A private reply,
"Select the game for", with option: "Import another game from IGDB".
Ephemeral: yes

### Step 10: Ask for the IGDB search
```
select "Import another game from IGDB" in "Select a game to log completion"
```
Expected: the prompt changes to "Found results on IGDB. Please see the new message below."
and a private follow-up reads "No GameDB match; select an IGDB result to import for".
Do not pick a result; that would add a new GameDB title.
Ephemeral: yes

### Step 11: Edit with a typed title instead of a pick
```
/game-completion edit title:Chrono Trigger note:Edited
```
Expected: type the title and send without picking from autocomplete. A private reply,
"Select a completion from the title autocomplete list."
Ephemeral: yes

### Step 12: Edit with a platform and clear_platform together
```
/game-completion edit title:Chrono Trigger platform:PS1 clear_platform:true
```
Expected: pick "Chrono Trigger | Main Story" from autocomplete for the title. A private
reply, "Use either `platform` or `clear_platform:true`, not both."
Ephemeral: yes

### Step 13: Edit with a playtime and clear_final_playtime together
```
/game-completion edit title:Chrono Trigger final_playtime_hours:30 clear_final_playtime:true
```
Expected: pick the title from autocomplete. A private reply,
"clear_final_playtime:true`, not both."
Ephemeral: yes

### Step 14: Edit with a note and clear_note together
```
/game-completion edit title:Chrono Trigger note:Edited clear_note:true
```
Expected: pick the title from autocomplete. A private reply,
"Use either `note` or `clear_note:true`, not both."
Ephemeral: yes

### Step 15: Edit with nothing to change
```
/game-completion edit title:Chrono Trigger
```
Expected: pick the title from autocomplete. A private reply,
"Provide at least one field to update (type, date, platform, playtime, or note)."
Ephemeral: yes

### Step 16: Edit with a bad date
```
/game-completion edit title:Chrono Trigger completion_date:2024-13-01
```
Expected: pick the title from autocomplete. A private reply,
"Could not parse completion date".
Ephemeral: yes

### Step 17: Edit every field
```
/game-completion edit title:Chrono Trigger completion_type:Completionist
completion_date:2024-03-20 platform:PS1 final_playtime_hours:30 note:Edited by conductor
```
Expected: pick the title and platform from autocomplete. A private reply, "Saved:",
"Chrono Trigger", "Completion Type:", "Completionist", "Final Playtime:", "30h", and
"Edited by conductor".
Ephemeral: yes

### Step 18: Clear the platform, playtime, and note
```
/game-completion edit title:Chrono Trigger clear_platform:true clear_final_playtime:true
clear_note:true
```
Expected: pick the title from autocomplete. A private reply, "Saved:", "No platform",
"No playtime", and "No note".
Ephemeral: yes

### Step 19: Delete with a filter that matches nothing
```
/game-completion delete title:Zzqqxxvv
```
Expected: a private reply, "You have no completions to delete matching your filters."
Ephemeral: yes

### Step 20: Open the delete picker for Chrono Trigger
```
/game-completion delete title:Chrono Trigger
```
Expected: a private list, "Completed Games", "Chrono Trigger", with option: "Chrono Trigger"
in the Select a completion to delete picker.
Ephemeral: yes

### Step 21: Delete the test completion
```
select "Chrono Trigger" in "Select a completion to delete"
```
Expected: a private reply, "Deleted completion #", and the picker message loses its
controls.
Ephemeral: yes

### Step 22: Confirm nothing is left
```
/game-completion delete title:Chrono Trigger
```
Expected: a private reply, "You have no completions to delete matching your filters."
Ephemeral: yes
