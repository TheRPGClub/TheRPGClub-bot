# /help test plan, part 2

The rest of `/help`: the `/round` and `/mp-info` topics and every Server Administration
topic, including the `/rss`, `/admin`, `/mod`, and `/superadmin` sub-menus and their way
back to the main menu. Part 1, `help.md`, covers the member-facing topics.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

This plan only reads help text and changes no data. Run it as the test guild's owner with
the Administrator permission: the `/admin` topic checks for Administrator, `/mod` for
Manage Messages or Administrator, and `/superadmin` for the server owner. Without those,
those three steps get an "Access denied" reply instead. No data must exist beforehand.

## Testing

### Step 1: Open the help menu
```
/help
```
Expected: a private help menu, title: "RPGClubUtils Commands", with option: "/round",
option: "/mp-info", and option: "/thread".
Ephemeral: yes

### Step 2: Open the /round topic
```
select "/round" from "Monthly Games commands"
```
Expected: the help message changes in place to title: "/round help", with
"set showinchat:true to post in channel", and not: "Parameters".
Ephemeral: yes

### Step 3: Return to the main menu
```
select "Back to Help Main Menu" from "Monthly Games commands"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/round help".
Ephemeral: yes

### Step 4: Open the /mp-info topic
```
select "/mp-info" from "Members commands"
```
Expected: the help message changes to title: "/mp-info help", with
"Filters default to all platforms", and option: "/profile".
Ephemeral: yes

### Step 5: Return to the main menu
```
select "Back to Help Main Menu" from "Members commands"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/mp-info help".
Ephemeral: yes

### Step 6: Open the /thread topic
```
select "/thread" from "Server Administration commands"
```
Expected: the help message changes to title: "/thread help", with
"Use unlink without gamedb_game_id to remove all links" and "Replies are private.".
Ephemeral: yes

### Step 7: Open the /publicreminder topic
```
select "/publicreminder" from "Server Administration commands"
```
Expected: the help message changes to title: "/publicreminder help", with
"Times parse in America/New_York".
Ephemeral: yes

### Step 8: Open the /todo topic
```
select "/todo" from "Server Administration commands"
```
Expected: the help message changes to title: "/todo help", with
"Issue descriptions and comments support image links".
Ephemeral: yes

### Step 9: Open the /rss sub-menu
```
select "/rss" from "Server Administration commands"
```
Expected: the help message changes to title: "/rss commands", with
"Choose an RSS subcommand from the dropdown", option: "/rss add", option: "/rss remove",
option: "/rss edit", and option: "/rss list".
Ephemeral: yes

### Step 10: Open the /rss edit topic
```
select "/rss edit" from "/rss help"
```
Expected: the help message changes to title: "/rss edit help", with "/rss edit id:", and
not: "Choose an RSS subcommand".
Ephemeral: yes

### Step 11: Return to the main menu from the /rss sub-menu
```
select "Back to Help Main Menu" from "/rss help"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/rss edit help".
Ephemeral: yes

### Step 12: Open the /admin sub-menu
```
select "/admin" from "Server Administration commands"
```
Expected: the help message changes to title: "Admin Commands Help", with
"command below to see what it does", option: "/admin sync", and not: "Access denied".
Ephemeral: yes

### Step 13: Open the /admin sync topic
```
select "/admin sync" from "/admin help"
```
Expected: the help message changes to title: "/admin sync help", with
"Refresh slash command registrations with Discord.".
Ephemeral: yes

### Step 14: Return to the main menu from the /admin sub-menu
```
select "Back to Help Main Menu" from "/admin help"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/admin sync help".
Ephemeral: yes

### Step 15: Open the /mod sub-menu
```
select "/mod" from "Server Administration commands"
```
Expected: the help message changes to title: "Moderator Commands Help", with
option: "/mod presence", option: "/mod presence-history", option: "/mod rerender-embed",
and not: "Access denied".
Ephemeral: yes

### Step 16: Open the /mod presence-history topic
```
select "/mod presence-history" from "/mod help"
```
Expected: the help message changes to title: "/mod presence-history help", with
"default 5, max 50".
Ephemeral: yes

### Step 17: Return to the main menu from the /mod sub-menu
```
select "Back to Help Main Menu" from "/mod help"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/mod presence-history help".
Ephemeral: yes

### Step 18: Open the /superadmin sub-menu
```
select "/superadmin" from "Server Administration commands"
```
Expected: the help message changes to title: "Superadmin Commands Help", with
option: "/superadmin completion-add-other", option: "/superadmin memberscan",
option: "/superadmin say", and not: "Access denied".
Ephemeral: yes

### Step 19: Open the /superadmin memberscan topic
```
select "/superadmin memberscan" from "/superadmin help"
```
Expected: the help message changes to title: "/superadmin memberscan help", with
"Runs in the current server".
Ephemeral: yes

### Step 20: Return to the main menu from the /superadmin sub-menu
```
select "Back to Help Main Menu" from "/superadmin help"
```
Expected: the help message changes back to title: "RPGClubUtils Commands", and
not: "/superadmin memberscan help".
Ephemeral: yes
