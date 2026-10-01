# /suggestion test plan

A full pass over `/suggestion` and the review flow it feeds: the Submit Suggestion modal,
the Review Suggestions button on `/todo`, and the Review Decision modal. It runs against
real data: it submits one suggestion and then rejects it, which deletes it again. The
submit pings the bot dev in the dev channel, and the rejection posts a "was not accepted"
notice in the test guild's GameDB updates channel.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it:

- Run it as the test guild's owner or as the bot dev user. Anyone else gets "Only the
  server owner or bot dev can review suggestions." from Review Suggestions.
- There must be no pending suggestions. The review flow always opens the first pending
  one, so a real suggestion could be rejected by mistake. Step 1 checks this; stop the run
  if it fails.

The Accept decision is not tested, because it files a real GitHub issue.

## Testing

### Step 1: Confirm no suggestions are pending
```
/todo private:true
```
Expected: an ephemeral issue list with "Repo:" and button: "Filter", and
not: "suggestions awaiting review". If that text shows, stop the run.
Ephemeral: yes

### Step 2: Submit a suggestion
```
/suggestion
enter "Conductor test suggestion" in "Title", enter "Testing the form." in "Description"
select "Improvement" in "Suggestion Type(s)", select "Bug" in "Suggestion Type(s)", submit
```
Expected: an ephemeral reply, "Thanks! Suggestion #" and "submitted.". Check by eye that
the dev channel gets a ping saying you have submitted a suggestion.
Ephemeral: yes

### Step 3: See the suggestion waiting on /todo
```
/todo private:true
```
Expected: an ephemeral issue list with "1 suggestions awaiting review" and
button: "Review Suggestions".
Ephemeral: yes

### Step 4: Reject without a reason
```
click "Review Suggestions", select "Reject" in "Review Decision", submit
```
Expected: the Suggestion Review Decision modal shows Conductor test suggestion in its
Suggestion Review box. After submit, an ephemeral error,
"Rejection reason cannot be empty when Reject is selected.".
Ephemeral: yes

### Step 5: Reject with a reason
```
click "Review Suggestions", select "Reject" in "Review Decision"
enter "Conductor test cleanup" in "Rejection reason (required when Reject)", submit
```
Expected: an ephemeral reply, "Rejected." and "No pending suggestions remain.". Check by
eye that the GameDB updates channel says your Conductor test suggestion was not
accepted, with the reason.
Ephemeral: yes

### Step 6: Click the stale Review Suggestions button
```
click "Review Suggestions"
```
Expected: click it on the step 3 list. No modal opens; an ephemeral reply says
"No pending suggestions to review.".
Ephemeral: yes

### Step 7: Confirm the queue is empty again
```
/todo private:true
```
Expected: an ephemeral issue list with "Repo:" and
not: "suggestions awaiting review".
Ephemeral: yes
