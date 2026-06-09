# SQL Centralization Plan: Oracle + PostgreSQL Dual-Dialect Registry

## Context

SQL statements are currently embedded inline throughout domain class files (`Game.ts`, `Member.ts`, etc.), making the Oracle-to-PostgreSQL migration opaque and error-prone. The goal is to extract every SQL statement into a centralized registry so that:

1. Both Oracle and PostgreSQL variants live side-by-side in one place.
2. A dialect-aware getter in `SqlManager` selects the right variant at runtime.
3. Domain classes hold zero raw SQL -- only call sites.

This is the intermediate step between the current Oracle-only codebase and a future API-driven architecture.

---

## New Types (add to `src/db/SqlManager.ts`)

```typescript
export type Dialect = "oracle" | "postgres";

export interface SqlEntry {
  oracle: string;
  postgres: string;
}

/** Pick the dialect-appropriate string from a static SqlEntry. */
export function getSql(entry: SqlEntry, dialect: Dialect): string {
  return entry[dialect];
}

/**
 * Pick the dialect-appropriate string from a dynamic (factory) SqlEntry.
 * Used for queries that build WHERE/ORDER clauses at runtime.
 */
export function getSqlDynamic<TArgs extends unknown[]>(
  factory: (...args: TArgs) => SqlEntry,
  dialect: Dialect,
  ...args: TArgs
): string {
  return factory(...args)[dialect];
}
```

---

## SQL File Layout

Mirror the domain class structure under `src/db/sql/`:

```
src/db/sql/
  types.ts                  -- re-exports Dialect, SqlEntry (source of truth)
  game.sql.ts               -- GameSql object  (~105 statements)
  member.sql.ts             -- MemberSql object (~131 statements)
  reminder.sql.ts           -- ReminderSql
  gotm.sql.ts               -- GotmSql / NrGotmSql
  gameSearchSynonym.sql.ts  -- GameSearchSynonymSql
  xboxCollectionImport.sql.ts
  steamCollectionImport.sql.ts
  suggestion.sql.ts
  thread.sql.ts
  starboard.sql.ts
  userActivity.sql.ts       -- UserActivityIcon, UserChannelMessageCount
  userGameCollection.sql.ts
  publicReminder.sql.ts
  todo.sql.ts
  rssFeed.sql.ts
  hltbCache.sql.ts
  index.ts                  -- barrel re-export of all Sql* objects
```

Each `*.sql.ts` file exports a single `const XxxSql` object. Keys are camelCase query names. Values are either `SqlEntry` (static) or a factory `(...dynamicParts) => SqlEntry` (dynamic).

---

## Static SQL Entry Pattern

```typescript
// src/db/sql/game.sql.ts
import type { SqlEntry } from "./types.js";

export const GameSql = {
  getById: {
    oracle: `SELECT GAME_ID, TITLE, ... FROM GAMEDB_GAMES WHERE GAME_ID = :id`,
    postgres: `SELECT game_id, title, ... FROM gamedb_games WHERE game_id = $1`,
  } satisfies SqlEntry,
  // ...
};
```

---

## Dynamic SQL Entry Pattern

Dynamic SQL (WHERE clause builders, IN-list expanders) is stored as a factory function that returns a `SqlEntry`:

```typescript
export const GameSql = {
  searchGames: (whereClause: string, orderBy: string) =>
    ({
      oracle: `WITH upcoming AS (...)
               SELECT ... FROM GAMEDB_GAMES g
               LEFT JOIN upcoming u ON u.GAME_ID = g.GAME_ID
               WHERE ${whereClause}
               ORDER BY ${orderBy}`,
      postgres: `WITH upcoming AS (...)
                 SELECT ... FROM gamedb_games g
                 LEFT JOIN upcoming u ON u.game_id = g.game_id
                 WHERE ${whereClause}
                 ORDER BY ${orderBy}`,
    }) satisfies SqlEntry,
};
```

Dynamic parts (whereClause, orderBy) are always code-generated, never raw user input -- this preserves the existing security posture.

---

## Oracle -> PostgreSQL Syntax Mapping

