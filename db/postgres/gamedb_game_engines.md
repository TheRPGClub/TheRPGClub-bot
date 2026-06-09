# public.gamedb_game_engines

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | game_id | bigint | No |  |  |  |
| 2 | engine_id | bigint | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_engines_pkey | btree | Yes | Yes | game_id, engine_id |
| index_gamedb_game_engines_on_engine_id | btree | No | No | engine_id |
| index_gamedb_game_engines_on_game_id | btree | No | No | game_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_engines_pkey ON public.gamedb_game_engines USING btree (game_id, engine_id);
CREATE INDEX index_gamedb_game_engines_on_engine_id ON public.gamedb_game_engines USING btree (engine_id);
CREATE INDEX index_gamedb_game_engines_on_game_id ON public.gamedb_game_engines USING btree (game_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_ge_engine | engine_id | public.gamedb_engines(engine_id) | NO ACTION | NO ACTION |
| fk_ge_game | game_id | public.gamedb_games(game_id) | NO ACTION | CASCADE |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_65660_1_not_null | game_id IS NOT NULL |
| 2200_65660_2_not_null | engine_id IS NOT NULL |
