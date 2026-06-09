# Dead Code Catalog

Audit performed 2026-06-09. "Dead" means: not reachable from any active bot command,
registered event handler, or service started at runtime. Unused imports and minor
code-style issues are out of scope -- this covers entire features, modules, and
integration paths with no live entry point.

---

## 1. Xbox Collection Import System

**Status:** Fully dead. No command, handler, or service calls into this system.

| File | Lines |
|------|-------|
| `src/classes/XboxCollectionImport.ts` | 458 |
| `src/db/sql/xboxCollectionImport.sql.ts` | 365 |

**What it does:** A complete interactive import workflow that would let users paste their
Xbox Game Pass library and walk through a matching/mapping UI to add games to their
collection -- similar to the Steam collection import and Completionator CSV import that
are both live.

**Why it's dead:** The command that would drive it was never written. The class and SQL
layer were built first; the Discord-facing command half was never completed.

**Orphaned exports:**

`XboxCollectionImportSql` is re-exported from `src/db/sql/index.ts` (line 39) but
nothing outside `xboxCollectionImport.sql.ts` itself imports it.

`src/classes/XboxCollectionImport.ts` exports 14 async functions and several types, none
of which appear in any command, service, or test file.

**Database tables created but only used by dead code:**
- `RPG_CLUB_XBOX_COLLECTION_IMPORTS`
- `RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS`
- `RPG_CLUB_XBOX_TITLE_GAMEDB_MAP`

(Schema migration: `scripts/sql/2026/20260207_create_xbox_collection_imports.sql`)

**Note:** The XBL username field on member profiles (`xbl_username` column, `/profile
edit xbl:`, `/mp-info`) is NOT dead -- it is actively read and displayed.

---

## 2. Standalone Maintenance Scripts with No Package.json Entry

**Status:** Orphaned. They exist in `src/scripts/` but have no `npm run` entry and are
not imported by any bot module.

### `src/scripts/reimport-release-dates.ts`

A one-off Oracle-targeting script that iterates `GAMEDB_GAMES`, fetches updated release
dates from IGDB for each game, and writes them back via `oraMutate`. It was likely run
once to backfill data. It hard-codes Oracle calls and cannot run against Postgres.

No `package.json` script entry. Not imported anywhere.

### `src/scripts/snapshot-url.ts`

A Playwright-based CLI tool: give it a URL, it opens a headless browser and screenshots
the page. Useful for one-off debugging or generating report images. Has a `package.json`
entry (`npm run snapshot:url`) so it is runnable, but is not part of bot startup and has
no callers in production code.

**Note:** `src/scripts/import-igdb-platforms.ts` and `src/scripts/explore-postgres.ts`
also exist as standalone scripts but both have `package.json` entries and serve clear
ongoing-maintenance purposes (platform data seeding and schema exploration). They are not
flagged as dead.

**Note:** `src/scripts/SearchHltb.ts` is not dead -- it is imported by both
`hltb.command.ts` and `gamedb/gamedb-view.command.ts`.

---

## 3. Journal SQL Functions Targeting Non-Existent Postgres Tables

**Status:** The functions exist and are callable, but every postgres variant will throw
"relation does not exist" at runtime because the backing tables are not yet in the
postgres schema. The Oracle variants work fine. This is a portability gap, not fully dead
code, but the postgres path is effectively broken.

**File:** `src/db/sql/member.sql.ts`

**Tables missing from postgres schema** (per `docs/postgres_sql_issues.md`):
- `user_game_journal_prefs`
- `user_game_journal_entries`
- `journal_message_contexts`

**Affected functions:**

| Function | Issue |
|----------|-------|
| `mergeJournalPrefs` | references `user_game_journal_prefs` |
| `getGameJournalPreference` | references `user_game_journal_prefs` |
| `upsertGameJournalPreference` | references `user_game_journal_prefs` |
| `getGameJournalList` | references `user_game_journal_prefs` |
| `getJournalGames` | LEFT JOINs `user_game_journal_prefs` |
| `getJournalGamesWithStats` | JOINs both journal tables |
| `createJournalEntry` | inserts into `user_game_journal_entries` |
| `getJournalEntries` | selects from `user_game_journal_entries` |
| `countJournalEntries` | counts `user_game_journal_entries` |
| `getJournalEntry` | selects from `user_game_journal_entries` |
| `updateJournalEntry` | updates `user_game_journal_entries` |
| `deleteJournalEntry` | deletes from `user_game_journal_entries` |
| `saveJournalMessageContext` | inserts into `journal_message_contexts` |
| `deleteJournalMessageContext` | deletes from `journal_message_contexts` |
| `getJournalMessageContexts` | selects from `journal_message_contexts` |
| `pruneJournalMessageContexts` | deletes from `journal_message_contexts` |

The `getNowPlayingForUser` and `getJournalGamesWithStats` functions also embed subqueries
against `user_game_journal_entries`, which fail on postgres.

All three tables are documented in `scripts/sql/2026/` migration files, meaning the
schema was designed but apparently not yet applied to the postgres instance.

---

## 4. `RawModalSession.ts` -- Oracle-Only Implementation

**Status:** Partially dead on the postgres path.

**File:** `src/services/raw-modal/RawModalSession.ts`

This file imports `oraQuery`, `oraMutate`, and `oraWithConnection` directly from
`SqlManager` rather than going through the dialect-agnostic wrapper. All session
read/write operations (lines 127, 161, 173, 187, 204) call Oracle functions
unconditionally. If `DB_DIALECT=postgres`, all raw-modal session persistence silently
fails or errors.

The raw modal system itself is active and gated by a feature flag
(`RawModalFeatureFlag.ts`), so this is not entirely dead -- but the persistence layer
only works for Oracle.

---

## Summary Table

| Item | Files | Approx LOC | Disposition |
|------|-------|-----------|-------------|
| Xbox Collection Import | `XboxCollectionImport.ts`, `xboxCollectionImport.sql.ts`, export in `sql/index.ts` | ~823 | Fully dead; safe to delete |
| `reimport-release-dates.ts` | `src/scripts/reimport-release-dates.ts` | ~130 | Likely one-shot already run; Oracle-only |
| `snapshot-url.ts` | `src/scripts/snapshot-url.ts` | ~40 | Dev utility; not part of bot |
| Journal postgres SQL | `src/db/sql/member.sql.ts` (postgres variants) | n/a (broken path within active file) | Blocked on schema migration |
| RawModalSession Oracle coupling | `src/services/raw-modal/RawModalSession.ts` | n/a (active file, dialect gap) | Needs postgres path |
