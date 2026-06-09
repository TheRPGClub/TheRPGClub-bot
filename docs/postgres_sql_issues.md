# Postgres SQL Issues Catalog

Findings from the postgres SQL sanity check (2026-06-09). All items below represent
functionality that will not work against the documented postgres schema without further
schema migration or query redesign.

---

## 1. `getMembersWithPlatforms` -- query must be rewritten

**File:** `src/db/sql/member.sql.ts`
**Function:** `getMembersWithPlatforms`

The postgres variant SELECTs `steam_url`, `psn_username`, `xbl_username`, and
`nsw_friend_code` from `rpg_club_users`, and its WHERE clause filters on those same
columns (`WHERE steam_url IS NOT NULL OR ...`).

Those columns no longer exist on `rpg_club_users` in postgres. They were migrated out
to the `user_socials` table (backed up in `_rpg_club_users_socials_backup`).

The query needs to be rewritten to JOIN with `user_socials` and filter by `platform_id`
using values from the `social_platforms` table. The correct platform IDs for Steam, PSN,
Xbox, and NSW are required to do this.

---

## 2. `user_game_journal_prefs` -- table not in postgres schema

**File:** `src/db/sql/member.sql.ts`
**Affected functions:**
- `mergeJournalPrefs`
- `getGameJournalPreference`
- `upsertGameJournalPreference`
- `toggleJournalPref` (referenced in several places in member.sql.ts)
- `getGameJournalList`
- `getJournalGames` (via LEFT JOIN)
- `getJournalGamesWithStats`

The table `user_game_journal_prefs` is referenced extensively in postgres SQL but does
not appear in the documented postgres schema (`docs/db/postgres/_index.md`). All queries
touching this table will fail with "relation does not exist".

This table exists in Oracle. A matching postgres table needs to be created and documented
before these queries can work.

---

## 3. `user_game_journal_entries` -- table not in postgres schema

**File:** `src/db/sql/member.sql.ts`
**Affected functions:**
- `createJournalEntry`
- `getJournalEntries`
- `countJournalEntries`
- `getJournalEntry`
- `updateJournalEntry`
- `deleteJournalEntry`
- Multiple SELECT subqueries in `getNowPlayingForUser`, `getJournalGamesWithStats`, etc.

The table `user_game_journal_entries` is referenced extensively in postgres SQL but does
not appear in the documented postgres schema. All queries touching this table will fail.

This table exists in Oracle. A matching postgres table needs to be created and documented
before these queries can work.

---

## 4. `journal_message_contexts` -- table not in postgres schema

**File:** `src/db/sql/member.sql.ts`
**Affected functions:**
- `saveJournalMessageContext` (INSERT INTO journal_message_contexts)
- `deleteJournalMessageContext` (DELETE FROM journal_message_contexts)
- `getJournalMessageContexts` (SELECT FROM journal_message_contexts)
- `pruneJournalMessageContexts` (DELETE FROM journal_message_contexts)

The table `journal_message_contexts` is referenced in postgres SQL but does not appear
in the documented postgres schema. All queries touching this table will fail.

This table exists in Oracle. A matching postgres table needs to be created and documented
before these queries can work.

---

## Summary of fixed issues

The following issues were corrected in this same PR:

| Query | Fix |
| ----- | --- |
| `searchMembers` (postgres) | Removed non-existent social columns from SELECT |
| `getByUserId` (postgres) | Removed non-existent social columns from SELECT |
| `updateMember` (postgres) | Removed non-existent social columns from SET clause |
| `insertMember` (postgres) | Removed non-existent social columns from INSERT |

All four queries referenced `completionator_url`, `psn_username`, `xbl_username`,
`nsw_friend_code`, and `steam_url` on `rpg_club_users`, which no longer has those
columns in postgres (they were migrated to `user_socials`).
