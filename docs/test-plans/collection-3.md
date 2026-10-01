# /collection test plan, part 3: overview

A full pass over `/collection overview`, every option it takes, and the "View collection by
platform" picker under it. It runs against real data: it adds Chrono Trigger to your
collection so the overview has a platform to show, and removes it again at the end.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Any member can run it; no admin or owner role is needed. Before running it, make sure your
collection has no Chrono Trigger entry on SNES. The platform picker only appears when your
collection has at least one entry with a platform, which step 1 guarantees.

## Testing

### Step 1: Add Chrono Trigger
```
/collection add title:Chrono Trigger platform:SNES ownership_type:Physical
```
Expected: pick the title and platform from autocomplete. An ephemeral reply, "Added" and
"Chrono Trigger" and "to your collection."
Ephemeral: yes

### Step 2: Show your overview publicly
```
/collection overview
```
Expected: a public reply titled with your name, title: "Game Collection", with
"Total games:" and a picker whose placeholder is View collection by platform, holding
option: "Overview" and option: "All games".
Ephemeral: no

### Step 3: View all games from the overview
```
select "All games" in "View collection by platform"
```
Expected: the overview message from step 2 changes in place to your list,
title: "Game Collection", with "Chrono Trigger" and "total entries", and
button: "Filter Results". It must not post a second message.
Ephemeral: no

### Step 4: Show your overview privately
```
/collection overview private:true
```
Expected: an ephemeral reply, title: "Your collection overview", with "Total games:" and
the View collection by platform picker.
Ephemeral: yes

### Step 5: Refresh the overview from the picker
```
select "Overview" in "View collection by platform"
```
Expected: the private overview redraws in place, still
title: "Your collection overview", with "Total games:".
Ephemeral: yes

### Step 6: View one platform from the overview
```
select the SNES option in "View collection by platform"
```
Expected: the private overview changes in place to a list, title: "Game Collection", with
"Chrono Trigger", "platform-id=", and "Filters:".
Ephemeral: yes

### Step 7: Show another member's overview
```
/collection overview member:@RPGClubbot (Preview)
```
Expected: a public reply, title: "RPGClubbot (Preview)'s Game Collection", with
"No collection entries yet."
Ephemeral: no

### Step 8: Show everyone's collections
```
/collection overview all:true
```
Expected: a public reply, title: "All Game Collections", with "Total games:". A large club
collection may continue in follow-up messages titled All Game Collections (cont. 2).
Ephemeral: no

### Step 9: Show everyone's collections privately
```
/collection overview all:true private:true
```
Expected: an ephemeral reply, title: "All Game Collections", with "Total games:".
Ephemeral: yes

### Step 10: Remove Chrono Trigger
```
/collection remove entry:Chrono Trigger
```
Expected: pick the SNES Physical entry from autocomplete. An ephemeral reply, "Removed" and
"Chrono Trigger" and "from your collection."
Ephemeral: yes
