# Event handlers test plan: messages, reactions, and names

A pass over the bot's reactions to things you do yourself: the message edit and delete
logs, the pushpin reaction, the owner's plus-sign completion flow with its Change title
modal and selects, the link preview fallback, the nickname and display name logs, and the
Now Playing forum announcement. None of these has a slash command, so each step is an
action you take in Discord, and its `Expected:` says what appears and in which channel.

The member join, leave, kick, and ban logs need a second account and are in
`events-members.md`. The role, channel, emoji, and server change logs are in
`events-server.md`.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`. The bot
posts these results in log channels or as plain messages, not as replies to your
interactions, so the conductor cannot see them: confirm each step by eye with Looks right.

Channels in the test guild, by the constant that names them:

- test channel, `BOT_DEV_CHANNEL_ID`: <#1547802425086312558>. Post the step messages here.
- log channel, `DISCORD_LOG_CHANNEL_ID`: <#1547802425295896620>
- completion reaction channel, `COMPLETION_REACTION_DEV_CHANNEL_ID`: <#1547802425086312559>
- Now Playing forum, `NOW_PLAYING_FORUM_ID`: <#1547802424893247527>
- Whatcha Playing channel, `WHATCHA_PLAYING_CHANNEL_ID`: <#1547802424893247526>

It changes real data. Step 13 logs a real Chrono Trigger completion on your profile, and
steps 14 and 15 delete it. Steps 16 to 20 change your server nickname and your Discord
display name, and put both back; the bot also saves the nickname to your member record
in the API while it is set.

Preconditions:

- You are the test guild's owner. The plus-sign completion flow only answers the owner.
- Your profile has no Chrono Trigger completion.
- You have no server nickname in the test guild, and you know your current display name.
- After the run, delete the messages from steps 5 and 8 (each logs "Message deleted in"),
  the forum post from step 21, and the bot's preview reply from step 22.

## Testing

### Step 1: Post a message
```
post "Event plan message" in the test channel
```
Expected: your message appears in the test channel, "Event plan message". The bot logs
nothing for a new message.
Ephemeral: no

### Step 2: Edit the message
```
edit your step 1 message to "Event plan message edited"
```
Expected: the log channel gets a post, title: "Message edited", with
"Before:" "Event plan message", "After:" "Event plan message edited", and a link to the
test channel.
Ephemeral: no

### Step 3: Pin the message with a reaction
```
react with 📌 to your step 1 message
```
Expected: the bot pins the message, and Discord shows its own notice in the test channel
that the bot "pinned a message" to this channel.
Ephemeral: no

### Step 4: Delete the message
```
delete your step 1 message
```
Expected: the log channel gets a post, title: "Message deleted in", naming the test
channel, with "Event plan message edited".
Ephemeral: no

### Step 5: Post a message no game matches
```
post "zzqqxx" in the test channel
```
Expected: your message appears in the test channel, "zzqqxx". The bot logs nothing.
Ephemeral: no

### Step 6: Start a completion from a reaction
```
react with ➕ to your step 5 message
```
Expected: the completion reaction channel gets a prompt, "Add completion from reaction.",
with "Game title guess: zzqqxx", "Select the completion type to continue.",
option: "Main Story", and button: "Change title".
Ephemeral: no

### Step 7: Pick a completion type for a title no one has heard of
```
select "Main Story"
```
Expected: the step 6 prompt changes in place to "No IGDB results found for" and
"zzqqxx", and its select and button are gone.
Ephemeral: no

### Step 8: Post a numbered message whose title needs fixing
```
post "#3 - Beat it last night" in the test channel
```
Expected: your message appears in the test channel, "Beat it last night". The bot logs
nothing.
Ephemeral: no

### Step 9: Start a completion from the numbered message
```
react with ➕ to your step 8 message
```
Expected: a new prompt in the completion reaction channel, "Add completion from reaction.",
with the number stripped from the guess, "Game title guess: Beat it last night".
Ephemeral: no

### Step 10: Change the title
```
click "Change title", enter "Chrono Trigger" in "Game title", submit
```
Expected: the step 9 prompt is edited in place to "Game title guess: Chrono Trigger",
still with option: "Main Story" and button: "Change title". No other reply stays behind.
Ephemeral: no

### Step 11: Pick a completion type
```
select "Main Story"
```
Expected: the prompt changes in place to a game picker, "Select the game for", or, when
GameDB has only one match, straight to "Select the platform for". Either one names
"Chrono Trigger".
Ephemeral: no

### Step 12: Pick Chrono Trigger if a game picker is shown
```
select "Chrono Trigger" from "Select the game"
```
Expected: the prompt changes in place to "Select the platform for" naming
"Chrono Trigger", with a platform picker that ends in option: "Other". If step 11 already
showed the platform picker, skip this step.
Ephemeral: no

### Step 13: Pick the Other platform
```
select "Other"
```
Expected: the prompt changes in place to "Completion added." with
"Game: Chrono Trigger" and "Type: Main Story". The test channel also gets a notice,
"Unknown completion platform selected.", naming Chrono Trigger.
Ephemeral: no

### Step 14: Find the completion to delete it
```
/game-completion delete title:Chrono Trigger
```
Expected: an ephemeral "Completed Games" list with a picker,
"Select a completion to delete", and option: "Chrono Trigger".
Ephemeral: yes

### Step 15: Delete the completion
```
select "Chrono Trigger"
```
Expected: an ephemeral "Deleted completion #" reply.
Ephemeral: yes

### Step 16: Add a server nickname
```
set your server nickname in the test guild to "Event Plan Nick"
```
Expected: the log channel gets a post, title: "Nickname added", with "Before:" and
"After:" "Event Plan Nick".
Ephemeral: no

### Step 17: Change the server nickname
```
change your server nickname to "Event Plan Nick 2"
```
Expected: the log channel gets a post, title: "Nickname changed", with
"Before:" "Event Plan Nick" and "After:" "Event Plan Nick 2".
Ephemeral: no

### Step 18: Remove the server nickname
```
clear your server nickname
```
Expected: the log channel gets a post, title: "Nickname removed", with
"Before:" "Event Plan Nick 2" and your display name after it.
Ephemeral: no

### Step 19: Change your display name
```
in Discord's profile settings, change your display name to "Event Plan Display"
```
Expected: the log channel gets a post, title: "Display name changed", with
"Before:" your old display name and "After:" "Event Plan Display". A Nickname changed
post for the same change may follow, since you have no server nickname.
Ephemeral: no

### Step 20: Put your display name back
```
change your display name back to what it was before step 19
```
Expected: the log channel gets a post, title: "Display name changed", with
"Before:" "Event Plan Display".
Ephemeral: no

### Step 21: Start a Now Playing forum post
```
post in the Now Playing forum with the title "Event plan forum post" and any text
```
Expected: about ten seconds later the Whatcha Playing channel gets a post,
title: "Event plan forum post", with "Forum Post" and "Posted by" naming you.
Ephemeral: no

### Step 22: Post a link with its embed suppressed
```
post "<https://en.wikipedia.org/wiki/Chrono_Trigger>" in the test channel
```
Expected: Discord shows no embed for the angle-bracketed link, and a few seconds later the
bot replies to your message with its own preview card naming "Chrono Trigger".
Ephemeral: no
