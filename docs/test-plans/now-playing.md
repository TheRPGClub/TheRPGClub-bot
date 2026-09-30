# /now-playing test plan

A full pass over `/now-playing add`, `list`, and `search`, and every button, select, and
modal their replies lead to. It runs against real data: it adds Chrono Trigger, writes and
deletes a journal entry, and logs a real completion with the announcement turned off.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it, make sure your Now Playing list has fewer than 10 titles and does not
already hold Chrono Trigger. Step 4 adds it, and later steps remove it again.

## Testing

### Step 1: Show your list publicly
```
/now-playing list
```
Expected: a public list with the heading "Now Playing", a header button labelled with your
username, and
the line "List owner can use button in the header to maintain this list". not: "Error".
Ephemeral: no

### Step 2: Show your list privately
```
/now-playing list private:true
```
Expected: the same list as step 1, visible only to you, with "Now Playing" and
"List owner can use button in the header to maintain this list".
Ephemeral: yes

### Step 3: Add a game with a title GameDB cannot match
```
/now-playing add title:zzqqxx platform:PlayStation
```
Expected: a public error, "I could not find a unique GameDB match for" and
"Please choose from autocomplete".
Ephemeral: no

### Step 4: Add Chrono Trigger
```
/now-playing add title:Chrono Trigger platform:SNES
```
Expected: pick both values from autocomplete. Your public list is reposted with
"Chrono Trigger" in it, and not: "Could not add to Now Playing".
Ephemeral: no

### Step 5: Add Chrono Trigger again
```
/now-playing add title:Chrono Trigger platform:SNES
```
Expected: pick both values from autocomplete. A public error,
"That title is already in your Now Playing list".
Ephemeral: no

### Step 6: View another member's list
```
/now-playing list member:@RPGClubbot (Preview)
```
Expected: a public reply naming that member, "Now Playing", with either their games or
a note that they have no Now Playing entries.
Ephemeral: no

### Step 7: View everyone's lists
```
/now-playing list all:true
```
Expected: a public list, title: "Now Playing - Everyone", with a member picker
placeholder View a member's Now Playing list, and a line for you.
Ephemeral: no

### Step 8: Pick a member from the everyone list
```
select your own name from "View a member's Now Playing list"
```
Expected: the everyone message briefly shows Now Loading, then changes in place to your
list with "Chrono Trigger". It must not stay stuck loading or post a second message.
Ephemeral: no

### Step 9: Search for a game someone is playing
```
/now-playing search title:Chrono Trigger
```
Expected: a public reply, "Now Playing Search", listing "Chrono Trigger" with your name.
Ephemeral: no

### Step 10: Search privately for a title no one is playing
```
/now-playing search title:zzqqxx private:true
```
Expected: an ephemeral reply,
"No one is currently playing GameDB titles matching".
Ephemeral: yes

### Step 11: Open the manage menu
```
click your name button in the header of your public list from step 4
```
Expected: an ephemeral manage row with button: "Sort", button: "Edit Platform",
button: "Add Completion", button: "Remove Game", and button: "Start a Game Journal".
Ephemeral: yes

### Step 12: Open Sort
```
click "Sort"
```
Expected: the manage message changes to "Sort Your Now Playing List" with
"Pick one title for each position, then press Save." and a Position select per game.
Ephemeral: yes

### Step 13: Open the Sort help
```
click "?"
```
Expected: a new ephemeral reply, "Sort - Help".
Ephemeral: yes

### Step 14: Save a new sort order
```
select "Chrono Trigger (SNES)" for "Position 1", refill the cleared slot, click "Save"
```
Expected: the message briefly shows Saving sort order and returns to the manage row with
button: "Sort". Check by eye that your public list now shows Chrono Trigger as number 1,
a different order from before; the new order stays for the rest of the run.
Ephemeral: yes

### Step 15: Open Edit Platform
```
click "Edit Platform"
```
Expected: the manage message changes to "Now Playing Edit Platform" with
"Pick one platform per game, then press Save." and a platform select per game.
Ephemeral: yes

### Step 16: Cancel Edit Platform and open Remove Game
```
click "Cancel", click "Remove Game"
```
Expected: the manage message changes to "Now Playing Remove" with
"Select a game below to remove it from your list." and "Chrono Trigger".
Ephemeral: yes

### Step 17: Leave Remove Game and start a Game Journal
```
click "Done", click "Start a Game Journal"
```
Expected: the manage message changes to "Start a Game Journal" with
"Select a game to write your first entry." and option: "Chrono Trigger".
Ephemeral: yes

### Step 18: Write the first journal entry
```
select "Chrono Trigger", Title "Conductor test entry", Entry "Testing the journal.", submit
```
Expected: a public journal message, "Chrono Trigger Game Journal", with
"Conductor test entry", "Testing the journal." and "1 entry".
Ephemeral: no

### Step 19: View the journal from the list
```
/now-playing list
```
Expected: your public list, with a "View Game Journals" picker and
option: "Chrono Trigger Game Journal".
Ephemeral: no

### Step 20: Delete the journal entry
```
click "Delete Entry" on the journal follow-up, select "Conductor test entry", click "Delete"
```
Expected: a Confirm Delete prompt names the entry, then the entry is removed,
and not: "That journal entry was not found".
Ephemeral: yes

### Step 21: Remove Chrono Trigger with Remove Game
```
click your name button on your list, click "Remove Game", select "Chrono Trigger (SNES)"
```
Expected: the message briefly shows Updating your Now Playing remove list, then changes
in place to the remove screen, or to an empty-list note, with not: "Chrono Trigger".
It must not post a second message.
Ephemeral: yes

### Step 22: Add Chrono Trigger back for the completion flow
```
/now-playing add title:Chrono Trigger platform:SNES
```
Expected: pick both values from autocomplete. Your public list is reposted with
"Chrono Trigger", and not: "Could not add to Now Playing".
Ephemeral: no

### Step 23: Open Add Completion with the announcement off
```
click your name, "Add Completion", then Chrono Trigger's "Add Completion", set Announce "No"
```
Expected: the manage message shows "Add Completion" and "Chrono Trigger", with the
completion selects and Continue and Cancel buttons. If Chrono Trigger is your only game, the
game picker is skipped. Nothing is posted publicly.
Ephemeral: yes

### Step 24: Submit the completion
```
click "Continue", date blank, hours "40", Note "Conductor test", submit, "Add Another" if asked
```
Expected: only if a completion was logged in the last week, a prompt asks whether to add
another; answer Add Another. An ephemeral reply then returns to the completion game
picker, or to an
empty-list note, with not: "Could not parse completion date" and not: "Chrono Trigger".
Chrono Trigger is gone from your list, and nothing is announced publicly.
Ephemeral: yes

### Step 25: Confirm the final list
```
/now-playing list
```
Expected: your public list, "Now Playing", with not: "Chrono Trigger".
Ephemeral: no
