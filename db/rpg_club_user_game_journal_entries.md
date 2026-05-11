Oracle table for per-game journal entries.

## Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| ENTRY_ID | NUMBER | No | Identity | Journal entry id. |
| USER_ID | VARCHAR2(30) | No | - | Discord user id owning this entry. |
| GAMEDB_GAME_ID | NUMBER | No | - | GameDB game id for this entry. |
| ENTRY_TITLE | VARCHAR2(120) | Yes | - | Optional user-defined title. |
| ENTRY_BODY | VARCHAR2(2000) | No | - | Journal body text. |
| IS_PUBLIC | NUMBER(1,0) | No | 0 | Entry privacy (`0` private, `1` public). |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Entry timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Last update timestamp. |

## Keys and Indexes

- Primary key: `ENTRY_ID`.
- Foreign key: `GAMEDB_GAME_ID -> GAMEDB_GAMES.GAME_ID`.
- Index: `IX_UGJE_USER_GAME_CREATED` on `(USER_ID, GAMEDB_GAME_ID, CREATED_AT DESC)`.
