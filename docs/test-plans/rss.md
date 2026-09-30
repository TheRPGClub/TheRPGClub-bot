# /rss test plan

A full pass over `/rss help`, `add`, `edit`, `list`, and `remove`, the help topic picker,
and the URL and input errors. It runs against real data: it adds one RSS feed relay that
posts into #dev, edits it, and removes it again. The feed row is real data that every
bot reading the API polls, so finish the run to its last step.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it:

- Run it as a member with the Administrator permission in the test guild. Anyone else gets
  "Access denied. Command requires Administrator role." from every subcommand.
- No existing feed may be named Conductor feed or Conductor renamed.
- Steps that take `id:` need the feed number that step 9 prints after "Added feed #".
  Type that number in place of the words in the code block.

The test feed only relays items whose title or text contains zzqqxx, so it never posts.
A feed item being posted is not covered: the bot polls feeds once at startup and then
hourly, and no command triggers a poll, so it cannot be driven within a run.

## Testing

### Step 1: Open the RSS help
```
/rss help
```
Expected: an ephemeral help panel, title: "/rss commands", with
"Choose an RSS subcommand from the dropdown to view details." and option: "/rss add".
Ephemeral: yes

### Step 2: Pick the add topic
```
select "/rss add"
```
Expected: the help panel changes in place to title: "/rss add help" with
"Syntax: /rss add url:".
Ephemeral: yes

### Step 3: Pick the edit topic
```
select "/rss edit"
```
Expected: the help panel changes in place to title: "/rss edit help" with
"Syntax: /rss edit id:".
Ephemeral: yes

### Step 4: Pick the remove topic
```
select "/rss remove"
```
Expected: the help panel changes in place to title: "/rss remove help" with
"Syntax: /rss remove id:".
Ephemeral: yes

### Step 5: Pick the list topic
```
select "/rss list"
```
Expected: the help panel changes in place to title: "/rss list help" with
"Syntax: /rss list".
Ephemeral: yes

### Step 6: Go back to the main help menu
```
select "Back to Help Main Menu"
```
Expected: the panel changes in place to the main help menu,
"Use the category dropdowns below to jump straight to".
Ephemeral: yes

### Step 7: Add a feed with a URL that is not a URL
```
/rss add url:not a url channel:#dev
```
Expected: an ephemeral error, "Feed URL must be a valid URL.".
Ephemeral: yes

### Step 8: Add a feed with a non-web URL
```
/rss add url:ftp://example.com/feed.xml channel:#dev
```
Expected: an ephemeral error, "Feed URL must use http or https.".
Ephemeral: yes

### Step 9: Add the test feed
```
/rss add url:https://xkcd.com/atom.xml channel:#dev name:Conductor feed include:zzqqxx exclude:beta
```
Expected: an ephemeral reply, "Added feed #", "(Conductor feed)" and
"url=https://xkcd.com/atom.xml". Note the feed number.
Ephemeral: yes

### Step 10: See the new feed in the list
```
/rss list
```
Expected: an ephemeral list with "Conductor feed", "include=[zzqqxx]" and
"exclude=[beta]".
Ephemeral: yes

### Step 11: Edit with no fields
```
/rss edit id:1
```
Expected: an ephemeral error,
"Nothing to update. Provide at least one field (url/channel/include/exclude).". Nothing
is changed, so the id does not matter.
Ephemeral: yes

### Step 12: Edit with a URL that is not a URL
```
/rss edit id:(feed number from step 9) url:not a url
```
Expected: an ephemeral error, "Feed URL must be a valid URL.".
Ephemeral: yes

### Step 13: Edit a feed that does not exist
```
/rss edit id:999999 name:Conductor missing feed
```
Expected: an ephemeral reply, "Feed #999999 not found or no changes applied.".
Ephemeral: yes

### Step 14: Rename the feed and change its keywords
```
/rss edit id:(feed number from step 9) name:Conductor renamed include:zzqqxx, yyqqxx exclude:alpha
```
Expected: an ephemeral reply, "Updated feed #", and not: "not found".
Ephemeral: yes

### Step 15: Change the feed URL and channel
```
/rss edit id:(feed number from step 9) url:https://xkcd.com/rss.xml channel:#dev
```
Expected: an ephemeral reply, "Updated feed #", and not: "not found".
Ephemeral: yes

### Step 16: See the edits in the list
```
/rss list
```
Expected: an ephemeral list with "Conductor renamed",
"https://xkcd.com/rss.xml", "include=[zzqqxx, yyqqxx]" and
"exclude=[alpha]".
Ephemeral: yes

### Step 17: Remove the feed
```
/rss remove id:(feed number from step 9)
```
Expected: an ephemeral reply, "Removed feed #".
Ephemeral: yes

### Step 18: Remove the same feed again to prove it is gone
```
/rss remove id:(feed number from step 9)
```
Expected: an ephemeral reply, "not found.", and not: "Failed to remove feed".
Ephemeral: yes
