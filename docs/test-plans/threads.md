# threads test plan

A pass over `/thread create`, `/thread link`, `/thread unlink`, and the thread link prompt
the bot posts in new Now Playing forum posts, with its Link a game and Skip Linking Game
buttons. It runs against real data: it creates a Now Playing forum thread for Hylics 2
and links it, links a forum post of your own to Chrono Trigger, marks a second post to
skip linking, and removes every link it made again before the plan ends.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it:

- You need the test guild's Regulars role; `/thread link` and `/thread unlink` check for it.
- The preview bot needs IGDB configured, or it posts no link prompt at all.
- Hylics 2 must be in GameDB with cover art and no linked thread. If it is missing, add
  it first with `/gamedb add title:Hylics 2`. If it already has a thread, unlink it with
  `/thread unlink` first.
- The test guild's Now Playing forum must have at least one tag.

Several steps need IDs the plan prints on the way: the thread step 4 creates, the forum
posts you make in steps 6, 10, and 16, and the GameDB number step 7 prints. Copy each
thread ID with Copy Thread ID (Developer Mode) as you go. The prompt the bot posts inside a
forum post is outside the test channel, so the conductor cannot read it; confirm those
steps by eye. When the plan is done, delete the Hylics 2 thread and your three forum posts
by hand; the bot cannot delete them.

## Testing

### Step 1: Create a thread with a title typed instead of picked
```
/thread create title:zzqqxx tag:zzqqxx
```
Expected: an ephemeral error, "Please select a game from title autocomplete.".
Ephemeral: yes

### Step 2: Create a thread for a GameDB id that does not exist
```
/thread create title:999999999 tag:zzqqxx
```
Expected: type the title without picking from autocomplete. An ephemeral error,
"Could not find GameDB game #999999999".
Ephemeral: yes

### Step 3: Create a thread with a tag the forum does not have
```
/thread create title:Hylics 2 tag:zzqqxx
```
Expected: pick the title from autocomplete, and type the tag. An ephemeral error,
"Could not find forum tag" and "Please pick one from tag autocomplete.".
Ephemeral: yes

### Step 4: Create the Hylics 2 thread
```
/thread create title:Hylics 2 tag:(any tag from autocomplete) first-post-text:Conductor test
```
Expected: pick the title and the tag from autocomplete. An ephemeral reply,
"Created thread", "Hylics 2", and "with tag". Check by eye that the forum has a new
Hylics 2 post with the cover image, your tag, and the first post "Conductor test".
Copy its thread ID.
Ephemeral: yes

### Step 5: Create the Hylics 2 thread again
```
/thread create title:Hylics 2 tag:(any tag from autocomplete)
```
Expected: pick both values from autocomplete. An ephemeral error,
"A thread is already linked for" and "Hylics 2", and not: "Created thread".
Ephemeral: yes

### Step 6: Make a forum post the bot will offer to link
```
make a new post in the Now Playing forum titled Chrono Trigger with the text Link test
```
Expected: check by eye that the bot posts Link this thread to a game? in the new post,
with Link a game and Skip Linking Game buttons. Copy the post's thread ID.
Ephemeral: no

### Step 7: Link the post with Link a game
```
click "Link a game" in the Chrono Trigger post
```
Expected: an ephemeral reply, "Linked this thread to GameDB #", "(Chrono Trigger)", and
"use /thread unlink to remove one or all". Note the GameDB number. Check by eye that the
prompt is removed from the post.
Ephemeral: yes

### Step 8: Link a second game to the Hylics 2 thread
```
/thread link thread_id:(the Hylics 2 thread ID) gamedb_game_id:(the number step 7 printed)
```
Expected: an ephemeral reply, "Linked thread" and "to GameDB game", and not:
"Access denied".
Ephemeral: yes

### Step 9: Link with an invalid GameDB id
```
/thread link thread_id:(the Hylics 2 thread ID) gamedb_game_id:0
```
Expected: an ephemeral error, "Something went wrong running /thread link" and
"Invalid GameDB game id.".
Ephemeral: yes

### Step 10: Make a forum post to skip
```
make a new post in the Now Playing forum titled Conductor skip test with the text Skip
```
Expected: check by eye that the bot posts Link this thread to a game? in the new post.
Copy the post's thread ID.
Ephemeral: no

### Step 11: Skip linking the post
```
click "Skip Linking Game" in the Conductor skip test post
```
Expected: an ephemeral reply,
"Okay, I'll skip linking a game for this thread going forward.", and not:
"Failed to update skip flag". Check by eye that the prompt's buttons are removed.
Ephemeral: yes

### Step 12: Unlink one game from the Hylics 2 thread
```
/thread unlink thread_id:(the Hylics 2 thread ID) gamedb_game_id:(the step 7 number)
```
Expected: an ephemeral reply, "Unlinked GameDB game" and "from thread", and
not: "no matching links were found".
Ephemeral: yes

### Step 13: Unlink the same game again
```
/thread unlink thread_id:(the Hylics 2 thread ID) gamedb_game_id:(the step 7 number)
```
Expected: an ephemeral reply, "Unlinked GameDB game" and
"(no matching links were found)".
Ephemeral: yes

### Step 14: Unlink every game from the Chrono Trigger post
```
/thread unlink thread_id:(the Chrono Trigger post's thread ID)
```
Expected: an ephemeral reply, "Unlinked all GameDB links from thread", and
not: "no matching links were found".
Ephemeral: yes

### Step 15: Unlink every game from the Hylics 2 thread
```
/thread unlink thread_id:(the Hylics 2 thread ID)
```
Expected: an ephemeral reply, "Unlinked all GameDB links from thread", and
not: "no matching links were found". Hylics 2 has no linked thread again.
Ephemeral: yes

### Step 16: Make a forum post GameDB and IGDB cannot match
```
make a new post in the Now Playing forum titled zzqqxx with the text No match test
```
Expected: check by eye that the bot posts Link this thread to a game? in the new post.
Ephemeral: no

### Step 17: Try to link the unmatched post
```
click "Link a game" in the zzqqxx post
```
Expected: an ephemeral reply, "No GameDB/IGDB results found for" and "zzqqxx", and
not: "Linked this thread to GameDB".
Ephemeral: yes
