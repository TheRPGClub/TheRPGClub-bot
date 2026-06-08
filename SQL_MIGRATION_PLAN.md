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
