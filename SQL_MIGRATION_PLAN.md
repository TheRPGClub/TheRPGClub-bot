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
| `:paramName` bind | `$1, $2, ...` positional |
| `SYSDATE` | `NOW()` |
| `SYSTIMESTAMP` | `NOW()` |
| `ROWNUM <= n` | `LIMIT n` |
| `LISTAGG(x, ',') WITHIN GROUP (ORDER BY y)` | `STRING_AGG(x, ',' ORDER BY y)` |
| `MERGE INTO t USING dual ON (...) WHEN NOT MATCHED THEN INSERT` | `INSERT INTO t ... ON CONFLICT (...) DO UPDATE SET ...` / `DO NOTHING` |
| `INSERT ... RETURNING x INTO :outVar` (with `BIND_OUT`) | `INSERT ... RETURNING x` (result in `rows[0]`) |
| `SELECT ... FROM dual` | `SELECT ...` (omit FROM dual) |
| `VARCHAR2` | `TEXT` or `VARCHAR` |
| `NUMBER` | `NUMERIC` or `INTEGER` |
| `DATE` | `TIMESTAMP` |
| `NVL(x, y)` | `COALESCE(x, y)` |
| `DECODE(x, v, r, def)` | `CASE WHEN x = v THEN r ELSE def END` |
| `CONNECT BY LEVEL` | `generate_series()` |

### Bind Parameter Offset for IN-list Builders

Oracle uses named binds (`:id0`, `:id1`), which are order-independent.
PostgreSQL uses positional (`$1`, `$2`), so IN-list factory functions must accept a `startOffset` parameter:

```typescript
buildInList: (ids: number[], startOffset = 1) => {
  const oraPlaceholders = ids.map((_, i) => `:id${i}`).join(", ");
  const pgPlaceholders  = ids.map((_, i) => `$${startOffset + i}`).join(", ");
  return {
    oracle:   `WHERE GAME_ID IN (${oraPlaceholders})`,
    postgres: `WHERE game_id IN (${pgPlaceholders})`,
  } satisfies SqlEntry;
},
```

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

### Next Step: Phase D (in progress) -- Dialect-agnostic execution wrappers

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

**Call sites -- current status:**

