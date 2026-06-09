# public.gamedb_game_genres

**Type:** BASE TABLE  
**Estimated rows:** 18411

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | game_id | bigint | No |  |  |  |
| 2 | genre_id | bigint | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_genres_pkey | btree | Yes | Yes | game_id, genre_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_genres_pkey ON public.gamedb_game_genres USING btree (game_id, genre_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gamedb_game_genres_game | game_id | public.gamedb_games(game_id) | NO ACTION | CASCADE |
| fk_gamedb_game_genres_genre | genre_id | public.gamedb_genres(genre_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16551_1_not_null | game_id IS NOT NULL |
| 2200_16551_2_not_null | genre_id IS NOT NULL |