| Oracle | PostgreSQL |
|---|---|
| `:paramName` named bind | `:paramName` named bind (converted to `$N` at runtime by `namedToPositional`) |
| `SYSDATE` | `CURRENT_DATE` |
| `SYSTIMESTAMP` | `NOW()` |
| `CURRENT_TIMESTAMP` | `CURRENT_TIMESTAMP` (works in both) |
| `ROWNUM <= n` | `LIMIT n` |
| `FETCH FIRST n ROWS ONLY` | `LIMIT n` |
| `OFFSET n ROWS FETCH NEXT m ROWS ONLY` | `LIMIT m OFFSET n` |
| `LISTAGG(x, ',') WITHIN GROUP (ORDER BY y)` | `STRING_AGG(x, ',' ORDER BY y)` |
| `MERGE INTO t USING dual ON (...) WHEN NOT MATCHED THEN INSERT` | `INSERT INTO t ... ON CONFLICT (...) DO UPDATE SET ...` / `DO NOTHING` |
| `INSERT ... RETURNING x INTO :outVar` (with `BIND_OUT`) | `INSERT ... RETURNING x` (result in `rows[0]`) |
| `SELECT ... FROM dual` | `SELECT ...` (omit FROM dual) |
| `NVL(x, y)` | `COALESCE(x, y)` |
| `NUMTODSINTERVAL(:days, 'DAY')` | `:days * INTERVAL '1 day'` |
| `REGEXP_REPLACE(str, pat, '')` | `REGEXP_REPLACE(str, pat, '', 'g')` (requires `'g'` flag) |
| `UPPER_TABLE_NAME` | `lower_table_name` |
| `COLUMN_NAME` (uppercase) | `column_name` (lowercase) |
| `ALL_TAB_COLUMNS` system catalog | `information_schema.columns` |
| `SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')` | `current_schema()` |
| Integer booleans `0`/`1` | Native booleans `false`/`true` |

### Named Bind Parameters

Both Oracle and Postgres SQL in the registry use `:paramName` syntax. At runtime,
`namedToPositional` in `src/db/postgresClient.ts` converts `:name` -> `$N` before sending to the
`pg` driver. This means call sites require zero changes between dialects.

---

## Migration Steps Per File

For each domain class:

1. Create the corresponding `src/db/sql/xxx.sql.ts` file.
2. Copy every SQL string literal (and factory) out of the class into the new file as a named `SqlEntry`.
3. Replace the inline SQL in the class with a `getSql(XxxSql.queryName, dialect)` call (or `getSqlDynamic` for factories).
4. Import `dialect` from a shared runtime config (see below).
5. Run `tsc --noEmit` after each file to catch type errors.

### Execution Order (by statement count, largest first)

1. `Member.ts` (131 statements) -> `member.sql.ts`
2. `Game.ts` (105 statements) -> `game.sql.ts`
3. `XboxCollectionImport.ts` (29) -> `xboxCollectionImport.sql.ts`
4. `SteamCollectionImport.ts` (29) -> `steamCollectionImport.sql.ts`
5. `GameSearchSynonym.ts` / `GameSearchSynonymDraft.ts` (23) -> `gameSearchSynonym.sql.ts`
6. Remaining classes (~130 statements spread across ~18 files)

---

## Dialect Runtime Selection

Add a `DB_DIALECT` env var (`"oracle"` | `"postgres"`) read once at startup:

```typescript
// src/db/dialect.ts
import type { Dialect } from "./sql/types.js";

export function getDialect(): Dialect {
  const d = process.env.DB_DIALECT;
  if (d !== "oracle" && d !== "postgres") {
    throw new Error(`DB_DIALECT must be "oracle" or "postgres", got: ${d}`);
  }
  return d;
}
```

Domain classes call `getDialect()` once per method (or cache it at module load). No global mutable state needed.

---

## Files to Create

| File | Action |
|---|---|
| `src/db/sql/types.ts` | New -- `Dialect`, `SqlEntry` types |
| `src/db/sql/game.sql.ts` | New -- extracted from `Game.ts` |
| `src/db/sql/member.sql.ts` | New -- extracted from `Member.ts` |
| `src/db/sql/reminder.sql.ts` | New -- from `Reminder.ts`, `PublicReminder.ts` |
| `src/db/sql/gotm.sql.ts` | New -- from `Gotm.ts`, `NrGotm.ts` |
| `src/db/sql/gameSearchSynonym.sql.ts` | New -- from `GameSearchSynonym.ts` / draft |
| `src/db/sql/xboxCollectionImport.sql.ts` | New |
| `src/db/sql/steamCollectionImport.sql.ts` | New |
| `src/db/sql/suggestion.sql.ts` | New -- from `Suggestion.ts`, `SuggestionReviewSession.ts` |
| `src/db/sql/thread.sql.ts` | New |
| `src/db/sql/starboard.sql.ts` | New |
| `src/db/sql/userActivity.sql.ts` | New |
| `src/db/sql/userGameCollection.sql.ts` | New |
| `src/db/sql/todo.sql.ts` | New |
| `src/db/sql/rssFeed.sql.ts` | New |
| `src/db/sql/hltbCache.sql.ts` | New |
| `src/db/sql/index.ts` | New -- barrel |
| `src/db/dialect.ts` | New -- `getDialect()` |
| `src/db/SqlManager.ts` | Update -- add `getSql`, `getSqlDynamic`, `Dialect`, `SqlEntry` exports |

