# /backlog test plan, part 3: pick

A full pass over `/backlog pick`: its `platform`, `max_hours`, and `source` options, the
Reroll, Start playing, and Not now buttons on the suggestion card, and its error and empty
replies. Add, edit, and remove are in `backlog-1.md`; the list and its pickers are in
`backlog-2.md`. It runs against real data: it adds Chrono Trigger to your backlog, starts
playing it from a suggestion, and removes it from Now Playing again at the end.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Any member can run it; no admin or owner role is needed. Before running it, make sure:

- your backlog holds no SNES games, so every SNES pick can only be Chrono Trigger;
- your collection holds no SNES games with a HowLongToBeat main story time of 1 hour or
  less;
- Chrono Trigger is on neither your backlog nor your Now Playing list;
- the bot has cached HowLongToBeat times for Chrono Trigger. `/backlog pick` reads the
  bot's HLTB cache, and with `max_hours` set it skips a game with no cached times, so
  step 9 would show "Nothing matched those filters." instead of the card.

Every reply is ephemeral except the public list checks in steps 11 and 13.

## Testing

### Step 1: Pick with a platform that does not exist
```
/backlog pick platform:zzqqxx
```
Expected: type the platform by hand, do not use autocomplete. An ephemeral error,
"Invalid platform selection."
Ephemeral: yes

### Step 2: Pick SNES games from an empty pool
```
/backlog pick platform:SNES
```
Expected: pick the platform from autocomplete. An ephemeral reply,
"Nothing matched those filters." and "Add games with", and not: "Try this next".
Ephemeral: yes

### Step 3: Add Chrono Trigger to the backlog
```
/backlog add title:Chrono Trigger platform:SNES
```
Expected: pick the title and platform from autocomplete. An ephemeral reply, "Added" and
"Chrono Trigger" and "to your backlog."
Ephemeral: yes

### Step 4: Pick with a playtime cap nothing fits
```
/backlog pick platform:SNES max_hours:1
```
Expected: pick the platform from autocomplete. An ephemeral reply,
"Nothing matched those filters." and
"Games with no HowLongToBeat times are skipped when", and not: "Try this next".
Ephemeral: yes

### Step 5: Pick an SNES game
```
/backlog pick platform:SNES
```
Expected: pick the platform from autocomplete. An ephemeral card, "Try this next", with
"Chrono Trigger", "From your backlog", "source: backlog", button: "Reroll",
button: "Start playing", and button: "Not now".
Ephemeral: yes

### Step 6: Reroll the suggestion
```
click "Reroll"
```
Expected: the card updates in place to Chrono Trigger again, the only game in the pool,
with "Try this next" and "Back to the start of your list, so picks may repeat."
Ephemeral: yes

### Step 7: Dismiss the suggestion
```
click "Not now"
```
Expected: the card changes in place to "No problem. Run" and
"whenever you want a suggestion.", with not: "Try this next".
Ephemeral: yes

### Step 8: Pick from both the backlog and the collection with a cap
```
/backlog pick source:Both platform:SNES max_hours:1
```
Expected: pick the platform from autocomplete. An ephemeral reply,
"Nothing matched those filters." and "Games with no HowLongToBeat times are skipped when".
Ephemeral: yes

### Step 9: Pick with a playtime cap Chrono Trigger fits
```
/backlog pick source:Backlog platform:SNES max_hours:100
```
Expected: pick the platform from autocomplete. An ephemeral card, "Try this next", with
"Chrono Trigger", "HowLongToBeat", "Main:", and "up to 100 hours (HLTB main story)".
Ephemeral: yes

### Step 10: Start playing the suggestion
```
click "Start playing"
```
Expected: use the card from step 9. A new ephemeral reply, "Added" and "Chrono Trigger"
and "to your Now Playing list.", and not: "Failed to add to Now Playing".
Ephemeral: yes

### Step 11: Check Chrono Trigger left the backlog
```
/backlog list title:Chrono Trigger
```
Expected: a public reply, "No backlog entries matched your filter."
Ephemeral: no

### Step 12: Start playing from the stale card
```
click "Start playing"
```
Expected: use the card from step 9 again. An ephemeral error,
"That backlog entry no longer exists."
Ephemeral: yes

### Step 13: Check Chrono Trigger is on Now Playing
```
/now-playing list
```
Expected: your public list, "Now Playing", with "Chrono Trigger".
Ephemeral: no

### Step 14: Open the Now Playing manage menu
```
click your name in the header of the list from step 13
```
Expected: an ephemeral manage row with button: "Remove Game".
Ephemeral: yes

### Step 15: Open Remove Game
```
click "Remove Game"
```
Expected: the manage message changes to "Now Playing Remove" with
"Select a game below to remove it from your list." and "Chrono Trigger".
Ephemeral: yes

### Step 16: Remove Chrono Trigger from Now Playing
```
select "Chrono Trigger (SNES)"
```
Expected: the remove screen updates in place, "Select a game below to remove it from your
list.", and Chrono Trigger is gone from it (check by eye).
Ephemeral: yes
