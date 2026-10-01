# /todo test plan

A full pass over `/todo`, every option it takes, and every button, select, and modal its
list and issue views lead to. It runs against real data: it creates one GitHub issue in
TheRPGClub/TheRPGClub-bot, comments on it, edits it, closes it, reopens it, and closes it
again. The issue is left closed at the end; GitHub issues cannot be deleted from the bot.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Run it as the owner of the test guild. Create Issue and the label picker need Manage
Messages, Administrator, or server owner; Edit, Close Issue, and Reopen Issue need the
server owner. No open issue titled "Conductor test issue" may exist beforehand. Steps 9 to
22 work on the public list from step 9, because create, comment, edit, close, and filter
refresh the list message in place.

## Testing

### Step 1: Show the open issue list
```
/todo
```
Expected: a public list, title: "TheRPGClub-bot GitHub Issues", with "State: open",
"Label: Not Blocked", "Query: Any", "Sort: # desc", button: "Create Issue",
button: "Close Issue", and button: "Filter".
Ephemeral: no

### Step 2: Filter by a label that does not exist
```
/todo labels:Nonsense
```
Expected: a public error, "Unknown labels: Nonsense" and "Valid labels:".
Ephemeral: no

### Step 3: Search for text no issue contains
```
/todo query:zzqqxx private:true
```
Expected: a list visible only to you, "No issues found for this filter." and
"Query: zzqqxx", with no issue picker.
Ephemeral: yes

### Step 4: List every issue oldest first, one per page
```
/todo state:all sort:created direction:asc per_page:1 private:true
```
Expected: a list visible only to you with "State: all", "Sort: # asc", "Page 1/",
button: "Previous" (disabled) and button: "Next".
Ephemeral: yes

### Step 5: Go to the next page
```
click "Next"
```
Expected: the same message changes in place to "Page 2/" with "State: all".
Ephemeral: yes

### Step 6: Go back a page
```
click "Previous"
```
Expected: the same message changes in place back to "Page 1/".
Ephemeral: yes

### Step 7: Switch to the API repository
```
select "TheRPGClub-api" in "Repository..."
```
Expected: the message changes in place to title: "TheRPGClub-api GitHub Issues" with
"Repo: TheRPGClub-api". If the GitHub App cannot read that repo, a new private reply says
"Could not load issues for this repository" instead.
Ephemeral: yes

### Step 8: Switch to the website repository
```
select "TheRPGClub-www" in "Repository..."
```
Expected: the message changes in place to title: "TheRPGClub-www GitHub Issues" with
"Repo: TheRPGClub-www", or the "Could not load issues for this repository" reply.
Ephemeral: yes

### Step 9: Post a fresh public list to work on
```
/todo
```
Expected: a public list, title: "TheRPGClub-bot GitHub Issues", with
button: "Create Issue".
Ephemeral: no

### Step 10: Try to create an issue with a blank description
```
click "Create Issue", enter "Conductor test issue" in "Title", enter " " in "Description",
select "Improvement" in "Issue Type(s)", submit
```
Expected: a private reply, "Description cannot be empty.", and no issue is created. If
Discord refuses a space-only field, close the form and move on.
Ephemeral: yes

### Step 11: Create the test issue
```
click "Create Issue", enter "Conductor test issue" in "Title",
enter "Created by the /todo test plan." in "Description",
select "Improvement" in "Issue Type(s)", submit
```
Expected: the public list changes in place to the new issue, "Conductor test issue",
"[Improvement]", "Created by the /todo test plan.", button: "Add Comment",
button: "Edit", button: "Close Issue", and button: "Back".
Ephemeral: no

### Step 12: Comment on the issue
```
click "Add Comment", enter "Conductor test comment" in "Comment", submit
```
Expected: the issue view refreshes in place with "Comments:" and a comment that reads
"Conductor test comment", prefixed with your username.
Ephemeral: no

### Step 13: Edit the title and type
```
click "Edit", enter "Conductor test issue edited" in "Title",
enter "Edited by the /todo test plan." in "Description", select "Bug" in "Issue Type(s)",
submit
```
Expected: the issue view refreshes in place with "Conductor test issue edited",
"Edited by the /todo test plan.", and "[Bug]".
Ephemeral: no

### Step 14: Close the issue from its view
```
click "Close Issue"
```
Expected: the issue view refreshes in place with "closed" in the footer and
button: "Reopen Issue" in place of Close Issue.
Ephemeral: no

### Step 15: Reopen the issue
```
click "Reopen Issue"
```
Expected: the message changes in place back to the list,
title: "TheRPGClub-bot GitHub Issues", with option: "Conductor test issue edited" in the
View an issue picker.
Ephemeral: no

### Step 16: Open the issue from the list
```
select "Conductor test issue edited" in "View an issue..."
```
Expected: the message changes in place to the issue view, "Conductor test comment",
button: "Close Issue", and button: "Back".
Ephemeral: no

### Step 17: Go back to the list
```
click "Back"
```
Expected: the message changes in place to the list, title: "TheRPGClub-bot GitHub Issues",
with button: "Create Issue".
Ephemeral: no

### Step 18: Open the close picker
```
click "Close Issue"
```
Expected: a private reply, "Choose an issue to close.", with
option: "Conductor test issue edited" and button: "Cancel".
Ephemeral: yes

### Step 19: Cancel the close picker
```
click "Cancel"
```
Expected: the private reply changes to "Close issue cancelled.", and the issue stays open.
Ephemeral: yes

### Step 20: Open the close picker again
```
click "Close Issue"
```
Expected: a private reply, "Choose an issue to close.", with
option: "Conductor test issue edited".
Ephemeral: yes

### Step 21: Close the test issue from the list
```
select "Conductor test issue edited" in "Select an issue to close"
```
Expected: the private picker is removed and the public list refreshes in place without the
issue, title: "TheRPGClub-bot GitHub Issues", not: "Conductor test issue edited".
Ephemeral: no

### Step 22: Filter the list to closed issues
```
click "Filter", select "Closed" in "Issue State", select "All" in "Label",
enter "Conductor test issue" in "Search Query",
select "Descending (newest first)" in "Sort by Issue Number", submit
```
Expected: the public list refreshes in place with "State: closed", "Label: Any",
"Query: Conductor test issue", and "Conductor test issue edited" first.
Ephemeral: no

### Step 23: Filter by a real label from the command
```
/todo labels:Bug state:closed private:true
```
Expected: a list visible only to you with "Label: Bug" and "State: closed", every issue
tagged Bug, and "Conductor test issue edited" near the top.
Ephemeral: yes
