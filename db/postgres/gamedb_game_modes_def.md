# public.gamedb_game_modes_def

**Type:** BASE TABLE  
**Estimated rows:** 6

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | mode_id | bigint | No |  | BY DEFAULT |  |
| 2 | name | character varying(100) | No |  |  |  |
| 3 | igdb_game_mode_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_modes_def_igdb_game_mode_id_key | btree | Yes | No | igdb_game_mode_id |
| gamedb_game_modes_def_pkey | btree | Yes | Yes | mode_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_modes_def_igdb_game_mode_id_key ON public.gamedb_game_modes_def USING btree (igdb_game_mode_id);
CREATE UNIQUE INDEX gamedb_game_modes_def_pkey ON public.gamedb_game_modes_def USING btree (mode_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16557_1_not_null | mode_id IS NOT NULL |
| 2200_16557_2_not_null | name IS NOT NULL |
