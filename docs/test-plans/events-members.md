# Event handlers test plan: member join, leave, kick, and ban

A pass over the member logs that need a second account: join, leave, kick, ban, and
unban, the newcomers role on join, the member role granted on a first message, and the
owner-only checks on the plus-sign completion prompt. None of these has a slash command,
so each step is an action you or your second account take, and its `Expected:` says what
appears and in which channel.

The message, reaction, nickname, and forum handlers are in `events.md`. The role,
channel, emoji, and server change logs are in `events-server.md`.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`. The bot
posts these results in log channels, or answers the second account, so the conductor
cannot see them: confirm each step by eye with Looks right.

Channels in the test guild, by the constant that names them:

- test channel, `BOT_DEV_CHANNEL_ID`: <#1547802425086312558>
- join and leave log, `JOIN_LEAVE_LOG_CHANNEL_ID`, also the ban log:
  <#1547802425086312556>
- log channel, `DISCORD_LOG_CHANNEL_ID`: <#1547802425295896620>
- admin channel, `ADMIN_CHANNEL_ID`, the unban log: <#1547802425295896619>
- completion reaction channel, `COMPLETION_REACTION_DEV_CHANNEL_ID`: <#1547802425086312559>

It changes real data. Each join saves the second account as a user in the API that the
preview shares with production.

Preconditions:

- You are the test guild's owner, and you have a second Discord account that you own and
  that is not in the test guild yet. Only ever kick or ban that throwaway account, never
  a real member.
- You have an invite link to the test guild, and the test guild has a role named
  "newcomers" and the member role.
- If the run stops between steps 13 and 14, unban the second account by hand.

## Testing

### Step 1: Second account joins
```
from your second account, join the test guild with the invite link
```
Expected: the join and leave log gets a post, title: "User Joined", with
"Account Created On". The log channel also gets "Role added" for the newcomers role.
Ephemeral: no

### Step 2: Second account posts its first message
```
from your second account, post "Hello from the test account" in the test channel
```
Expected: the log channel gets a post, title: "Role added", naming the member role, and
a post, title: "Role removed", naming the newcomers role.
Ephemeral: no

### Step 3: Second account reacts with a plus sign
```
from your second account, react with ➕ to its step 2 message
```
Expected: the reaction shows on "Hello from the test account", and no prompt appears in
the completion reaction channel, because only the owner starts that flow;
not: "Add completion from reaction.".
Ephemeral: no

### Step 4: Owner reacts with a plus sign on the second account's message
```
react with ➕ to the second account's step 2 message
```
Expected: the completion reaction channel gets a prompt,
"Add completion from reaction.", naming the second account as Member, with
"Game title guess: Hello from the test account" and option: "Main Story".
Ephemeral: no

### Step 5: Second account tries the completion type select
```
from your second account, select "Main Story" on the step 4 prompt
```
Expected: an ephemeral reply to the second account,
"This completion prompt is not for you.", and the prompt does not change.
Ephemeral: yes

### Step 6: Second account tries the Change title button
```
from your second account, click "Change title" on the step 4 prompt
```
Expected: a reply, "This completion prompt is not for you.", and no modal opens. This
reply is public in the completion reaction channel.
Ephemeral: no

### Step 7: Second account leaves
```
from your second account, leave the test guild
```
Expected: the join and leave log gets a post, title: "User Left", naming the second
account.
Ephemeral: no

### Step 8: Second account rejoins
```
from your second account, join the test guild again with the invite link
```
Expected: the join and leave log gets a post, title: "User Joined".
Ephemeral: no

### Step 9: Kick the second account with a reason
```
kick your second account with the reason "Event plan kick test"
```
Expected: the join and leave log gets a post, title: "User Kicked", with "Moderator"
naming you and "Event plan kick test".
Ephemeral: no

### Step 10: Second account rejoins after the kick
```
from your second account, join the test guild again with the invite link
```
Expected: the join and leave log gets a post, title: "User Joined".
Ephemeral: no

### Step 11: Kick the second account with no reason
```
kick your second account and leave the reason empty
```
Expected: the join and leave log gets a post, title: "User Kicked", with
"No reason provided.".
Ephemeral: no

### Step 12: Second account rejoins again
```
from your second account, join the test guild again with the invite link
```
Expected: the join and leave log gets a post, title: "User Joined".
Ephemeral: no

### Step 13: Ban the second account
```
ban your second account (never a real member), deleting no messages
```
Expected: the join and leave log gets a post, title: "User Banned", with
"Account Created On", and a "User Left" post for the same account.
Ephemeral: no

### Step 14: Unban the second account
```
in Server Settings, Bans, revoke the ban on your second account
```
Expected: the admin channel gets a post, title: "User Unbanned", naming the second
account.
Ephemeral: no
