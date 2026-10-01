# /collection test plan: CSV and Steam imports

A pass over `/collection import-csv` and `/collection import-steam`: every action (start,
status, pause, resume, cancel), the CSV template and validation replies, and the review
screen buttons (Choose, Search a different title, Enter GameDB or IGDB ID, Skip, Pause).
It runs against real data: it creates three CSV import sessions, adds one Final Fantasy
series entry to your collection through Choose, and removes that entry again. A Steam import
with a real library is left out, because it adds every exact title match at once and
test_mode does not stop those writes.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Any member can run it; no admin or owner role is needed. Before running it, make sure you
have no active or paused CSV or Steam import (run `action:cancel` for each if you do), and
your collection has no entry without a platform. Create these four files first:

`conductor-import.csv`, three lines:

    title,platform,ownership_type,note
    Final Fantasy,,Digital,Conductor import test
    zzqqxx conductor row,,Digital,

`conductor-bad.csv`, two lines:

    title,igdb_id
    Chrono Trigger,abc

`conductor-empty.csv`, one line: `title`

`conductor-notes.txt`, one line: `not a csv`

Every reply in this plan is ephemeral.

## Testing

### Step 1: Ask for CSV status with no import
```
/collection import-csv action:status
```
Expected: an ephemeral reply, "No active CSV import session found."
Ephemeral: yes

### Step 2: Start a CSV import without a file
```
/collection import-csv action:start
```
Expected: an ephemeral reply, title: "Custom CSV Collection Import", with
"Download the attached Excel template" and "Required column", and an attached template.
Ephemeral: yes

### Step 3: Start with a file that is not a CSV
```
/collection import-csv action:start file:conductor-notes.txt
```
Expected: attach conductor-notes.txt. An ephemeral reply,
"The uploaded file is not a CSV." and an attached template.
Ephemeral: yes

### Step 4: Start with a CSV that fails validation
```
/collection import-csv action:start file:conductor-bad.csv
```
Expected: attach conductor-bad.csv. An ephemeral reply,
"CSV validation failed." and "IGDB id must be a positive number."
Ephemeral: yes

### Step 5: Start with a CSV that has no rows
```
/collection import-csv action:start file:conductor-empty.csv
```
Expected: attach conductor-empty.csv. An ephemeral reply,
"CSV file contains no importable rows."
Ephemeral: yes

### Step 6: Start a CSV import in test mode
```
/collection import-csv action:start file:conductor-import.csv test_mode:true
```
Expected: attach conductor-import.csv. An ephemeral "created for" and
"Starting review now." note, then the review screen, "TEST MODE", "Row 1/2",
"Final Fantasy", "GameDB Match Candidates", with button: "Choose", button: "Skip",
button: "Pause", and button: "Enter GameDB or IGDB ID".
Ephemeral: yes

### Step 7: Start a second CSV import while one is active
```
/collection import-csv action:start file:conductor-import.csv
```
Expected: attach conductor-import.csv. An ephemeral error, "You already have import #" and
"Use action:resume, action:status, action:pause, or action:cancel."
Ephemeral: yes

### Step 8: Enter a GameDB ID that is not a number
```
click "Enter GameDB or IGDB ID", enter "abc" in "GameDB ID (or IGDB numeric ID)", submit
```
Expected: use the review screen from step 6. An ephemeral reply,
"Game ID must be a positive integer."
Ephemeral: yes

### Step 9: Search a title with no matches
```
click "Search a different title", enter "zzqqxx nothing" in "Search title", submit
```
Expected: use the review screen from step 6. An ephemeral reply,
"No GameDB matches found for" and "zzqqxx nothing", with button: "Skip".
Ephemeral: yes

### Step 10: Pause the import
```
click "Pause"
```
Expected: use the review screen from step 6. It changes in place to "paused." and
"to continue".
Ephemeral: yes

### Step 11: Check the paused import's status
```
/collection import-csv action:status
```
Expected: an ephemeral reply, title: "CSV Collection Import", with
"Status: PAUSED (TEST MODE)" and "Pending".
Ephemeral: yes

### Step 12: Resume the import
```
/collection import-csv action:resume
```
Expected: an ephemeral "resumed." note, then the review screen again with "Row 1/2" and
"Final Fantasy".
Ephemeral: yes

### Step 13: Skip the first row
```
click "Skip"
```
Expected: use the review screen from step 12. It changes in place to "Row 2/2" and
"zzqqxx conductor row".
Ephemeral: yes

### Step 14: Skip the last row
```
click "Skip"
```
Expected: the review screen changes in place to "Import completed.", "Skipped: 2", and
"nothing was persisted".
Ephemeral: yes

### Step 15: Check that no import is active
```
/collection import-csv action:status
```
Expected: an ephemeral reply, "No active CSV import session found."
Ephemeral: yes

### Step 16: Start a real CSV import
```
/collection import-csv action:start file:conductor-import.csv
```
Expected: attach conductor-import.csv. The review screen with "Row 1/2" and
"Final Fantasy", and not: "TEST MODE".
Ephemeral: yes

### Step 17: Choose the first GameDB candidate
```
click "Choose"
```
Expected: use the first Choose button on the review screen from step 16. The review moves
on to "Row 2/2" and "zzqqxx conductor row".
Ephemeral: yes

### Step 18: Cancel the import
```
/collection import-csv action:cancel
```
Expected: an ephemeral reply, "canceled." with "Added 1".
Ephemeral: yes

### Step 19: Use the review screen of the canceled import
```
click "Skip"
```
Expected: use the review screen from step 17. It changes in place to "is canceled."
Ephemeral: yes

### Step 20: Move the imported entry with no platform to Now Playing
```
/collection to-now-playing entry:Final Fantasy
```
Expected: pick the entry marked Unknown platform | Digital from autocomplete. An ephemeral
error, "This entry does not have a platform. Update it before adding."
Ephemeral: yes

### Step 21: Remove the imported entry
```
/collection remove entry:Final Fantasy
```
Expected: pick the entry marked Unknown platform | Digital from autocomplete. An ephemeral
reply, "Removed" and "from your collection."
Ephemeral: yes

### Step 22: Ask for Steam status with no import
```
/collection import-steam action:status
```
Expected: an ephemeral reply, "No active Steam import session found."
Ephemeral: yes

### Step 23: Start a Steam import with a malformed profile
```
/collection import-steam action:start steam_profile:not a profile!
```
Expected: an ephemeral error, "Unsupported Steam profile identifier format."
Ephemeral: yes

### Step 24: Start a Steam import with a vanity name that does not exist
```
/collection import-steam action:start steam_profile:zzqqxxconductornotreal
```
Expected: an ephemeral error, "Could not resolve Steam vanity profile."
Ephemeral: yes
