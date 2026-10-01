# /game-completion import-completionator test plan

Part 3 of the `/game-completion` plans. It covers `import-completionator` with every
action (start, status, pause, resume, cancel), its errors, and the review wizard's
no-match controls: Query GameDB, Enter GameDB ID, Enter IGDB ID, Skip, and Pause. It
creates two import sessions in the API (one finished, one canceled) and no completions:
every row in the test CSV is a made-up title, so nothing matches and nothing is added.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.
Long commands wrap onto a second line here; type each one as a single command.

Before running it:

- Run it in the bot dev channel of the test guild, where the conductor runs. There the
  replies are public and the review wizard is posted in the channel. In any other channel
  the replies are private and the wizard opens in a new thread.
- You must have no active or paused Completionator import. If you do, run
  `/game-completion import-completionator action:cancel` first.
- Attach `docs/test-plans/fixtures/completionator-test.csv` wherever a step says
  file:completionator-test.csv. It holds three rows: Zzqqxxvv, Qqzzyyxx, and Xxvvqqzz.
- Keep test_mode:true. It only labels the wizard; it does not stop a matched row from
  being saved, so never pick a real game in this wizard.

## Testing

### Step 1: Start without a file
```
/game-completion import-completionator action:start
```
Expected: a public reply, "Please attach the Completionator CSV file." with the export
steps, "Export to CSV".
Ephemeral: no

### Step 2: Ask for status with no import
```
/game-completion import-completionator action:status
```
Expected: a public reply, "No active import session found."
Ephemeral: no

### Step 3: Pause with no import
```
/game-completion import-completionator action:pause
```
Expected: a public reply, "No active import session found."
Ephemeral: no

### Step 4: Start the import from the test CSV
```
/game-completion import-completionator action:start file:completionator-test.csv
test_mode:true
```
Expected: attach the fixture CSV. A public reply, "Import session #",
"created with 3 rows", and "Starting review in". A wizard message follows in the channel
with TEST MODE, Row 1/3, Zzqqxxvv, and No GameDB matches found (check by eye).
Ephemeral: no

### Step 5: Pause from the wizard
```
click "Pause"
```
Expected: a private reply, "paused." and
"Resume with `/game-completion import-completionator action:resume`."
Ephemeral: yes

### Step 6: Check the paused status
```
/game-completion import-completionator action:status
```
Expected: a public reply, "Completionator Import #", "Status: paused (TEST MODE)",
"Pending:", "Imported:", and "Skipped:".
Ephemeral: no

### Step 7: Resume the import
```
/game-completion import-completionator action:resume
```
Expected: a public reply, "resumed. Continue in". A new wizard message follows with
Row 1/3 and Zzqqxxvv (check by eye).
Ephemeral: no

### Step 8: Search GameDB for another made-up title
```
click "Query GameDB", enter "Zzqqxxww" in "GameDB search string", submit
```
Expected: the wizard updates in place to "No GameDB matches found for" and "Zzqqxxww",
with button: "Query GameDB", button: "Enter GameDB ID", and button: "Skip".
Ephemeral: no

### Step 9: Enter a GameDB ID that is not a number
```
click "Enter GameDB ID", enter "abc" in "GameDB id", submit
```
Expected: row 1 is marked as an error and the wizard moves on in place to "Row 2/3" and
"Qqzzyyxx".
Ephemeral: no

### Step 10: Enter an IGDB ID that is not a number
```
click "Enter IGDB ID", enter "abc" in "IGDB id", submit
```
Expected: row 2 is marked as an error and the wizard moves on in place to "Row 3/3" and
"Xxvvqqzz".
Ephemeral: no

### Step 11: Skip the last row
```
click "Skip"
```
Expected: the wizard changes in place to "Import completed." and
"nothing was persisted".
Ephemeral: no

### Step 12: Ask for status after the import finished
```
/game-completion import-completionator action:status
```
Expected: a public reply, "No active import session found."
Ephemeral: no

### Step 13: Start a second import to cancel
```
/game-completion import-completionator action:start file:completionator-test.csv
test_mode:true
```
Expected: attach the fixture CSV. A public reply, "created with 3 rows".
Ephemeral: no

### Step 14: Cancel the import
```
/game-completion import-completionator action:cancel
```
Expected: a public reply, "Import #" and "canceled."
Ephemeral: no

### Step 15: Resume with nothing to resume
```
/game-completion import-completionator action:resume
```
Expected: a public reply, "No active import session found."
Ephemeral: no
