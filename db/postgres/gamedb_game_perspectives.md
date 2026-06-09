# public.gamedb_game_perspectives

**Type:** BASE TABLE  
**Estimated rows:** 7135

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | game_id | bigint | No |  |  |  |
| 2 | perspective_id | bigint | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_perspectives_pkey | btree | Yes | Yes | game_id, perspective_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_perspectives_pkey ON public.gamedb_game_perspectives USING btree (game_id, perspective_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gp_game | game_id | public.gamedb_games(game_id) | NO ACTION | CASCADE |
| fk_gp_perspective | perspective_id | public.gamedb_perspectives(perspective_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16561_1_not_null | game_id IS NOT NULL |
| 2200_16561_2_not_null | perspective_id IS NOT NULL |
