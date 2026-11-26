# /feedback test plan

A pass over `/feedback` and its `/suggestion` alias: the kind picker, each kind's modal,
and the reply linking to the Feedback Board. It runs against real data: it files one Bug
Report, which pings the bot dev in the dev channel. Feedback is reviewed on the website
only, so withdraw the test Bug Report there afterwards (or reject it from /admin).

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

## Testing

### Step 1: Open the kind picker
```
/feedback
```
Expected: an ephemeral reply, title: "Feedback", with "Pick a kind" and a select with
option: "Feature Request", option: "Suggestion", option: "Bug Report".
Ephemeral: yes

### Step 2: /suggestion opens the same picker
```
/suggestion
```
Expected: an ephemeral reply, title: "Feedback", with "Pick a kind" and
option: "Bug Report".
Ephemeral: yes

### Step 3: File a Bug Report
```
select "Bug Report" from "What kind of feedback?"
enter "Conductor test bug report" in "Title", select "Bot" in "Where"
enter "Testing the form." in "What happened", enter "Nothing." in "What you expected", submit
```
Expected: an ephemeral reply, "Thanks! Your bug report #" and "is filed.", with
"View it on the Feedback Board" and "add a screenshot". Check by eye that the link opens
the Feedback on the website and that the dev channel gets a ping.
Ephemeral: yes
