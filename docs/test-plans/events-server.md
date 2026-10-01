# Event handlers test plan: server change log

A pass over the server change log: the posts the bot makes when a role, channel, emoji,
or the server itself is created, changed, or deleted, and the role added and removed log
for a member. None of these has a slash command, so each step is an action you take in
Discord's server settings, and its `Expected:` says what appears in the log channel.

The message, reaction, nickname, and forum handlers are in `events.md`. The member join,
leave, kick, and ban logs are in `events-members.md`.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`. The bot
posts these results in the log channel, `DISCORD_LOG_CHANNEL_ID`
(<#1547802425295896620>), not as replies to your interactions, so the conductor cannot
see them: confirm each step by eye with Looks right.

It only changes the test guild. It creates a role, a text channel, and an emoji, and
deletes each one again, and renames the server and puts the name back.

Preconditions:

- You are the test guild's owner, or hold Manage Roles, Manage Channels, Manage
  Expressions, and Manage Server there.
- No role named "Event Plan Role", no channel named "event-plan-channel", and no emoji
  named "eventplan" exist yet.
- You have a small square image (PNG, under 256 KB) to upload as an emoji, and you know
  the test guild's current name.

## Testing

### Step 1: Create a role
```
in Server Settings, Roles, create a role and save it with the default name
```
Expected: the log channel gets a post, title: "Role created", naming the new role.
Ephemeral: no

### Step 2: Rename the role
```
rename the new role to "Event Plan Role" and save
```
Expected: the log channel gets a post, title: "Role updated", with "Name:" and
"-> Event Plan Role".
Ephemeral: no

### Step 3: Make the role hoisted
```
turn on "Display role members separately" for Event Plan Role and save
```
Expected: the log channel gets a post, title: "Role updated", with
"Hoist:" "false -> true".
Ephemeral: no

### Step 4: Give yourself the role
```
add Event Plan Role to yourself
```
Expected: the log channel gets a post, title: "Role added", naming Event Plan Role.
Ephemeral: no

### Step 5: Take the role off yourself
```
remove Event Plan Role from yourself
```
Expected: the log channel gets a post, title: "Role removed", naming Event Plan Role.
Ephemeral: no

### Step 6: Delete the role
```
delete Event Plan Role
```
Expected: the log channel gets a post, title: "Role deleted", with "Event Plan Role".
Ephemeral: no

### Step 7: Create a text channel
```
create a text channel named "event-plan-channel"
```
Expected: the log channel gets a post, title: "Channel created", linking the new
channel.
Ephemeral: no

### Step 8: Set the channel topic
```
set the topic of event-plan-channel to "Event plan topic" and save
```
Expected: the log channel gets a post, title: "Channel updated", with "Topic:" and
"None -> Event plan topic".
Ephemeral: no

### Step 9: Turn on slowmode
```
set slowmode on event-plan-channel to 5 seconds and save
```
Expected: the log channel gets a post, title: "Channel updated", with
"Slowmode:" "0 -> 5".
Ephemeral: no

### Step 10: Delete the channel
```
delete event-plan-channel
```
Expected: the log channel gets a post, title: "Channel deleted", with
"event-plan-channel".
Ephemeral: no

### Step 11: Upload an emoji
```
in Server Settings, Emoji, upload your image and name it "eventplan"
```
Expected: the log channel gets a post, title: "Emoji created", showing the emoji.
Ephemeral: no

### Step 12: Rename the emoji
```
rename the eventplan emoji to "eventplan2"
```
Expected: the log channel gets a post, title: "Emoji updated", with "Name:" and
"eventplan -> eventplan2".
Ephemeral: no

### Step 13: Delete the emoji
```
delete the eventplan2 emoji
```
Expected: the log channel gets a post, title: "Emoji deleted", with "eventplan2".
Ephemeral: no

### Step 14: Rename the server
```
in Server Settings, Overview, rename the server to "Event Plan Server" and save
```
Expected: the log channel gets a post, title: "Server updated", with "Name:" and
"-> Event Plan Server".
Ephemeral: no

### Step 15: Put the server name back
```
rename the server back to its name from before step 14 and save
```
Expected: the log channel gets a post, title: "Server updated", with
"Name:" and "Event Plan Server ->" followed by the original name.
Ephemeral: no
