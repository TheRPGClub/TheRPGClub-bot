# public.gamedb_game_franchises

**Type:** BASE TABLE  
**Estimated rows:** 3018

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | game_id | bigint | No |  |  |  |
| 2 | franchise_id | bigint | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_franchises_pkey | btree | Yes | Yes | game_id, franchise_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_franchises_pkey ON public.gamedb_game_franchises USING btree (game_id, franchise_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gf_franchise | franchise_id | public.gamedb_franchises(franchise_id) | NO ACTION | NO ACTION |
| fk_gf_game | game_id | public.gamedb_games(game_id) | NO ACTION | CASCADE |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16548_1_not_null | game_id IS NOT NULL |
| 2200_16548_2_not_null | franchise_id IS NOT NULL |
