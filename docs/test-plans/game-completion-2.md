# /game-completion list, common, and export test plan

Part 2 of the `/game-completion` plans. It covers `list` with every option, its year
filter, header button, and leaderboard picker, `common` with every filter and its errors,
the "Compare completions" user context menu, and `export`. It runs against real data: it
logs one Chrono Trigger completion dated 2024-03-15 with the announcement off, so the
views have a known row, and deletes it again at the end.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.
Long commands wrap onto a second line here; type each one as a single command.

Before running it:

- Any member can run it; no admin rights are needed.
- You must not already have a Chrono Trigger completion, and Chrono Trigger must not be in
  your Now Playing list.
- You must have no completions dated 1901, and RPGClubbot (Preview) must have none at all.

## Testing

### Step 1: Log the Chrono Trigger completion
```
/game-completion add title:Chrono Trigger completion_type:Main Story platform:SNES
completion_date:2024-03-15 announce:false
```
Expected: pick the title and platform from autocomplete. A private reply,
"Logged completion for" and "Chrono Trigger".
Ephemeral: yes

### Step 2: List your completions publicly
```
/game-completion list
```
Expected: a public list, title: "Completed Games", with a header button labelled with your
name, a "2024" year heading, "Chrono Trigger", and
"M = Main Story • M+S = Main Story + Side Content • C = Completionist".
Ephemeral: no

### Step 3: List privately with a year filter
```
/game-completion list year:2024 private:true
```
Expected: a list visible only to you with "Year filter: 2024", "Chrono Trigger", and
button: "Clear Filter".
Ephemeral: yes

### Step 4: Clear the year filter
```
click "Clear Filter"
```
Expected: the same message changes in place to your full list, title: "Completed Games",
with "Chrono Trigger" and not: "Year filter:".
Ephemeral: yes

### Step 5: Filter by a year that is not a number
```
/game-completion list year:abc
```
Expected: a public error, "Year must be a valid integer (e.g., 2024) or 'unknown'."
Ephemeral: no

### Step 6: Filter by a year with no completions
```
/game-completion list year:1901 private:true
```
Expected: a private reply, "You have no recorded completions for 1901."
Ephemeral: yes

### Step 7: Search your list
```
/game-completion list query:Chrono private:true
```
Expected: a private list, title: "Completed Games", with "Query:" and "Chrono Trigger".
Ephemeral: yes

### Step 8: Open the list help from the header
```
click the header button labelled with your name
```
Expected: a new private reply, "Game Completion Commands", listing
"/game-completion common".
Ephemeral: yes

### Step 9: View a member with no completions
```
/game-completion list member:@RPGClubbot (Preview)
```
Expected: a public reply, "You have no recorded completions yet." (it says You even for
another member).
Ephemeral: no

### Step 10: Show the leaderboard
```
/game-completion list all:true
```
Expected: a public reply, "Game Completion Leaderboard", with a line for you and a
View completions for a member picker.
Ephemeral: no

### Step 11: Open your list from the leaderboard
```
select your own name in "View completions for a member"
```
Expected: a new public reply, title: "Completed Games", with "Chrono Trigger".
Ephemeral: no

### Step 12: Filter the leaderboard by title
```
/game-completion list all:true query:Chrono Trigger private:true
```
Expected: a private reply, "Game Completion Leaderboard", with "Filter:" and a line for
you.
Ephemeral: yes

### Step 13: Filter the leaderboard by a title nobody finished
```
/game-completion list all:true query:zzqqxx
```
Expected: a public reply, "No completions found matching" and "zzqqxx".
Ephemeral: no

### Step 14: Compare without naming a member
```
/game-completion common
```
Expected: a public error,
"Pick at least one member (`member_one` or `member_two`) to compare with."
Ephemeral: no

### Step 15: Compare yourself with yourself
```
/game-completion common member_one:@yourself
```
Expected: pick yourself for member_one. A public reply, "Shared Completions", with
"Chrono Trigger" and "game completions in common." Every one of your completed games is
shared, since both sides are you.
Ephemeral: no

### Step 16: Compare with every filter set
```
/game-completion common member_one:@yourself member_two:@yourself sort:Title (A-Z)
year:2024 platform:SNES query:Chrono private:true
```
Expected: pick the platform from autocomplete. A private reply, "Shared Completions",
"Year: 2024", "Platform:", "Query:", and "Chrono Trigger".
Ephemeral: yes

### Step 17: Compare with a bad year
```
/game-completion common member_one:@yourself year:abc
```
Expected: a public error, "Year must be a valid integer (e.g., 2024) or 'unknown'."
Ephemeral: no

### Step 18: Compare with a platform that does not exist
```
/game-completion common member_one:@yourself platform:zzqqxx private:true
```
Expected: type the platform by hand. A private error, "Invalid platform selection."
Ephemeral: yes

### Step 19: Compare with a member who shares nothing
```
/game-completion common member_one:@RPGClubbot (Preview) private:true
```
Expected: a private reply, "No shared completions matched those filters."
Ephemeral: yes

### Step 20: Compare with yourself from the context menu
```
right-click your own name in the member list, Apps, Compare completions
```
Expected: a private reply, "Shared Completions", with "Chrono Trigger".
Ephemeral: yes

### Step 21: Export your completions
```
/game-completion export
```
Expected: a private reply, "Here is your completion data export", with a completions.csv
file attached that includes the Chrono Trigger row.
Ephemeral: yes

### Step 22: Open the delete picker for Chrono Trigger
```
/game-completion delete title:Chrono Trigger
```
Expected: a private list with option: "Chrono Trigger" in the Select a completion to
delete picker.
Ephemeral: yes

### Step 23: Delete the test completion
```
select "Chrono Trigger" in "Select a completion to delete"
```
Expected: a private reply, "Deleted completion #".
Ephemeral: yes
