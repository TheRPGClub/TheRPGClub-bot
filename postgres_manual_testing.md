# Manual Test Plan: Oracle -> PostgreSQL Migration

**Date:** 2026-06-11
**Scope:** Full bot functionality verification after database migration

---

## Pre-Test Setup

- Confirm bot is running and connected to the new Postgres instance
- Run `/admin sql-health-check` first -- this should be your first gate
- Have a second Discord account or test channel available for multi-user tests
- Confirm the RPG Club API is reachable from the bot host

---

## 1. Health & Admin Baseline

| Test | Command | Expected Result |
|------|---------|----------------|
| SQL health check | `/admin sql-health-check` | Returns "healthy" or equivalent with Postgres connection details |
| Bot presence | Observe bot status in server | Shows correct "Now Playing" / presence status |
| Help output | `/help` | Renders help embed with no errors |

---

## 2. User / Member Events (Passive -- Trigger Manually)

**2a. Join flow**
- Have a test account join the server
- Verify: "newcomers" role assigned, member logged in audit channel, avatar recorded

**2b. First message auto-role**
- Have the test account send a message in any channel
- Verify: "member" role granted, "newcomers" role removed

**2c. Member leave**
- Have the test account leave
- Verify: departure logged with leave/kick distinction in audit channel

**2d. Nickname / avatar change**
- Change a test account's nickname
- Verify: change logged, user emoji updated if applicable

**2e. Avatar history**
- Change a test account's avatar
- Run `/avatar-history` for that user
- Verify: new avatar appears in history; old entries still present

---

## 3. Moderation Commands

| Test | Command | Expected Result |
|------|---------|----------------|
| Presence lookup | `/mod presence @user` | Returns presence / activity log for user |
| Presence history | `/mod presence-history @user` | Returns historical presence data |
| Mod help | `/mod help` | Returns mod help embed |

---

## 4. Game Database (GameDB) Core

**4a. Search**
- `/gamedb search <title>` -- use a title you know is in the DB
- Verify: result returns with correct metadata (title, platform, IGDB id, etc.)

**4b. View game**
- `/gamedb view` with a known game
- Verify: embed shows correct fields -- title, cover art, platforms, IGDB link

**4c. Add game**
- `/gamedb add` and follow IGDB selection flow
- Verify: game saved, returned from subsequent `/gamedb search`

**4d. Create thread**
- `/gamedb thread` for an existing game
- Verify: forum thread created and linked to DB entry

**4e. CSV import**
- `/gamedb csv-import` with a small test CSV
- Verify: entries imported, visible in search

**4f. GameDB admin -- audit**
- `/admin gotm-audit`
- Verify: returns audit results without DB errors

---

## 5. Collection Management

**5a. Add to collection**
- `/collection add <game>`
- Verify: game added to your personal collection

**5b. View collection**
- `/collection view`
- Verify: paginated list returns, shows recently added game

**5c. Edit / remove collection entry**
- `/collection edit` or remove
- Verify: change persisted and reflected in view

**5d. Steam import**
- `/collection steam-import <steamid>`
- Verify: games imported, no Postgres errors in logs

**5e. CSV import**
- `/collection csv-import` with test file
- Verify: entries imported successfully

---

## 6. Game Completion Tracking

**6a. Add completion**
- `/game-completion add <game>`
- Verify: completion entry created with correct user, date, platform

**6b. List completions**
- `/game-completion list`
- Verify: paginated results, your entry visible

**6c. Edit completion**
- `/game-completion edit` -- change platform or notes
- Verify: change saved and shows in list

**6d. Delete completion**
- `/game-completion delete`
- Verify: entry removed from list

**6e. Export completions**
- `/game-completion export`
- Verify: CSV/file attachment returned with correct data

**6f. Reaction-based completion (Plus emoji)**
- Post a message with a game title in a relevant channel
- React with the + emoji
- Follow the game / platform / title selection modal flow
- Verify: completion entry created, all steps resume correctly after bot restart simulation (stable identifiers check)

