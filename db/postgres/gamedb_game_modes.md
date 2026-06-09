# public.gamedb_game_modes

**Type:** BASE TABLE  
**Estimated rows:** 10453

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | game_id | bigint | No |  |  |  |
| 2 | mode_id | bigint | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_modes_pkey | btree | Yes | Yes | game_id, mode_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_modes_pkey ON public.gamedb_game_modes USING btree (game_id, mode_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gm_game | game_id | public.gamedb_games(game_id) | NO ACTION | CASCADE |
| fk_gm_mode | mode_id | public.gamedb_game_modes_def(mode_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16554_1_not_null | game_id IS NOT NULL |
| 2200_16554_2_not_null | mode_id IS NOT NULL |
