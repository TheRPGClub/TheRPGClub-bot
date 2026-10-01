# Profile test plan

A full pass over `/profile view`, `search`, and `edit`, the "View profile", "Now playing",
and "Compare completions" user context menus, and `/avatar-history` with its scan, all,
and member views. It runs against real data: it sets your PSN handle to ConductorTest and
clears it again, and the admin scan records any current avatars that are missing from
avatar history.

Paste the Testing section below into a PR body and run `/conduct` on that PR, or
follow it by hand. The format is in `.github/pull-request-testing-format.md`.

Before running it:

- Run it as a member with the Administrator permission in the test guild, so the avatar
  scan in step 15 runs instead of being denied.
- Your profile must not already hold a PSN handle you want to keep. Step 4 overwrites it
  with ConductorTest and step 10 clears it.
- You need a custom Discord avatar, so the scan leaves at least one stored avatar for you.

## Testing

### Step 1: View your own profile publicly
```
/profile view
```
Expected: a public reply, title: "Member Profile", with a header button labelled with your
name and a "Roles" block. not: "Error loading profile".
Ephemeral: no

### Step 2: View your own profile privately
```
/profile view private:true
```
Expected: the same profile as step 1, visible only to you, with "Member Profile" and
"Roles".
Ephemeral: yes

### Step 3: Edit your profile with no fields
```
/profile edit
```
Expected: an ephemeral error, "Provide at least one field to update."
Ephemeral: yes

### Step 4: Set your PSN handle
```
/profile edit psn:ConductorTest
```
Expected: an ephemeral reply, "Profile result for" your name, "Updated: PSN", and
not: "Skipped (platform not found)".
Ephemeral: yes

### Step 5: Confirm the PSN handle shows on your profile
```
/profile view private:true
```
Expected: your profile, "Member Profile", now with a PSN block reading "ConductorTest".
Ephemeral: yes

### Step 6: Search for a member no one matches
```
/profile search query:zzqqxx
```
Expected: a public reply, "No members matched that search."
Ephemeral: no

### Step 7: List members privately
```
/profile search private:true
```
Expected: an ephemeral list, title: "Profile search (", with
"Choose a member below to view a profile." and a member picker placeholder
Select a member to view their profile.
Ephemeral: yes

### Step 8: Pick a member from the search list
```
select the first member in "Select a member to view their profile"
```
Expected: a new ephemeral reply with that member's profile, "Member Profile" and "Roles".
The search list stays as it was.
Ephemeral: yes

### Step 9: List members publicly
```
/profile search
```
Expected: a public list, title: "Profile search (", with
"Choose a member below to view a profile.".
Ephemeral: no

### Step 10: Clear your PSN handle
```
/profile edit psn:--
```
Expected: the value is stripped to nothing, which clears the field. An ephemeral reply,
"Profile result for" your name and "Updated: PSN".
Ephemeral: yes

### Step 11: Confirm the PSN handle is gone
```
/profile view private:true
```
Expected: your profile, "Member Profile", with not: "ConductorTest".
Ephemeral: yes

### Step 12: Open the View profile context menu
```
right-click your own name in the member list, Apps, View profile
```
Expected: an ephemeral profile, "Member Profile" and "Roles".
Ephemeral: yes

### Step 13: Open the Now playing context menu
```
right-click your own name in the member list, Apps, Now playing
```
Expected: an ephemeral Now Playing view with "Now Playing", showing your list, or a
welcome note that your list is empty if you have no titles.
Ephemeral: yes

### Step 14: Compare completions with the preview bot
```
right-click RPGClubbot (Preview) in the member list, Apps, Compare completions
```
Expected: an ephemeral reply, "No shared completions matched those filters."
Ephemeral: yes

### Step 15: Scan avatars as an admin
```
/avatar-history scan:true
```
Expected: an ephemeral reply, title: "Avatar History Scan", with "Scanned", "recorded" and
"already up to date or no avatar", and not: "Access denied".
Ephemeral: yes

### Step 16: View your avatar history publicly
```
/avatar-history
```
Expected: a public reply, title: "Avatar History", with a header button labelled with your
name and a gallery of your stored avatars. not: "No avatar history found for".
Ephemeral: no

### Step 17: View your avatar history privately
```
/avatar-history private:true
```
Expected: the same gallery as step 16, visible only to you, with "Avatar History".
Ephemeral: yes

### Step 18: View avatar history for a member with none
```
/avatar-history member:@RPGClubbot (Preview)
```
Expected: a public reply, "No avatar history found for", naming the preview bot.
Ephemeral: no

### Step 19: List everyone with avatar history
```
/avatar-history all:true
```
Expected: a public list, title: "Avatar History", with numbered members and their counts,
"users with avatar history stored.", and a member picker placeholder
View a member's avatar history with you in it.
Ephemeral: no

### Step 20: Pick yourself from the everyone list
```
select your own name from "View a member's avatar history"
```
Expected: the list message changes in place to your gallery, "Avatar History", with a
header button labelled with your name. Check by eye that the numbered member list is gone
and no second message was posted.
Ephemeral: no