---

## 7. Now Playing / Game Journal

| Test | Command | Expected Result |
|------|---------|----------------|
| Set now playing | `/now-playing add <game>` | Game added to now-playing list |
| View now playing | `/now-playing list` or profile | List shows correct game |
| Remove now playing | `/now-playing remove` | Game removed |
| Game journal entry | `/game-journal add` | Journal entry persisted |

**Presence detection (passive):**
- Start a game/activity on a Discord-visible platform
- Verify: bot DMs a "Now Playing" prompt with Yes/No/Opt-out buttons
- Click Yes -- verify game added to now-playing
- Click No -- verify no entry, no further prompts for that session
- Click "Opt out for this game" -- verify game-specific opt-out stored
- Verify opt-out persists after bot restart

---

## 8. Nominations & Voting

**8a. Nominate a game**
- `/nominate` with a game title
- Verify: nomination saved, confirmation returned

**8b. Admin nomination management**
- `/admin nomination-admin` (list, approve, reject)
- Verify: nominations readable from Postgres, state changes persist

**8c. Voting admin**
- `/admin voting-admin`
- Verify: voting state readable and modifiable

---

## 9. Game of the Month (GotM) Round

**9a. View current round**
- `/round`
- Verify: current round data loads correctly (title, nominees, dates)

**9b. Round history**
- `/round-history`
- Verify: historical rounds paginate correctly

**9c. Add GotM (admin)**
- `/admin add-gotm` (use a test/dev round if available)
- Verify: round entry created

**9d. Edit GotM (admin)**
- `/admin edit-gotm`
- Verify: changes saved

**9e. Next Round setup**
- `/admin nextround-setup`
- Verify: next round data persisted

**9f. Generate vote image**
- `/generate-vote-image`
- Verify: image attachment returned, no DB errors

---

## 10. Giveaway System

**10a. List giveaways**
- `/giveaway list`
- Verify: available keys listed, counts accurate

**10b. Donate a key**
- `/giveaway donate <game> <key>`
- Verify: key stored, hub message updated

**10c. Game giveaway (claim)**
- `/giveaway gamegiveaway`
- Verify: key returned to claimant, removed from pool

**10d. Revoke a key (admin)**
- `/giveaway revoke`
- Verify: key removed from pool

**10e. Giveaway hub refresh**
- Verify the hub channel message updates after donate/claim
- Verify hub message still intact after bot restart (recreate if needed)

---

## 11. Reminders

**11a. Set a reminder (near-future)**
- `/publicreminder` set for 2-3 minutes from now
- Verify: reminder delivered at correct time via DM or channel

**11b. Snooze a reminder**
- When reminder fires, click "Snooze"
- Verify: reminder re-queued and fires again

**11c. Mark done**
- When reminder fires, click "Mark done"
- Verify: reminder removed from queue

**11d. Reminder after restart**
- Set a reminder, restart bot, wait for delivery time
- Verify: reminder still fires (Postgres-backed, not in-memory)

---

## 12. RSS Feed Relay

| Test | Command | Expected Result |
|------|---------|----------------|
| List feeds | `/rss list` | Returns configured RSS feeds from DB |
| Add feed | `/rss add <url> <channel>` | Feed added, begins polling |
| Edit feed | `/rss edit` | Feed config updated in DB |
| Remove feed | `/rss remove` | Feed removed, polling stops |
| RSS help | `/rss help` | Help embed returned |

- Wait one poll cycle (or trigger manually) and verify a feed post appears in the target channel

---

## 13. Suggestions

- `/suggestion <game>` -- submit a suggestion
- Verify: suggestion saved, confirmation returned
- Check if suggestions are readable via admin view

---

## 14. Profile

- `/profile @user` for yourself and another user
- Verify: profile data loads (avatar, completions count, now playing, collection stats)
- Verify all linked data sources return without error

