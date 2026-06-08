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

- `GameSearchSynonym.ts`
- `Gotm.ts`
- `NrGotm.ts`
- `PublicReminder.ts` (SQL lives in `reminder.sql.ts` as `PublicReminderSql`)
- `RssFeed.ts`
- `Starboard.ts`
- `Thread.ts`
- `UserActivityIcon.ts`
- `UserChannelMessageCount.ts`

---

### Phase A: SQL file exists, class not yet wired (zero `getSql` calls)

Wire each class to its already-created `.sql.ts` file. Sorted by approximate SQL hit count (descending).

| Class | Approx. raw SQL hits | SQL file |
|---|---|---|
| `GameReleaseAnnouncement.ts` | 24 | `gameReleaseAnnouncement.sql.ts` |
| `AdminWizardSession.ts` | 19 | `adminWizardSession.sql.ts` |
| `CollectionCsvImport.ts` | 18 | `collectionCsvImport.sql.ts` |
| `CompletionatorImport.ts` | 16 | `completionatorImport.sql.ts` |
| `GotmAuditImport.ts` | 15 | `gotmAuditImport.sql.ts` |
| `GameDbCsvImport.ts` | 14 | `gameDbCsvImport.sql.ts` |
| `GameKey.ts` | 10 | `gameKey.sql.ts` |
| `BotVotingInfo.ts` | 10 | `botVotingInfo.sql.ts` |
| `Nomination.ts` | 7 | `nomination.sql.ts` |
| `PresencePromptHistory.ts` | 5 | `presencePrompt.sql.ts` |
| `PresencePromptOptOut.ts` | 3 | `presencePrompt.sql.ts` |

---

### Phase B: Partially wired (SQL file exists, but raw SQL still remains inline)

| Class | Approx. remaining raw SQL hits | SQL file |
|---|---|---|
| `Member.ts` | 114 | `member.sql.ts` |
| `Game.ts` | 25 | `game.sql.ts` |
| `XboxCollectionImport.ts` | 6 | `xboxCollectionImport.sql.ts` |
| `SteamCollectionImport.ts` | 6 | `steamCollectionImport.sql.ts` |
| `Reminder.ts` | 3 | `reminder.sql.ts` |
| `UserGameCollection.ts` | 2 | `userGameCollection.sql.ts` |
| `Todo.ts` | 2 | `todo.sql.ts` |
| `SuggestionReviewSession.ts` | 2 | `suggestion.sql.ts` |
| `Suggestion.ts` | 2 | `suggestion.sql.ts` |
| `HltbCache.ts` | 2 | `hltbCache.sql.ts` |
| `GameSearchSynonymDraft.ts` | 1 | `gameSearchSynonym.sql.ts` |

---

### Phase C: SQL file missing -- extract first, then wire

| Class | Approx. raw SQL hits | Action |
|---|---|---|
| `GameDbCsvImportMapping.ts` | 8 | Create `gameDbCsvImportMapping.sql.ts` (or extend `gameDbCsvImport.sql.ts`), then wire the class |

---

### Suggested Completion Order

1. **Phase C first** -- `GameDbCsvImportMapping.ts` has no sql file yet; create it before wiring.
2. **Phase B `Member.ts` and `Game.ts`** -- largest backlogs; finish these to clear the biggest debt.
3. **Phase A batch** -- all sql files already exist; wire the remaining 11 classes in one pass.
4. **Phase B tail** -- finish the 9 smaller partially-wired classes.
5. **Phase D (below)** -- make the execution wrappers dialect-agnostic.

---

### Phase D: Dialect-agnostic execution wrappers

#### Current state

`SqlManager.ts` exposes four Oracle-specific helpers and re-exports two Postgres helpers:

| Wrapper | Dialect | Call sites | Notes |
|---|---|---|---|
| `oraQuery(sql, params, mapper)` | Oracle only | 210 | Mapper function inline at call site |
| `oraMutate(sql, params, conn?)` | Oracle only | 205 | Returns `oracledb.Result<unknown>` |
| `oraWithConnection(callback)` | Oracle only | 84 | Callback receives `oracledb.Connection` |
| `oraTransaction(callback)` | Oracle only | 26 | Callback receives `oracledb.Connection` |
| `pgQuery(text, values?)` | Postgres only | 3 | No mapper -- returns raw rows |
| `pgTransaction(callback)` | Postgres only | 2 | Callback receives `pg.PoolClient` |

No `pgMutate` or `pgWithConnection` exists. The two sides also have incompatible signatures
(e.g., `oraQuery` requires a mapper at the call site; `pgQuery` does not).

#### What needs to be built

**1. Add missing Postgres helpers to `postgresClient.ts`**

```typescript
/** Runs a DML statement and returns rowCount. */
export async function pgMutate(
  text: string,
  values?: unknown[],
): Promise<number> {
  const result = await getPostgresPool().query(text, values);
  return result.rowCount ?? 0;
}

/** Acquires a client, runs callback, then releases it. */
export async function pgWithConnection<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}
```

**2. Add dialect-agnostic wrappers to `SqlManager.ts`**

These dispatch to `ora*` or `pg*` based on `getDialect()`. They accept a `SqlEntry` directly so
`getSql` never needs to be called at the call site.

```typescript
/** SELECT: runs the dialect variant and maps each row. */
export async function dbQuery<RowT extends object, R>(
  entry: SqlEntry,
  params: unknown[],
  mapper: (row: RowT) => R,
): Promise<R[]>

/** DML: runs the dialect variant, returns rows-affected count. */
export async function dbMutate(
  entry: SqlEntry,
  params: unknown[],
): Promise<number>

/** Acquire/release a single connection for multiple statements. */
export async function dbWithConnection<T>(
  callback: (conn: oracledb.Connection | pg.PoolClient) => Promise<T>,
): Promise<T>

/** Atomic transaction: commit on success, rollback on throw. */
export async function dbTransaction<T>(
  callback: (conn: oracledb.Connection | pg.PoolClient) => Promise<T>,
): Promise<T>
```

**Design notes:**
- `params` unifies Oracle `BindParameters` and Postgres `unknown[]`. Oracle named binds
  (`:name`) and Postgres positional (`$1`) are already separated by the `SqlEntry` oracle/postgres
  keys, so call sites can pass a plain array or object that matches their dialect's SQL.
- The `dbWithConnection` / `dbTransaction` callback type is a union. Callers that need to issue
  multiple statements inside one connection will need a small internal helper per dialect, or accept
  the union and narrow with `instanceof`.
- Oracle `RETURNING ... INTO :outVar` (bind-out) has no direct Postgres analogue in a shared
  signature -- those call sites need individual attention when porting.

**3. Migrate all call sites**

Replace every `oraQuery` / `oraMutate` / `oraWithConnection` / `oraTransaction` call with the
corresponding `db*` wrapper. Scope: ~525 call sites across 37+ files (see table above for per-file
counts from the first column of Phase A/B).

**4. Re-export `pgMutate` and `pgWithConnection` from `SqlManager.ts`**

Keep `SqlManager.ts` as the single import point for all DB helpers.

#### Suggested approach

- Implement and test `dbQuery` / `dbMutate` first (covers 415 of the 525 call sites).
- Tackle `dbWithConnection` next (84 sites, mostly bulk-import classes).
- Do `dbTransaction` last (26 sites, already well-isolated in transaction-scoped methods).
- Run `tsc --noEmit` after each batch.
