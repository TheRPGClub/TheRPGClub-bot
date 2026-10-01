# /superadmin test plan

A full pass over `/superadmin help`, `say`, and `completion-add-other`, and every select
their replies lead to, plus the owner-only denial for `memberscan`,
`download-missing-images`, and `say`. It runs against real data: it posts two messages in
the test channel and logs, then deletes, a real Chrono Trigger completion on your own
profile with the announcement turned off.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Preconditions:

- You are the test guild's owner. Every `/superadmin` command checks for the server owner.
- Your profile has no Chrono Trigger completion, and Chrono Trigger is not in your Now
  Playing list. Step 19 logs one, which also removes the game from Now Playing, and
  steps 20 and 21 delete it again.
- For steps 22 to 24 you need a second Discord account in the test guild that is not
  the owner. The conductor only credits the tester's own replies, so confirm those three
  steps by eye with Looks right.

Never run `/superadmin memberscan` or `/superadmin download-missing-images` as the owner
from a preview. A preview writes to the same API as production: `memberscan` marks every
member who is not in the test guild as departed, and `download-missing-images` asks the
API to refresh images for every GameDB title without one. This plan only runs their
denial paths.

## Testing

### Step 1: Open the superadmin help
```
/superadmin help
```
Expected: an ephemeral help panel, title: "Superadmin Commands Help", with
"(server owner only)" and a picker holding option: "/superadmin memberscan",
option: "/superadmin say", and option: "Back to Help Main Menu".
Ephemeral: yes

### Step 2: Show the say help topic
```
select "/superadmin say"
```
Expected: the help panel changes in place, title: "/superadmin say help", with
"Syntax: /superadmin say message:" and "If not, channel_id is required.".
Ephemeral: yes

### Step 3: Show the memberscan help topic
```
select "/superadmin memberscan"
```
Expected: the help panel changes in place, title: "/superadmin memberscan help", with
"Syntax: /superadmin memberscan" and "Runs in the current server.".
Ephemeral: yes

### Step 4: Show the completion-add-other help topic
```
select "/superadmin completion-add-other"
```
Expected: the help panel changes in place, title: "/superadmin completion-add-other help",
with "Uses a search query to find or import the game, then prompts for a platform.".
Ephemeral: yes

### Step 5: Go back to the main help menu
```
select "Back to Help Main Menu"
```
Expected: the panel changes in place to the main help, title: "RPGClubUtils Commands",
listing "Server Owner tools.".
Ephemeral: yes

### Step 6: Say with no channel and no message id
```
/superadmin say message:Superadmin say test
```
Expected: an ephemeral error, "Channel ID is required when no message id is provided.".
Nothing is posted.
Ephemeral: yes

### Step 7: Say to a channel id that does not exist
```
/superadmin say message:Superadmin say test channel_id:123
```
Expected: an ephemeral error, "Channel not found or not a text channel.".
Ephemeral: yes

### Step 8: Say in the test channel
```
/superadmin say message:Superadmin say test channel_id:1547802425086312558
```
Expected: an ephemeral "Message sent.", and the bot posts a plain message reading
Superadmin say test in the test channel (check by eye; it is not an interaction reply).
Ephemeral: yes

### Step 9: Reply to a message id that does not exist here
```
/superadmin say message:Superadmin reply test message_id:1
```
Expected: an ephemeral error, "Message not found in that channel.".
Ephemeral: yes

### Step 10: Reply with a message id and a bad channel id
```
/superadmin say message:Superadmin reply test message_id:1 channel_id:123
```
Expected: an ephemeral error, "Channel not found for that message id.".
Ephemeral: yes

### Step 11: Reply to the step 8 message
```
/superadmin say message:Superadmin reply test
message_id: the ID of the bot's Superadmin say test message from step 8
```
Expected: an ephemeral "Reply sent.", and the bot replies to its Superadmin say test
message with Superadmin reply test (check by eye).
Ephemeral: yes

### Step 12: Add a completion with a bad date
```
/superadmin completion-add-other user:@yourself completion_type:Main Story title:Chrono Trigger
completion_date:notadate
```
Expected: pick yourself for user. An ephemeral error,
"Could not parse completion date. Use YYYY-MM-DD, or 'today'/'unknown'.".
Ephemeral: yes

### Step 13: Add a completion with negative playtime
```
/superadmin completion-add-other user:@yourself completion_type:Main Story title:Chrono Trigger
final_playtime_hours:-5
```
Expected: an ephemeral error, "Final playtime must be a non-negative number of hours.".
Ephemeral: yes

### Step 14: Add a completion for a title no one has heard of
```
/superadmin completion-add-other user:@yourself completion_type:Main Story title:zzqqxx
```
Expected: the ephemeral reply shows Searching IGDB briefly, then
"No GameDB or IGDB matches found for" and "zzqqxx". Nothing is saved.
Ephemeral: yes

### Step 15: Start a completion for Chrono Trigger
```
/superadmin completion-add-other user:@yourself completion_type:Main Story title:Chrono Trigger
completion_date:2026-01-15 final_playtime_hours:30 announce:False
```
Expected: an ephemeral game picker, "Select the game for", with option: "Chrono Trigger"
and option: "Import another game from IGDB".
Ephemeral: yes

### Step 16: Choose to import from IGDB instead
```
select "Import another game from IGDB"
```
Expected: the picker changes to "Found results on IGDB. See message below." and a new
ephemeral message follows, "No GameDB match; select an IGDB result to import for". Do not
pick an IGDB result: importing would create a real GameDB entry.
Ephemeral: yes

### Step 17: Start the Chrono Trigger completion again
```
/superadmin completion-add-other user:@yourself completion_type:Main Story title:Chrono Trigger
completion_date:2026-01-15 final_playtime_hours:30 announce:False
```
Expected: the same ephemeral game picker as step 15, "Select the game for", with
option: "Chrono Trigger".
Ephemeral: yes

### Step 18: Pick Chrono Trigger
```
select "Chrono Trigger"
```
Expected: the picker changes in place to "Select the platform for" naming
"Chrono Trigger", with a platform select that ends in option: "Other".
Ephemeral: yes

### Step 19: Pick the Other platform
```
select "Other"
```
Expected: an ephemeral "Logged completion for" naming "Chrono Trigger" with
"Main Story" and "30 hours". The test channel also gets a public notice, Unknown
completion platform selected, naming Chrono Trigger. Nothing is announced.
Ephemeral: yes

### Step 20: Find the completion to delete it
```
/game-completion delete title:Chrono Trigger
```
Expected: an ephemeral "Completed Games" list with a picker,
"Select a completion to delete", and option: "Chrono Trigger".
Ephemeral: yes

### Step 21: Delete the completion
```
select "Chrono Trigger"
```
Expected: an ephemeral "Deleted completion #" reply, and the picker is cleared.
Ephemeral: yes

### Step 22: Memberscan is denied to a non-owner
```
from your second account:
/superadmin memberscan
```
Expected: an ephemeral denial on the second account,
"Access denied. Command is restricted to the server owner.". Nothing is scanned.
Ephemeral: yes

### Step 23: Download-missing-images is denied to a non-owner
```
from your second account:
/superadmin download-missing-images
```
Expected: an ephemeral denial on the second account,
"Access denied. Command is restricted to the server owner.". Nothing is downloaded.
Ephemeral: yes

### Step 24: Say is denied to a non-owner
```
from your second account:
/superadmin say message:Denied test channel_id:1547802425086312558
```
Expected: an ephemeral denial on the second account,
"Access denied. Command is restricted to the server owner.", and not: "Message sent.".
Ephemeral: yes