## Files to Modify (domain classes)

All files in `src/classes/` that contain inline SQL. No logic changes -- SQL string extraction only.

---

## Verification

After each class migration:

```bash
tsc --noEmit
```

End-to-end (requires both DBs running):
- Set `DB_DIALECT=oracle` and exercise the affected commands manually.
- Set `DB_DIALECT=postgres` and repeat.
- Confirm query results match between dialects for representative cases.

---

## Out of Scope

- Postgres schema creation / migration scripts (separate effort).
- Switching the live bot off Oracle (happens after PostgreSQL schema is validated).
- Any logic changes in domain classes beyond SQL extraction.

---

## Remaining Work (as of 2026-06-08)

### Fully Migrated (no inline SQL remaining)

All domain classes now hold zero raw standalone SQL. Every class uses `getSql(XxxSql.key, dialect)`
or `XxxSql.factory(args)[dialect]` for all database calls.

Note: `Member.ts` and `Game.ts` retain a small number of code-generated SQL fragment strings
(dynamic WHERE clause builders, IN-list expanders) that are constructed at runtime and are not
standalone queries -- these are intentionally left inline.

Previously fully migrated:
- `GameSearchSynonym.ts`
- `Gotm.ts`
- `NrGotm.ts`
- `PublicReminder.ts`
- `RssFeed.ts`
- `Starboard.ts`
- `Thread.ts`
- `UserActivityIcon.ts`
- `UserChannelMessageCount.ts`

Migrated in this phase (Phases A/B/C):
- `AdminWizardSession.ts`
- `BotVotingInfo.ts`
- `CollectionCsvImport.ts`
- `CompletionatorImport.ts`
- `Game.ts`
- `GameDbCsvImport.ts`
- `GameDbCsvImportMapping.ts` (new sql file: `gameDbCsvImportMapping.sql.ts`)
- `GameKey.ts`
- `GameReleaseAnnouncement.ts`
- `GameSearchSynonymDraft.ts`
- `GotmAuditImport.ts`
- `HltbCache.ts`
- `Member.ts`
- `Nomination.ts`
- `PresencePromptHistory.ts`
- `PresencePromptOptOut.ts`
- `Reminder.ts`
- `Suggestion.ts`
- `SuggestionReviewSession.ts`
- `Todo.ts`
- `UserGameCollection.ts`
- `XboxCollectionImport.ts`
- `SteamCollectionImport.ts`

---

---

### Phase E: Postgres SQL variants -- COMPLETE (PR #546, 2026-06-08)

All 23 domain SQL registry files now have complete `postgres:` variants. The `namedToPositional`
helper in `postgresClient.ts` converts `:paramName` -> `$N` at runtime so call sites need no
changes. `tsc --noEmit` passes clean.

Files completed: `starboard`, `hltbCache`, `gameDbCsvImportMapping`, `nomination`,
`adminWizardSession`, `presencePrompt`, `userActivity`, `todo`, `botVotingInfo`, `gameKey`,
`reminder`, `rssFeed`, `suggestion`, `thread`, `gameReleaseAnnouncement`, `gotm`,
`gameSearchSynonym`, `gameDbCsvImport`, `collectionCsvImport`, `completionatorImport`,
`gotmAuditImport`, `userGameCollection`, `steamCollectionImport`, `xboxCollectionImport`,
`member`, `game`.

---

### Phase D2 -- COMPLETE (PR #553, 2026-06-09, branch `fix/postgres-sql-sanity-checks`)

All remaining Oracle-specific execution patterns (BIND_OUT, `oraWithConnection`,
`oraTransaction`, `conn.execute`, `conn.executeMany`, BIND_OUT) have been replaced with
dialect-agnostic wrappers across all 8 remaining domain files and 1 service. `tsc --noEmit`
passes clean.

Key technique notes:
- `instanceof oracledb.Connection` does not work with the oracledb type definitions -- use
  `getDialect() === "oracle"` instead and cast `conn as oracledb.Connection` in oracle branches.
- `mapGameRow` updated to handle both Oracle (uppercase) and Postgres (lowercase) column names
  via `??` fallback on every field.
- Dynamic SQL factories (e.g. `searchGames(whereClause, orderPrefix)`) that embed
  dialect-specific SQL fragments require building the fragments inside a `dbWithConnection`
  callback where the dialect is known, then passing a `SqlEntry` to `dbQueryConn`.

---

### Phase D: Dialect-agnostic execution wrappers

#### Completed as of 2026-06-08

**Infrastructure (done, on branch `feature/phase-d-dialect-agnostic-wrappers`):**

