Oracle table for per-game journal default settings.

## Columns

| Column | Type | Nullable | Default | Description |
| --- | --- | --- | --- | --- |
| USER_ID | VARCHAR2(30) | No | - | Discord user id. |
| GAMEDB_GAME_ID | NUMBER | No | - | GameDB game id. |
| IS_ENABLED | NUMBER(1,0) | No | 0 | Whether journal mode replaces Now Playing note display for this game. |
| DEFAULT_IS_PUBLIC | NUMBER(1,0) | No | 0 | Default privacy for new journal entries (`0` private, `1` public). |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Row creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Last update timestamp. |

## Keys

- Primary key: `(USER_ID, GAMEDB_GAME_ID)`.
- Foreign key: `GAMEDB_GAME_ID -> GAMEDB_GAMES.GAME_ID`.
