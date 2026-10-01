# gamedb test plan, part 1: search, view, and the profile buttons

A full pass over `/gamedb search` (title and every filter, the result picker, and paging),
`/gamedb view`, and the buttons on a game profile: Add to Backlog, Add to Collection, and
Add to Now Playing List, with each picker they open. Adding games, refreshing release data,
and the admin subcommands are in part 2.

It runs against real data: it adds Chrono Trigger to your backlog, your collection, and
your Now Playing list, then removes it from all three again.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Preconditions: any member can run it. Chrono Trigger must not be in your backlog, your
collection, or your Now Playing list, and your Now Playing list must have fewer than 10
titles. GameDB must hold Chrono Trigger with its SNES release.

## Testing

### Step 1: Search with no title and no filter
```
/gamedb search
```
Expected: a public error, "Please provide a title or at least one filter".
Ephemeral: no

### Step 2: Search by title
```
/gamedb search title:Chrono
```
Expected: type Chrono and keep the typed text rather than a suggestion. A public result
list, "Search Results for", with "Chrono Trigger", "results total", and a picker
Select a game to view details.
Ephemeral: no

### Step 3: Pick a result
```
select "Chrono Trigger (1995)" from "Select a game to view details"
```
Expected: the same message changes in place to the Chrono Trigger profile, with
"Description", "GameDB ID:", button: "Add to Now Playing List", and the result picker kept
below it.
Ephemeral: no

### Step 4: Search by platform and year
```
/gamedb search platform:SNES year:1995
```
Expected: pick the SNES platform from autocomplete. A public list, "GameDB Search (Page 1/",
with "Filters:", "Year: 1995", and button: "Next".
Ephemeral: no

### Step 5: Page forward
```
click "Next"
```
Expected: the message changes in place to "(Page 2/" with button: "Previous".
Ephemeral: no

### Step 6: Page back
```
click "Previous"
```
Expected: the message changes in place to "(Page 1/".
Ephemeral: no

### Step 7: Search upcoming releases
```
/gamedb search upcoming_release:true
```
Expected: a public list, "GameDB Search", with "Upcoming release" in the filter line.
Ephemeral: no

### Step 8: Search by developer and publisher
```
/gamedb search developer:Square publisher:Square
```
Expected: pick Square from autocomplete for both. A public list with
"Developer: Square" and "Publisher: Square".
Ephemeral: no

### Step 9: Search for a title nobody has
```
/gamedb search title:zzqqxx
```
Expected: a public reply, "No games found on IGDB matching".
Ephemeral: no

### Step 10: View Chrono Trigger
```
/gamedb view title:Chrono Trigger
```
Expected: pick Chrono Trigger from autocomplete. A public profile, "Chrono Trigger",
"Releases", "GameDB ID:", button: "Add to Now Playing List", button: "Add to Backlog",
and button: "Add to Collection".
Ephemeral: no

### Step 11: View a GameDB id that does not exist
```
/gamedb view title:999999999
```
Expected: type the number and keep it. A public error, "No game found with ID 999999999".
Ephemeral: no

### Step 12: View by a title nobody has
```
/gamedb view title:zzqqxx
```
Expected: type the text and keep it. A public reply,
"No games found on IGDB matching".
Ephemeral: no

### Step 13: Add to Backlog from the profile
```
click "Add to Backlog" on the profile from step 10
```
Expected: an ephemeral picker, Select a platform for your backlog, with
option: "Super Nintendo Entertainment System".
Ephemeral: yes

### Step 14: Pick the backlog platform
```
select "Super Nintendo Entertainment System"
```
Expected: an ephemeral reply, "Added", "Chrono Trigger", and "to your backlog.".
Ephemeral: yes

### Step 15: Remove it from the backlog
```
/backlog remove entry:Chrono Trigger
```
Expected: pick the Chrono Trigger entry from autocomplete. An ephemeral reply,
"Removed" and "from your backlog.".
Ephemeral: yes

### Step 16: Add to Collection from the profile
```
click "Add to Collection" on the profile from step 10
```
Expected: an ephemeral picker, "Select the platform for", with
option: "Super Nintendo Entertainment System".
Ephemeral: yes

### Step 17: Pick the collection platform
```
select "Super Nintendo Entertainment System"
```
Expected: the picker changes in place to "How do you own it?" with option: "Physical".
Ephemeral: yes

### Step 18: Pick the ownership type
```
select "Physical"
```
Expected: the picker changes in place to "Added", "Chrono Trigger", and
"to your collection.".
Ephemeral: yes

### Step 19: Remove it from the collection
```
/collection remove entry:Chrono Trigger
```
Expected: pick the Chrono Trigger entry from autocomplete. An ephemeral reply,
"Removed" and "from your collection.".
Ephemeral: yes

### Step 20: Add to Now Playing from the profile
```
click "Add to Now Playing List" on the profile from step 10
```
Expected: an ephemeral picker, "Select the platform for", with
option: "Super Nintendo Entertainment System".
Ephemeral: yes

### Step 21: Pick the Now Playing platform
```
select "Super Nintendo Entertainment System"
```
Expected: an ephemeral Now Playing list, "Now Playing", with "Chrono Trigger".
Ephemeral: yes

### Step 22: Add it again from the same picker
```
select "Super Nintendo Entertainment System" on the picker from step 20
```
Expected: an ephemeral error, "That title is already in your Now Playing list".
Ephemeral: yes

### Step 23: Open the Now Playing manage menu
```
click your name on the list from step 21
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
