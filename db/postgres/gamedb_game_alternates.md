# public.gamedb_game_alternates

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | game_id | bigint | No |  |  |  |
| 2 | alt_game_id | bigint | No |  |  |  |
| 3 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 4 | created_by | character varying(64) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_alternates_pkey | btree | Yes | Yes | game_id, alt_game_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_alternates_pkey ON public.gamedb_game_alternates USING btree (game_id, alt_game_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16539_1_not_null | game_id IS NOT NULL |
| 2200_16539_2_not_null | alt_game_id IS NOT NULL |
| 2200_16539_3_not_null | created_at IS NOT NULL |
| ck_gamedb_game_alts_order | (game_id < alt_game_id) |
