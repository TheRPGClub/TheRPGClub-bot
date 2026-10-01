# Lookups test plan

A full pass over the lookup utilities: `/hltb`, `/mp-info` with its member picker and
Back to List button, and `/timestamp` with every parsing path and its error replies. The
only data it changes is your own PSN handle: step 11 sets it to ConductorTest so you
show up in `/mp-info`, and step 17 clears it again. `/hltb` may also fill the HowLongToBeat
cache for Chrono Trigger.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it, any member can run it; no admin role is needed. Your profile must not
already hold a PSN handle you want to keep, because step 11 overwrites it and step 17
clears it.

## Testing

### Step 1: Look up Chrono Trigger publicly
```
/hltb title:Chrono Trigger
```
Expected: pick "Chrono Trigger" from autocomplete. A public reply,
"How Long to Beat Chrono Trigger", credited to "HowLongToBeat", with its times, and
not: "Sorry".
Ephemeral: no

### Step 2: Look up Chrono Trigger privately
```
/hltb title:Chrono Trigger private:true
```
Expected: pick "Chrono Trigger" from autocomplete. The same result as step 1, visible only
to you, "How Long to Beat Chrono Trigger".
Ephemeral: yes

### Step 3: Look up a title that does not exist
```
/hltb title:zzqqxx
```
Expected: pick the Keep typing option from autocomplete. A public reply,
"Sorry, no results were found for".
Ephemeral: no

### Step 4: Make a timestamp from a relative time
```
/timestamp datetime:in 5 hours
```
Expected: an ephemeral reply, "Timestamp Details", "America/New_York", and
"Copy and paste the text below", listing all seven formats including ":F>" and ":R>".
Ephemeral: yes

### Step 5: Make a public timestamp in one format
```
/timestamp datetime:tomorrow at 5pm public:true format:Relative
```
Expected: a public reply, "Timestamp Details", with only the relative format, ":R>",
and not: ":F>".
Ephemeral: no

### Step 6: Parse a weekday time in another timezone
```
/timestamp datetime:8pm on Friday parsing_timezone:Europe/London
```
Expected: an ephemeral reply, "Timestamp Details", naming "Europe/London".
Ephemeral: yes

### Step 7: Parse a date with no year
```
/timestamp datetime:08/21 at 19:30 format:Long Date Time
```
Expected: an ephemeral reply, "Timestamp Details", with only ":F>", and not: ":R>".
Ephemeral: yes

### Step 8: Use a timezone that does not exist
```
/timestamp datetime:in 5 hours parsing_timezone:Mars/Olympus
```
Expected: an ephemeral error, "Invalid parsing_timezone" and "Use an IANA timezone like".
Ephemeral: yes

### Step 9: Use a date the parser cannot read
```
/timestamp datetime:whenever you like
```
Expected: an ephemeral error, "Could not parse datetime" and "Examples:".
Ephemeral: yes

### Step 10: Use a date that is stripped to nothing
```
/timestamp datetime:--
```
Expected: the value is stripped to nothing. An ephemeral error, "cannot be empty." and
"Examples:".
Ephemeral: yes

### Step 11: Set your PSN handle so you show in mp-info
```
/profile edit psn:ConductorTest
```
Expected: an ephemeral reply, "Profile result for" your name and "Updated: PSN".
Ephemeral: yes

### Step 12: List PSN players publicly
```
/mp-info psn:true
```
Expected: a public list, title: "Member Multiplayer Info", with you on it tagged "PSN",
"Want to list your multiplayer info? Use /profile edit", and a member picker placeholder
Select a member to view their profile.
Ephemeral: no

### Step 13: Pick yourself from the mp-info list
```
select your own name from "Select a member to view their profile"
```
Expected: the list message changes in place to your profile, "Member Profile", with
"ConductorTest" and button: "Back to List".
Ephemeral: no

### Step 14: Go back to the mp-info list
```
click "Back to List"
```
Expected: the same message changes back to the list, title: "Member Multiplayer Info",
with "Want to list your multiplayer info? Use /profile edit".
Ephemeral: no

### Step 15: List every platform privately
```
/mp-info private:true
```
Expected: an ephemeral list, title: "Member Multiplayer Info", with members tagged by
platform and "Want to list your multiplayer info? Use /profile edit".
Ephemeral: yes

### Step 16: Turn every platform off
```
/mp-info steam:false xbl:false psn:false switch:false
```
Expected: a public error, "Please enable at least one platform filter."
Ephemeral: no

### Step 17: Clear your PSN handle
```
/profile edit psn:--
```
Expected: the value is stripped to nothing, which clears the field. An ephemeral reply,
"Profile result for" your name and "Updated: PSN".
Ephemeral: yes
