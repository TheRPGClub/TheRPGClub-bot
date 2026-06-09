# Postgres SQL Issues Catalog

Findings from the postgres SQL sanity check (2026-06-09). All items below represent
functionality that will not work against the documented postgres schema without further
schema migration or query redesign.

---

## 1. `user_game_journal_prefs` -- table not in postgres schema

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

## 2. `user_game_journal_entries` -- table not in postgres schema

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

## 3. `journal_message_contexts` -- table not in postgres schema

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

- `searchMembers` (postgres) -- removed non-existent social columns from SELECT
- `getByUserId` (postgres) -- removed non-existent social columns from SELECT
- `updateMember` (postgres) -- removed non-existent social columns from SET clause
- `insertMember` (postgres) -- removed non-existent social columns from INSERT
- `getMembersWithPlatforms` (postgres) -- rewrote to JOIN `user_socials`/`social_platforms`

All five queries previously referenced `completionator_url`, `psn_username`,
`xbl_username`, `nsw_friend_code`, and/or `steam_url` on `rpg_club_users`, which no
longer has those columns in postgres (they were migrated to `user_socials`).

`getMembersWithPlatforms` uses conditional aggregation on `social_platforms.label` with
ILIKE matching (`%steam%`, `%psn%`/`%playstation%`, `%xbox%`, `%nintendo%`/`%switch%`)
to reconstruct the original per-platform column structure. Platform matching depends on
the labels in `social_platforms` at runtime.
