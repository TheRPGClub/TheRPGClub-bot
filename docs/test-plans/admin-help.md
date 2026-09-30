# /admin help and sync test plan

A pass over `/admin help`, every topic in its help menu, the menu's way back to the main
help, and `/admin sync`. It is one of four `/admin` plans; the others are
`admin-voting.md`, `admin-rounds.md`, and `admin-nominations.md`.

It changes no club data. `/admin sync` re-registers the preview bot's slash commands with
Discord, which the preview already does on startup. Every step is safe to repeat.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Run it as a member with the Administrator permission in the test guild (the guild owner
works). No data must exist beforehand. The access denial reply for non-admins,
"Access denied. Command requires Administrator role.", needs a second account and is not
covered here.

## Testing

### Step 1: Open the admin help menu
```
/admin help
```
Expected: an ephemeral reply, title: "Admin Commands Help", with
"command below to see what it does and how to use it." and a topic menu holding
option: "/admin sync", option: "/admin votes-reset", and option: "Back to Help Main Menu".
Ephemeral: yes

### Step 2: Show the sync help topic
```
select "/admin sync"
```
Expected: the help message changes in place to title: "/admin sync help", with
"Refresh slash command registrations with Discord.", "Syntax", and
"Use after updating command choices or definitions.".
Ephemeral: yes

### Step 3: Show the add-gotm help topic
```
select "/admin add-gotm"
```
Expected: the help message changes in place to title: "/admin add-gotm help", with
"Add the next GOTM round with guided prompts.", "Syntax", and
"Round number is auto-assigned to the next open round.".
Ephemeral: yes

### Step 4: Show the edit-gotm help topic
```
select "/admin edit-gotm"
```
Expected: the help message changes in place to title: "/admin edit-gotm help", with
"Update details for a specific GOTM round.", "Syntax", and "Parameters" and
"GOTM round to edit".
Ephemeral: yes

### Step 5: Show the add-nr-gotm help topic
```
select "/admin add-nr-gotm"
```
Expected: the help message changes in place to title: "/admin add-nr-gotm help", with
"Add the next NR-GOTM round with guided prompts.", "Syntax", and
"auto-assigned to the next open NR-GOTM round".
Ephemeral: yes

### Step 6: Show the edit-nr-gotm help topic
```
select "/admin edit-nr-gotm"
```
Expected: the help message changes in place to title: "/admin edit-nr-gotm help", with
"Update details for a specific NR-GOTM round.", "Syntax", and "Parameters" and
"NR-GOTM round to edit".
Ephemeral: yes

### Step 7: Show the delete-gotm-noms help topic
```
select "/admin delete-gotm-noms"
```
Expected: the help message changes in place to title: "/admin delete-gotm-noms help", with
"Interactive panel to delete GOTM nominations.", "Syntax", and
"Submitting the modal deletes the nomination immediately.".
Ephemeral: yes

### Step 8: Show the delete-nr-gotm-noms help topic
```
select "/admin delete-nr-gotm-noms"
```
Expected: the help message changes in place to title: "/admin delete-nr-gotm-noms help", with
"Interactive panel to delete NR-GOTM nominations.", "Syntax", and "a required reason prompt".
Ephemeral: yes

### Step 9: Show the set-nextvote help topic
```
select "/admin set-nextvote"
```
Expected: the help message changes in place to title: "/admin set-nextvote help", with
"Reschedule when voting opens for the current round.", "Syntax", and
"/admin set-nextvote date:<date>" and "America/New_York".
Ephemeral: yes

### Step 10: Show the legacy-voting-setup help topic
```
select "/admin legacy-voting-setup"
```
Expected: the help message changes in place to title: "/admin legacy-voting-setup help", with
"Build ready-to-paste Subo /poll commands from current nominations.", "Syntax", and
"Fallback for when first-party voting is unavailable.".
Ephemeral: yes

### Step 11: Show the voting-open help topic
```
select "/admin voting-open"
```
Expected: the help message changes in place to title: "/admin voting-open help", with
"Repost the voting panels for the round currently open for votes.", "Syntax", and
"testmode rehearses instead".
Ephemeral: yes

### Step 12: Show the voting-close help topic
```
select "/admin voting-close"
```
Expected: the help message changes in place to title: "/admin voting-close help", with
"Close the open voting round early.", "Syntax", and "Moves the round's close to now.".
Ephemeral: yes

### Step 13: Show the voting-results help topic
```
select "/admin voting-results"
```
Expected: the help message changes in place to title: "/admin voting-results help", with
"Show the GOTM and NR-GOTM vote tallies for a round.", "Syntax", and
"Tallies stay hidden (totals only) until voting ends".
Ephemeral: yes

### Step 14: Show the votes-reset help topic
```
select "/admin votes-reset"
```
Expected: the help message changes in place to title: "/admin votes-reset help", with
"Delete all first-party votes for a round and category.", "Syntax", and
"Asks for confirmation. This cannot be undone.".
Ephemeral: yes

### Step 15: Go back to the main help menu
```
select "Back to Help Main Menu"
```
Expected: the help message changes in place to the bot-wide help,
title: "RPGClubUtils Commands", listing "Server Administration" and "Admin tools.".
Ephemeral: yes

### Step 16: Sync the application commands
```
/admin sync
```
Expected: after up to 30 seconds, an ephemeral reply, "Commands synchronized with Discord.",
and not: "Failed to sync commands".
Ephemeral: yes