| File | Status |
|---|---|
| `AdminWizardSession.ts` | Partial -- `getActive` and `saveSession` done; `closeActive` uses `conn.execute` directly (oracle-specific) |
| `BotVotingInfo.ts` | Partial -- all `get*` and `mark*` done; `setRoundInfo` uses `conn.execute` (oracle-specific) |
| `CollectionCsvImport.ts` | Partial -- `getImportById` done; `createImport` (BIND_OUT) and `insertItem` (conn-passing) remain |
| `CompletionatorImport.ts` | Partial -- same pattern as CollectionCsvImport |
| `GameDbCsvImport.ts` | Partial -- same pattern |
| `GameDbCsvImportMapping.ts` | Fully migrated |
| `Game.ts` | Partial -- all standalone get/update/mutate done; BIND_OUT inserts, conn-passing blocks, and oracle-specific `conn.execute` paths remain |
| `GameKey.ts` | Partial -- `get*`, `list*`, `claim`, `revoke` done; `create` (BIND_OUT) remains |
| `GameReleaseAnnouncement.ts` | Partial -- `mark*` and `list*` done; `syncReleaseAnnouncements` (conn-passing) remains |
| `GameSearchSynonymDraft.ts` | Partial -- `getDraft`, `deleteDraft` done; `createDraft` (BIND_OUT), `appendPairs` (conn-passing) remain |
| `GameSearchSynonym.ts` | Partial -- standalone `dbQuery` lookups done; all mutation/insert paths use oracle conn-passing and BIND_OUT |
| `GotmAuditImport.ts` | Partial -- `getById` done; `createSession` (BIND_OUT) and bulk insert (conn-passing) remain |
| `Gotm.ts` | Partial -- most `get*` done; `updateRowOrder` and `commitRound` use conn-passing |
| `HltbCache.ts` | Fully migrated |
| `Member.ts` | Partial -- large file; many `get*` done; connection-passing and BIND_OUT methods remain |
| `Nomination.ts` | Fully migrated |
| `NrGotm.ts` | Partial -- `loadAll`, `updateVotingResults`, `checkRoundExists`, `deleteRound` done; conn-passing update block and BIND_OUT insert remain |
| `PresencePromptHistory.ts` | Fully migrated |
| `PresencePromptOptOut.ts` | Fully migrated |
| `PublicReminder.ts` | Partial -- `list*`, `delete`, `update*` done; `create` (BIND_OUT) remains |
| `Reminder.ts` | Partial -- all done except `create` (BIND_OUT) and `getById` (optional conn) |
| `RssFeed.ts` | Partial -- `removeFeed`, `updateFeed` done; `addFeed` (BIND_OUT), `markItemsSeen` (executeMany), `getSeenItemHashes` (conn-passing) remain |
| `Starboard.ts` | Fully migrated |
| `SteamCollectionImport.ts` | Partial -- `getActiveForUser`, `setStatus`, `updateIndex`, `updateItem`, `countItems*`, `getHistoricalMappedIds` done; `createImport` (BIND_OUT), `insertItems` (oraTransaction conn-passing), `getItemById`/`getNextPending` (fetchInfo conn), `getAppMap`/`upsertAppMap` (optional conn) remain |
| `SuggestionReviewSession.ts` | Partial -- `update`, `delete*` done; `create` (conn-passing) and `getById` (optional conn) remain |
| `Suggestion.ts` | Partial -- `list`, `count`, `delete` done; `create` (BIND_OUT) and `getById` (optional conn) remain |
| `Thread.ts` | Partial -- `upsertThread`, `setSkipLinking`, `getThreadSkipLinking` done; transactions and conn-passing remain |
| `Todo.ts` | Partial -- all done except `create` (BIND_OUT) |
| `UserActivityIcon.ts` | No D1 conversions possible -- all calls use dynamic Oracle-style named binds or oraTransaction conn-passing |
| `UserChannelMessageCount.ts` | Partial -- `getScannedChannelIds`, `getChannelScanMeta` done; `upsertChannelCounts` (executeMany) remains |
| `UserGameCollection.ts` | Partial -- all standalone selects and `removeEntry` done; `addEntry` (BIND_OUT), `updateEntry` (conn-passing), `getEntryById` (required conn) remain |
| `XboxCollectionImport.ts` | Partial -- `getActiveForUser`, `setStatus`, `updateIndex`, `getItemById`, `getNextPending`, `updateItem`, `countItems*`, `getHistoricalMappedIds` done; `createImport` (BIND_OUT), `insertItems` (oraTransaction), `getImportById`/`getTitleMap` (optional conn), `upsertTitleMap` (conn-passing) remain |

---

#### Remaining work in Phase D

**D1 -- COMPLETE**

All standalone `oraQuery`/`oraMutate` call sites (no BIND_OUT, no connection argument) have been
converted to `dbQuery`/`dbMutate`. No D1 work remains.

**D2 -- Oracle-only blockers (defer until postgres SQL is written)**

Two categories of calls cannot use `db*` wrappers yet:

1. **BIND_OUT** (`INSERT ... RETURNING x INTO :outVar`): These need postgres SQL filled in as
   `INSERT ... RETURNING x` and a new `dbInsert(entry, params): Promise<number>` wrapper that
   returns the generated id (uses `outBinds[0]` on Oracle, `rows[0].id` on Postgres).

2. **Connection-passing** (`oraWithConnection`/`oraTransaction` callbacks that call
   `oraMutate(sql, params, conn)` or `oraQuery(sql, params, mapper, conn)`): These multi-statement
   blocks need the postgres SQL filled in and the callback rewritten to accept a union connection
   type, dispatching to driver-specific calls inside.

**D3 -- `executeMany` (RssFeed.markItemsSeen)**

Oracle's `conn.executeMany` has no pg equivalent in the current wrappers. When porting, replace
with a per-row `pgMutate` loop or a postgres multi-row INSERT ... ON CONFLICT pattern.

#### Previously planned approach (still valid)

- `dbQuery` / `dbMutate` first (covers the bulk of standalone call sites).
- `dbWithConnection` / `dbTransaction` next (connection-scoped multi-statement blocks).
- BIND_OUT cases last (require postgres SQL to be written first).
- Run `tsc --noEmit` after each batch.
