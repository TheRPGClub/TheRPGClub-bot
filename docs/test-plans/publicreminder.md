# /publicreminder test plan

A full pass over `/publicreminder create`, `list`, and `delete`, including every input error
`create` can return. It runs against real data: it schedules two reminders far in the future
(one one-time, one weekly) and deletes both again before the plan ends, so neither fires.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it, make sure you have the Administrator permission in the test guild; every
subcommand checks for it. No reminder with the message "zztest" should exist yet.
Steps 7 and 8 print two reminder numbers; note them, because steps 10 and 11 delete
those exact reminders. For the channel option, pick the dev channel from the channel picker.

## Testing

### Step 1: List the upcoming reminders
```
/publicreminder list
```
Expected: an ephemeral reply with either the upcoming reminders or
"No public reminders scheduled.", and not: "Access denied", not: "Failed to list reminders".
Ephemeral: yes

### Step 2: Create a reminder with a date that cannot be parsed
```
/publicreminder create channel:#dev date:tomorrow time:9:00 AM message:zztest
```
Expected: an ephemeral error, "Could not parse the date and time" and
"Please use formats like".
Ephemeral: yes

### Step 3: Create a reminder with a time that cannot be parsed
```
/publicreminder create channel:#dev date:1/1/2030 time:noon message:zztest
```
Expected: an ephemeral error, "Could not parse the date and time", naming "1/1/2030 noon".
Ephemeral: yes

### Step 4: Create a reminder in the past
```
/publicreminder create channel:#dev date:1/1/2020 time:15:30 message:zztest
```
Expected: an ephemeral error, "The reminder time must be in the future.", and
not: "Created reminder".
Ephemeral: yes

### Step 5: Give recur without recurunit
```
/publicreminder create channel:#dev date:1/1/2030 time:15:30 message:zztest recur:1
```
Expected: an ephemeral error, "Please specify recurunit when recur is provided.", and
not: "Created reminder".
Ephemeral: yes

### Step 6: Give a negative recur
```
/publicreminder create channel:#dev date:1/1/2030 time:15:30 message:zztest recur:-1 recurunit:Days
```
Expected: an ephemeral error, "Recur must be a positive integer.", and
not: "Created reminder".
Ephemeral: yes

### Step 7: Create a one-time reminder
```
/publicreminder create channel:#dev date:1/1/2030 time:9:00 AM message:zztest
```
Expected: an ephemeral reply, "Created reminder #" with a number, the dev channel and
January 1, 2030 9:00 AM Eastern shown in your local time, and not: "repeats every".
Note the number for step 10.
Ephemeral: yes

### Step 8: Create a weekly reminder with the ISO date and 24-hour formats
```
/publicreminder create channel:#dev date:2030-1-2 time:15:30 message:zztest recur:1 recurunit:Weeks
```
Expected: an ephemeral reply, "Created reminder #" with a number, January 2, 2030 3:30 PM
Eastern in your local time, and "(repeats every 1 weeks)". Note the number for step 11.
Ephemeral: yes

### Step 9: See both reminders in the list
```
/publicreminder list
```
Expected: an ephemeral list with two lines for "zztest", one of them with
"repeats every 1 weeks", each starting with the numbers from steps 7 and 8.
Ephemeral: yes

### Step 10: Delete the one-time reminder
```
/publicreminder delete id:(the number step 7 printed)
```
Expected: an ephemeral reply, "Deleted reminder #" with that number, and not: "not found".
Ephemeral: yes

### Step 11: Delete the weekly reminder
```
/publicreminder delete id:(the number step 8 printed)
```
Expected: an ephemeral reply, "Deleted reminder #" with that number, and not: "not found".
Ephemeral: yes

### Step 12: Delete a reminder that does not exist
```
/publicreminder delete id:999999999
```
Expected: an ephemeral reply, "Reminder #999999999 not found.", and not: "Deleted reminder".
Ephemeral: yes

### Step 13: Confirm the test reminders are gone
```
/publicreminder list
```
Expected: an ephemeral reply with the remaining reminders or
"No public reminders scheduled.", and not: "zztest".
Ephemeral: yes
