# /gamegiveaway test plan

A full pass over `/gamegiveaway` and the giveaway hub it links to: the Donor Settings
panel and its notify toggle, the Donate a Game modal, and the Claim a Game flow through
cancel, confirm, and a stale pick list. It runs against real data: it donates one test key
to the shared giveaway pool, then claims that same key, so the pool ends as it started.
It also turns your donor notify setting on and back off, and the claim writes one
"Giveaway claim" line to the console log channel.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it, make sure:
- you have the Member role in the test guild (claiming checks for it);
- your DMs are open to members of the test guild (the claimed key is sent by DM);
- your donor notify setting is Off (the default); if Donor Settings shows On, click No first;
- the giveaway hub message is in the giveaway hub channel (the preview bot posts it at
  startup) and no key titled "Chrono Trigger Conductor Test" is in the pool yet.

The hub buttons live on that public hub message. Every reply they produce is ephemeral.

## Testing

### Step 1: Ask for the giveaway hub
```
/gamegiveaway
```
Expected: an ephemeral reply, "Use the giveaway hub here:" with a link to the giveaway
hub channel.
Ephemeral: yes

### Step 2: Open Donor Settings
```
click "Donor Settings" on the giveaway hub message
```
Expected: an ephemeral panel with "Your donated keys:",
"Notify you when your donated keys are claimed?", "Current setting:" showing Off,
button: "Yes", and button: "No" (No is disabled).
Ephemeral: yes

### Step 3: Turn donor notifications on
```
click "Yes"
```
Expected: the panel shows "Your donated keys:" and "Current setting:" now showing On, with
button: "No" enabled and Yes disabled. It may change in place or arrive as a new reply.
Ephemeral: yes

### Step 4: Turn donor notifications back off
```
click "No"
```
Expected: the panel shows "Current setting:" showing Off again, with button: "Yes"
enabled and No disabled.
Ephemeral: yes

### Step 5: Donate a test key
```
click "Donate a Game" on the giveaway hub message
enter "Chrono Trigger Conductor Test" in "Game title"
enter "Steam" in "Platform (Steam, Epic, GOG, etc.)"
enter "CONDUCTOR-TEST-NOT-A-REAL-KEY" in "Game key", submit
```
Expected: an ephemeral reply, "Thanks! Added", "Chrono Trigger Conductor Test", and
"to the giveaway pool" with a Key ID. Check by eye that the hub message now lists it.
Ephemeral: yes

### Step 6: See the donation in Donor Settings
```
click "Donor Settings" on the giveaway hub message
```
Expected: an ephemeral panel, "Your donated keys:", listing
"Chrono Trigger Conductor Test" and "Steam".
Ephemeral: yes

### Step 7: Open the claim picker
```
click "Claim a Game" on the giveaway hub message
```
Expected: an ephemeral reply, "Pick a key to claim:", with a Claim a key picker and
option: "Chrono Trigger Conductor Test".
Ephemeral: yes

### Step 8: Pick the test key
```
select "Chrono Trigger Conductor Test"
```
Expected: an ephemeral confirm, "You are about to claim", "Chrono Trigger Conductor Test",
"Are you sure?", button: "Yes", and button: "No".
Ephemeral: yes

### Step 9: Cancel the claim
```
click "No"
```
Expected: the confirm changes to "Claim cancelled.", with no buttons left.
Ephemeral: yes

### Step 10: Open a claim picker to leave unused
```
click "Claim a Game" on the giveaway hub message
```
Expected: an ephemeral reply, "Pick a key to claim:", with
option: "Chrono Trigger Conductor Test". Leave this picker alone until step 14.
Ephemeral: yes

### Step 11: Open a second claim picker
```
click "Claim a Game" on the giveaway hub message
```
Expected: another ephemeral reply, "Pick a key to claim:", with
option: "Chrono Trigger Conductor Test".
Ephemeral: yes

### Step 12: Pick the test key on the second picker
```
select "Chrono Trigger Conductor Test" on the picker from step 11
```
Expected: an ephemeral confirm, "You are about to claim", "Chrono Trigger Conductor Test",
"Are you sure?", with button: "Yes".
Ephemeral: yes

### Step 13: Confirm the claim
```
click "Yes"
```
Expected: an ephemeral follow-up, "Your key was sent by DM.",
"Thanks for claiming responsibly.", and not: "I could not send you a DM". Check by eye
that your DMs hold a You claimed message with CONDUCTOR-TEST-NOT-A-REAL-KEY, and that the console
log channel shows a Giveaway claim line for it.
Ephemeral: yes

### Step 14: Pick the claimed key on the stale picker
```
select "Chrono Trigger Conductor Test" on the picker from step 10
```
Expected: an ephemeral reply, "That key is no longer available.", and
not: "Are you sure?".
Ephemeral: yes

### Step 15: Confirm the key left the pool
```
click "Claim a Game" on the giveaway hub message
```
Expected: an ephemeral reply, either the pick list with the other keys or a note that
there are no available game keys, and not: "Chrono Trigger Conductor Test".
If the pool is now empty the button is disabled; confirm that by eye instead.
Ephemeral: yes

### Step 16: Confirm the donation no longer shows as available
```
click "Donor Settings" on the giveaway hub message
```
Expected: an ephemeral panel, "Your donated keys:" and "Current setting:" showing Off,
and not: "Chrono Trigger Conductor Test".
Ephemeral: yes
