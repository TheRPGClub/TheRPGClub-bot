# gamedb test plan, part 2: add, release refresh, and admin commands

A full pass over `/gamedb add` (title, `bulk_titles`, `igdb_id`, and the IGDB result
picker), `/gamedb refresh-release-info`, and the admin subcommands `link-versions`,
`synonym-add`, and `synonym-list` with every picker, button, and modal the synonym list
leads to. Search, view, and the profile buttons are in part 1.

It runs against real data. The IGDB pick in step 5 chooses Chrono Trigger, which GameDB
already holds, so it shows the existing entry rather than adding a new game. Step 9 may add
missing release rows to Chrono Trigger from IGDB. The synonym steps create two search
synonym groups made only of "Zqtest" terms and delete both again. No versions are
linked: `link-versions` is only run on its error paths, because a link cannot be undone
from Discord.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Preconditions: run it as a member with the Administrator permission (steps 10 to 25 need
it). GameDB must hold Chrono Trigger with an IGDB id, and no search synonym may contain
"Zqtest" before the run.

## Testing

### Step 1: Add with no title
```
/gamedb add
```
Expected: a public error, "Provide a title or up to 5 comma-separated titles.".
Ephemeral: no

### Step 2: Bulk add more than five titles
```
/gamedb add bulk_titles:Chrono Trigger, Chrono Cross, Xenogears, EarthBound, Okami, Terranigma
```
Expected: a public error, "Bulk import supports up to 5 titles at a time.".
Ephemeral: no

### Step 3: Add a title IGDB does not know
```
/gamedb add title:zzqqxx
```
Expected: a public reply, "No games found on IGDB matching".
Ephemeral: no

### Step 4: Add Chrono Trigger by title
```
/gamedb add title:Chrono Trigger
```
Expected: a public IGDB picker, "IGDB Results for", "Please select one:", with
option: "Chrono Trigger (1995)" and button: "Import First Match".
Ephemeral: no

### Step 5: Pick Chrono Trigger from the IGDB results
```
select "Chrono Trigger (1995)" from "Select a game from IGDB"
```
Expected: the picker message changes in place to the existing Chrono Trigger profile, with
"Chrono Trigger", "GameDB ID:", and button: "Add to Backlog", and not: "Failed to import".
Ephemeral: no

### Step 6: Add by an IGDB id that does not exist
```
/gamedb add igdb_id:999999999
```
Expected: a public error naming the id, "999999999", either as No IGDB game found or as a
failed import with the request and response shown.
Ephemeral: no

### Step 7: Refresh releases for an unknown title
```
/gamedb refresh-release-info title:zzqqxx
```
Expected: type the text and keep it. An ephemeral error, "No GameDB title found for".
Ephemeral: yes

### Step 8: Refresh releases for an ambiguous title
```
/gamedb refresh-release-info title:Chrono
```
Expected: type the text and keep it. An ephemeral error,
"Multiple GameDB titles matched that input", listing "Chrono Trigger".
Ephemeral: yes

### Step 9: Refresh releases for Chrono Trigger
```
/gamedb refresh-release-info title:Chrono Trigger
```
Expected: pick Chrono Trigger from autocomplete. An ephemeral reply,
"Release refresh complete for", "Chrono Trigger", and "Current total releases".
Ephemeral: yes

### Step 10: Link versions with only one id
```
/gamedb link-versions game_ids:1
```
Expected: a public error, "Provide at least two valid GameDB ids to link.".
Ephemeral: no

### Step 11: Link versions with a missing id
```
/gamedb link-versions game_ids:1, 999999999 private:true
```
Expected: an ephemeral error, "Missing GameDB id(s)", naming "999999999". Nothing is linked.
Ephemeral: yes

### Step 12: Add a synonym group with no usable text
```
/gamedb synonym-add base_term:!!! synonym:???
```
Expected: a public error, "Invalid input. Provide a base term and synonym".
Ephemeral: no

### Step 13: Add a synonym group
```
/gamedb synonym-add base_term:Zqtest Alpha synonym:Zqtest Beta additional_synonyms:Zqtest Gamma
```
Expected: a public reply, "Saved synonym group", "with 3 terms", and
"Zqtest Gamma".
Ephemeral: no

### Step 14: List the synonym group
```
/gamedb synonym-list query:Zqtest
```
Expected: a public list, "Search Synonym Groups (Page 1/1)", "Query: Zqtest",
"Zqtest Alpha", option: "Group 1", and button: "Add New Group".
Ephemeral: no

### Step 15: Save the group unchanged from the edit form
```
click "Group 1" in "Select a group to edit"
submit
```
Expected: picking the group opens the edit form prefilled with its three terms. An
ephemeral reply, "Updated synonym group with 3 terms".
Ephemeral: yes

### Step 16: Try to cut the group down to one term
```
click "Group 1" in "Select a group to edit"
enter "Zqtest Alpha" in "Synonym terms, one per line", submit
```
Expected: an ephemeral error, "Synonym groups must include at least two terms.".
Ephemeral: yes

### Step 17: Add a second group from the list
```
click "Add New Group"
enter "Zqtest Delta -> Zqtest Epsilon" in "Synonym pairs, one per line", submit
```
Expected: an ephemeral reply, "Added 1 synonym pair.", "Zqtest Delta", with
button: "Add More" and button: "Done".
Ephemeral: yes

### Step 18: Submit a pair with no separator
```
click "Add More", enter "Zqtest Zeta" in "Synonym pairs, one per line", submit
```
Expected: an ephemeral error, "No valid pairs found.".
Ephemeral: yes

### Step 19: Finish adding synonyms
```
click "Done" on the reply from step 17
```
Expected: the reply changes in place to "Synonym entry complete.".
Ephemeral: yes

### Step 20: List both groups privately
```
/gamedb synonym-list query:Zqtest private:true
```
Expected: an ephemeral list, "Search Synonym Groups", with "Zqtest Alpha",
"Zqtest Delta", option: "Group 1", and option: "Group 2".
Ephemeral: yes

### Step 21: Delete the first group
```
select "Group 1" from "Select a group to delete"
```
Expected: the list changes in place to "Search Synonym Groups" with one group left,
option: "Group 1", and not: "Group 2".
Ephemeral: yes

### Step 22: Delete the second group
```
select "Group 1" from "Select a group to delete"
```
Expected: the list changes in place to "No search synonyms found." with
button: "Add New Group".
Ephemeral: yes

### Step 23: Confirm no test synonyms remain
```
/gamedb synonym-list query:Zqtest private:true
```
Expected: an ephemeral list, "No search synonyms found.", and not: "Zqtest Alpha".
Ephemeral: yes

### Step 24: List every synonym group
```
/gamedb synonym-list private:true
```
Expected: an ephemeral list, "Search Synonym Groups (Page 1/", with button: "Add New Group".
Check by eye that a Next button shows when the list has more than one page.
Ephemeral: yes

### Step 25: Search still finds Chrono Trigger
```
/gamedb search title:Chrono Trigger
```
Expected: type the text and keep it. A public reply naming "Chrono Trigger", and
not: "Zqtest".
Ephemeral: no
