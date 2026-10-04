# /mod test plan

A full pass over `/mod`: `help` and every topic in its menu, `presence`,
`presence-history` with its count clamping, and `create-live-event` with every
validation error in its modal and one successful run.

What it changes: step 5 sets the preview bot's status, which a PR preview never saves
and resets within the hour. Step 15 creates a real thread in the test guild's Live
Events forum and a real scheduled event in the test guild, both named
"Conductor test event" for June 2027; delete both by hand afterwards. Every other step
changes nothing and is safe to repeat.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Run it in #dev as a member with Manage Messages or Administrator in the test guild (the
guild owner works). The bot's presence history must hold at least 5 entries. No
scheduled event or Live Events thread named "Conductor test event" should exist
beforehand. The access denial reply, "Access denied. Command requires Moderator role or
above.", needs a second account without those permissions and is not covered here.

## Testing

### Step 1: Open the moderator help menu
```
/mod help
```
Expected: an ephemeral reply, title: "Moderator Commands Help", with
"command to see what it does and how to run it." and option: "/mod presence", option:
"/mod presence-history", and option: "Back to Help Main Menu".
Ephemeral: yes

### Step 2: Show the presence help topic
```
select "/mod presence"
```
Expected: the help message changes in place to title: "/mod presence help", with
"Syntax" and "text (required string) - new presence text."
Ephemeral: yes

### Step 3: Show the presence-history help topic
```
select "/mod presence-history"
```
Expected: the help message changes in place to title: "/mod presence-history help", with
"count (optional integer, default 5, max 50)".
Ephemeral: yes

### Step 4: Go back to the main help menu
```
select "Back to Help Main Menu"
```
Expected: the help message changes in place to title: "RPGClubUtils Commands", listing
"Moderator tools.".
Ephemeral: yes

### Step 5: Set the bot's presence
```
/mod presence text:Chrono Trigger
```
Expected: an ephemeral reply, "I'm now playing: Chrono Trigger!" and
"PR preview: not saved, and the preview status returns within the hour." Check by eye
that the preview bot's status reads Chrono Trigger.
Ephemeral: yes

### Step 6: Show the default presence history
```
/mod presence-history
```
Expected: an ephemeral reply, "Last 5 presence entries:", each line naming who set it,
"(set by", and not: "No presence history found.". The preview presence from step 5 is
not in it.
Ephemeral: yes

### Step 7: Clamp a count below 1
```
/mod presence-history count:0
```
Expected: an ephemeral reply, "Last 1 presence entry:", with one line.
Ephemeral: yes

### Step 8: Clamp a count above 50
```
/mod presence-history count:100
```
Expected: an ephemeral reply, "presence entries:", with at most 50 lines, and not:
"Last 100".
Ephemeral: yes

### Step 9: Submit the live event modal with a bad start
```
/mod create-live-event
enter "Conductor test event" in "Event Topic",
enter "tomorrow" in "Start (YYYY-MM-DD HH:mm)",
enter "2027-06-01 23:00" in "End (YYYY-MM-DD HH:mm)",
enter "America/New_York" in "Time Zone (IANA)",
submit
```
Expected: an ephemeral reply, "Start must use", naming the 24-hour format. Nothing is
created.
Ephemeral: yes

### Step 10: Submit the live event modal with a bad end
```
/mod create-live-event
enter "Conductor test event" in "Event Topic",
enter "2027-06-01 21:00" in "Start (YYYY-MM-DD HH:mm)",
enter "11pm" in "End (YYYY-MM-DD HH:mm)",
enter "America/New_York" in "Time Zone (IANA)",
submit
```
Expected: an ephemeral reply, "End must use", naming the 24-hour format. Nothing is
created.
Ephemeral: yes

### Step 11: Submit the live event modal with a bad time zone
```
/mod create-live-event
enter "Conductor test event" in "Event Topic",
enter "2027-06-01 21:00" in "Start (YYYY-MM-DD HH:mm)",
enter "2027-06-01 23:00" in "End (YYYY-MM-DD HH:mm)",
enter "Mars/Olympus" in "Time Zone (IANA)",
submit
```
Expected: an ephemeral reply, "Time Zone must be a valid IANA zone such as". Nothing is
created.
Ephemeral: yes

### Step 12: Submit the live event modal with an impossible date
```
/mod create-live-event
enter "Conductor test event" in "Event Topic",
enter "2027-02-30 21:00" in "Start (YYYY-MM-DD HH:mm)",
enter "2027-06-01 23:00" in "End (YYYY-MM-DD HH:mm)",
enter "America/New_York" in "Time Zone (IANA)",
submit
```
Expected: an ephemeral reply,
"Start does not form a valid timestamp in the selected Time Zone." Nothing is created.
Ephemeral: yes

### Step 13: Submit the live event modal with the end before the start
```
/mod create-live-event
enter "Conductor test event" in "Event Topic",
enter "2027-06-01 23:00" in "Start (YYYY-MM-DD HH:mm)",
enter "2027-06-01 21:00" in "End (YYYY-MM-DD HH:mm)",
enter "America/New_York" in "Time Zone (IANA)",
submit
```
Expected: an ephemeral reply, "End must be after Start." Nothing is created.
Ephemeral: yes

### Step 14: Submit the live event modal with a bad image URL
```
/mod create-live-event
enter "Conductor test event" in "Event Topic",
enter "2027-06-01 21:00" in "Start (YYYY-MM-DD HH:mm)",
enter "2027-06-01 23:00" in "End (YYYY-MM-DD HH:mm)",
enter "America/New_York" in "Time Zone (IANA)",
enter "notaurl" in "Optional Thread Image URL",
submit
```
Expected: an ephemeral reply, "Optional Thread Image URL must be a valid URL." Nothing
is created.
Ephemeral: yes

### Step 15: Create a live event
```
/mod create-live-event
enter "Conductor test event" in "Event Topic",
enter "2027-06-01 21:00" in "Start (YYYY-MM-DD HH:mm)",
enter "2027-06-01 23:00" in "End (YYYY-MM-DD HH:mm)",
enter "America/New_York" in "Time Zone (IANA)",
submit
```
Expected: an ephemeral reply, "Created live event resources.", with "Thread:", "Event:",
and "Scheduled: America/New_York", and not: "creation failed". The Live Events forum
gets a thread, Conductor test event, whose first post reads "Live event discussion for",
and the guild gets a scheduled event linking to it. Delete both by hand.
Ephemeral: yes