- `pgMutate` and `pgWithConnection` added to `src/db/postgresClient.ts`
- `ora*` helpers (`oraQuery`, `oraMutate`, `oraWithConnection`, `oraTransaction`) moved from
  `SqlManager.ts` to `src/db/oracleClient.ts` -- mirrors `postgresClient.ts` structure
- `SqlManager.ts` now re-exports everything from both clients and adds four dialect-agnostic
  wrappers:
  - `dbQuery(entry, params, mapper)` -- SELECT, picks dialect SQL from `SqlEntry`
  - `dbMutate(entry, params)` -- DML, returns rows-affected count
  - `dbWithConnection(callback)` -- single-connection scope
  - `dbTransaction(callback)` -- atomic transaction

**D1 complete as of 2026-06-08 (PR #545, branch `feature/phase-d-d1-remaining-call-sites`):**

All standalone `oraQuery`/`oraMutate` calls (no BIND_OUT, no connection-passing) have been
converted to `dbQuery`/`dbMutate` across all domain classes. Every remaining `ora*` call in the
codebase is now a D2 blocker.

**D2 new wrappers added to `postgresClient.ts` and `SqlManager.ts`:**

- `pgInsert(sql, params)` -- runs INSERT RETURNING on pool, returns first column of first row
- `pgInsertConn(client, sql, params)` -- same on an existing PoolClient
- `pgQueryConn(client, sql, params)` -- SELECT on an existing PoolClient
- `pgMutateConn(client, sql, params)` -- DML on an existing PoolClient
- `dbInsert(entry, params, bindOutKey)` -- dialect-agnostic INSERT returning generated id
- `dbInsertConn(conn, entry, params, bindOutKey)` -- same, inside a connection callback
- `dbQueryConn(conn, entry, params, mapper)` -- dialect-agnostic SELECT inside a callback
- `dbMutateConn(conn, entry, params)` -- dialect-agnostic DML inside a callback

**Call sites -- D2 status as of 2026-06-09 (ALL COMPLETE):**

| File | D2 Status |
|---|---|
| `AdminWizardSession.ts` | COMPLETE |
| `BotVotingInfo.ts` | COMPLETE |
| `CollectionCsvImport.ts` | COMPLETE |
| `CompletionatorImport.ts` | COMPLETE |
| `GameDbCsvImport.ts` | COMPLETE |
| `GameDbCsvImportMapping.ts` | COMPLETE |
| `Game.ts` | COMPLETE (PR #553) |
| `GameKey.ts` | COMPLETE |
| `GameReleaseAnnouncement.ts` | COMPLETE (PR #553) |
| `GameSearchSynonymDraft.ts` | COMPLETE |
| `GameSearchSynonym.ts` | COMPLETE |
| `GotmAuditImport.ts` | COMPLETE |
| `Gotm.ts` | COMPLETE |
| `HltbCache.ts` | COMPLETE |
| `Member.ts` | COMPLETE (PR #553) |
| `Nomination.ts` | COMPLETE |
| `NrGotm.ts` | COMPLETE |
| `PresencePromptHistory.ts` | COMPLETE |
| `PresencePromptOptOut.ts` | COMPLETE |
| `PublicReminder.ts` | COMPLETE |
| `Reminder.ts` | COMPLETE |
| `RssFeed.ts` | COMPLETE (PR #553) |
| `RssFeedService.ts` | COMPLETE (PR #553) |
| `Starboard.ts` | COMPLETE |
| `SteamCollectionImport.ts` | COMPLETE (PR #553) |
| `SuggestionReviewSession.ts` | COMPLETE |
| `Suggestion.ts` | COMPLETE |
| `Thread.ts` | COMPLETE |
| `Todo.ts` | COMPLETE |
| `UserActivityIcon.ts` | COMPLETE (PR #553) |
| `UserChannelMessageCount.ts` | COMPLETE (PR #553) |
| `UserGameCollection.ts` | COMPLETE |
| `XboxCollectionImport.ts` | COMPLETE (PR #553) |

---

#### Remaining work in Phase D

**D1 -- COMPLETE**

**D2 -- COMPLETE (PR #553, 2026-06-09)**

All BIND_OUT inserts, conn-passing blocks, and executeMany patterns have been replaced.

**D3 -- COMPLETE (folded into D2)**

`executeMany` was replaced with per-row `dbMutateConn` loops inside `dbTransaction` in
`RssFeed.markItemsSeen` and `UserChannelMessageCount.upsertChannelCounts`.

#### Approach (still valid)

- `dbQuery` / `dbMutate` for all standalone call sites.
- `dbWithConnection` / `dbTransaction` for connection-scoped multi-statement blocks.
- `dbInsert` / `dbInsertConn` for BIND_OUT INSERT patterns.
- `dbQueryConn` / `dbMutateConn` inside connection callbacks.
- Run `tsc --noEmit` after each batch.