---

## 15. HLTB (HowLongToBeat)

- `/hltb <game title>`
- Verify: playtime data returned (this is an external API call, verify no regression in integration)

---

## 16. Multiplayer Info

- `/mp-info <game>`
- Verify: multiplayer data returned correctly

---

## 17. Timestamp Utility

- `/timestamp <datetime>`
- Verify: Discord timestamp formatted correctly (no DB dependency, but check it loads)

---

## 18. Todo List

- `/todo add <item>`
- `/todo list`
- `/todo` complete or remove
- Verify: items persist across bot restarts

---

## 19. Thread Administration

- `/thread-admin` commands
- Verify: thread state changes (archive, unarchive, lock) work and are persisted

---

## 20. Live Event & Moderator Live Event

- `/moderator-live-event` to create a scheduled event + forum thread
- Verify: both created in Discord and linked correctly
- `/admin live-stream-admin` (if applicable)

---

## 21. Starboard (Reaction-Based)

- Post a message, react with the star emoji with 3+ unique users
- Verify: message posted to quotables/starboard channel with correct formatting and image passthrough
- Verify: entry recorded in DB (no duplicate on re-reaction)

---

## 22. Pin Emoji Automation

- React with the pin emoji on a message
- Verify: message pinned in channel
- Verify: pin logged

---

## 23. Server Change Audit Log

- Create a test channel, then delete it
- Create a test role, modify it, delete it
- Verify: all changes appear in the audit log channel

---

## 24. Scheduled / Background Services (Passive Checks)

After 30-60 minutes of running, verify in bot logs or Discord:

- [ ] Presence updated at 30-minute interval
- [ ] No reminder service errors in logs
- [ ] RSS feed check fires and posts (if any feeds configured)
- [ ] IGDB scan service running without error
- [ ] Thread sync service running without error
- [ ] Game release announcement service running without error (check logs)
- [ ] GameDB auto-image audit running without error

---

## 25. Avatar History (via UserUpdate event)

- Change a user's Discord avatar
- Run `/avatar-history @user`
- Verify: new avatar logged in history

---

## 26. Superadmin Commands

- `/superadmin` -- run applicable subcommands
- Verify: no DB errors, operations complete

---

## 27. IGDB Scan Service (Background)

- Check logs after several minutes for IGDB scan activity
- Verify: scan completes without Postgres errors
- Check a game that should have been auto-enriched by IGDB scan and verify data is current

---

## 28. Error Handling Regression

For each of these, verify the error message format (full request + full response as JSON code blocks):

- Call a command with an invalid game ID / unknown game
- Attempt a collection operation on a non-existent entry
- Force an API error (disconnect RPG Club API briefly if possible)
- Verify: error messages include method, URL, body (request) and status, body (response) -- not just a status code

---

## 29. Restart Resilience (Critical)

Restart the bot mid-state and verify:

- [ ] Pending reminders still fire on schedule
- [ ] Giveaway hub message still correct (or recreated)
- [ ] RSS feed polling resumes
- [ ] Now-playing opt-outs still respected
- [ ] Reaction-based completion flow can be resumed (stable custom IDs)
- [ ] Forum threads re-joined automatically

---

## 30. Postgres-Specific Checks

- Monitor bot logs for any remaining Oracle-specific SQL syntax errors (`ROWNUM`, `SYSDATE`, `NVL`, `DUAL`, `TO_DATE`, sequence-based ID generation)
- Check for connection pool exhaustion under load
- Verify transaction rollback behavior if a multi-step operation fails mid-way
- Check for any `ORA-` prefixed error codes still appearing in logs
- Run `/admin sql-health-check` again at end of session

---

## Sign-Off Criteria

All sections pass with no Postgres connection errors, no Oracle-syntax errors in logs, no data loss from pre-migration records, and all interactive flows complete end-to-end including button/modal resume after restart.
