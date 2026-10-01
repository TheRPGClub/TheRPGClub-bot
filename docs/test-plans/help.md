# /help test plan

A pass over `/help` and the member-facing help topics: the main menu, every Monthly Games
topic but `/round`, the `/profile`, `/gamedb`, `/now-playing`, and `/game-completion`
sub-menus, `/collection`, and every Utilities topic. Each select updates the same private
help message in place. The Server Administration topics, `/round`, and `/mp-info` are in
`help-2.md`.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

This plan only reads help text and changes no data. Any member can run it; no role or
permission is needed, and no data must exist beforehand. Every reply is the one private
help message, updated in place by each select.

## Testing

### Step 1: Open the help menu
```
/help
```
Expected: a private help menu, title: "RPGClubUtils Commands", with
"Use the category dropdowns below" and a select per category listing every topic:
option: "/noms", option: "/nominate", option: "/nominate-delete", option: "/vote",
option: "/round", option: "/round-history", option: "/profile", option: "/mp-info",
option: "/gamedb", option: "/collection", option: "/now-playing",
option: "/game-completion", option: "/hltb", option: "/suggestion",
option: "/gamegiveaway", option: "/avatar-history", option: "/mod", option: "/admin",
option: "/superadmin", option: "/todo", option: "/publicreminder", option: "/thread",
option: "/rss".
Ephemeral: yes

### Step 2: Open the /noms topic
```
select "/noms" from "Monthly Games commands"
```
Expected: the help message changes in place to title: "/noms help" with "Syntax",
"Parameters", "Notes", "Replies privately by default", and
option: "Back to Help Main Menu".
Ephemeral: yes

### Step 3: Open the /nominate topic
```
select "/nominate" from "Monthly Games commands"
```
Expected: the help message changes to title: "/nominate help", with
"Running the command again updates your nomination for that category".
Ephemeral: yes

### Step 4: Open the /nominate-delete topic
```
select "/nominate-delete" from "Monthly Games commands"
```
Expected: the help message changes to title: "/nominate-delete help", with
"Only removes your own nomination".
Ephemeral: yes

### Step 5: Open the /vote topic
```
select "/vote" from "Monthly Games commands"
```
Expected: the help message changes to title: "/vote help", with "Votes are anonymous".
Ephemeral: yes

### Step 6: Open the /round-history topic
```
select "/round-history" from "Monthly Games commands"
```
Expected: the help message changes to title: "/round-history help", with
"Results are paginated at 5 rounds per page", and not: "Parameters".
Ephemeral: yes

### Step 7: Return to the main menu from a category
```
select "Back to Help Main Menu" from "Monthly Games commands"
```
Expected: the help message changes back to title: "RPGClubUtils Commands" with
option: "/hltb", and not: "/round-history help".
Ephemeral: yes

### Step 8: Open the /profile sub-menu
```
select "/profile" from "Members commands"
```
Expected: the help message changes to title: "/profile commands", with
"Choose a profile subcommand from the dropdown", option: "/profile view",
option: "/profile edit", option: "/profile search", and option: "Back to Help Main Menu".
Ephemeral: yes

### Step 9: Open the /profile search topic
```
select "/profile search" from "/profile help"
```
Expected: the help message changes to title: "/profile search help", with
"limit max 100", and not: "Choose a profile subcommand".
Ephemeral: yes

### Step 10: Return to the main menu from the /profile sub-menu
```
select "Back to Help Main Menu" from "/profile help"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/profile search help".
Ephemeral: yes

### Step 11: Open the /gamedb sub-menu
```
select "/gamedb" from "GameDB commands"
```
Expected: the help message changes to title: "/gamedb commands", with
option: "/gamedb add", option: "/gamedb csv-import", option: "/gamedb search",
option: "/gamedb view", option: "/gamedb refresh-release-info", option: "/gamedb audit",
option: "/gamedb link-versions", option: "/gamedb synonym-add", and
option: "/gamedb synonym-list".
Ephemeral: yes

### Step 12: Open the /gamedb view topic
```
select "/gamedb view" from "/gamedb help"
```
Expected: the help message changes to title: "/gamedb view help", with
"Create Now Playing Thread opens a modal", and not: "Choose a GameDB subcommand".
Ephemeral: yes

### Step 13: Return to the main menu from the /gamedb sub-menu
```
select "Back to Help Main Menu" from "/gamedb help"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/gamedb view help".
Ephemeral: yes

### Step 14: Open the /now-playing sub-menu
```
select "/now-playing" from "GameDB commands"
```
Expected: the help message changes to title: "/now-playing commands", with
option: "/now-playing list" and option: "/now-playing search".
Ephemeral: yes

### Step 15: Open the /now-playing search topic
```
select "/now-playing search" from "/now-playing help"
```
Expected: the help message changes to title: "/now-playing search help", with
"lists users currently playing those games".
Ephemeral: yes

### Step 16: Return to the main menu from the /now-playing sub-menu
```
select "Back to Help Main Menu" from "/now-playing help"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/now-playing search help".
Ephemeral: yes

### Step 17: Open the /game-completion sub-menu
```
select "/game-completion" from "GameDB commands"
```
Expected: the help message changes to title: "/game-completion commands", with
option: "/game-completion add", option: "/game-completion list",
option: "/game-completion common", option: "/game-completion edit",
option: "/game-completion delete", option: "/game-completion export", and
option: "/game-completion import-completionator".
Ephemeral: yes

### Step 18: Open the /game-completion common topic
```
select "/game-completion common" from "/game-completion help"
```
Expected: the help message changes to title: "/game-completion common help", with
"compares you against that member".
Ephemeral: yes

### Step 19: Return to the main menu from the /game-completion sub-menu
```
select "Back to Help Main Menu" from "/game-completion help"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/game-completion common help".
Ephemeral: yes

### Step 20: Open the /collection topic
```
select "/collection" from "GameDB commands"
```
Expected: the help message changes to title: "/collection help", with "Duplicate policy",
a GameDB commands select with option: "/gamedb", and not: "Parameters".
Ephemeral: yes

### Step 21: Return to the main menu from the GameDB category
```
select "Back to Help Main Menu" from "GameDB commands"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/collection help".
Ephemeral: yes

### Step 22: Open the /hltb topic
```
select "/hltb" from "Utilities commands"
```
Expected: the help message changes to title: "/hltb help", with "Parameters" and
"Title autocompletes from GameDB".
Ephemeral: yes

### Step 23: Open the /suggestion topic
```
select "/suggestion" from "Utilities commands"
```
Expected: the help message changes to title: "/suggestion help", with
"Review Suggestions button".
Ephemeral: yes

### Step 24: Open the /gamegiveaway topic
```
select "/gamegiveaway" from "Utilities commands"
```
Expected: the help message changes to title: "/gamegiveaway help", with
"keys are sent by DM".
Ephemeral: yes

### Step 25: Open the /avatar-history topic
```
select "/avatar-history" from "Utilities commands"
```
Expected: the help message changes to title: "/avatar-history help", with
"Defaults to your own avatar history.", and option: "Back to Help Main Menu".
Ephemeral: yes
