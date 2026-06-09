# public.nr_gotm_entries

**Type:** BASE TABLE  
**Estimated rows:** 32

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | round_number | bigint | No |  |  |  |
| 2 | month_year | character varying(50) | No |  |  |  |
| 3 | game_index | bigint | No |  |  |  |
| 4 | reddit_url | character varying(500) | Yes |  |  |  |
| 5 | voting_results_message_id | character varying(50) | Yes |  |  |  |
| 6 | nr_gotm_id | bigint | No |  | BY DEFAULT |  |
| 7 | gamedb_game_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| idx_nr_gotm_entries_game | btree | No | No | gamedb_game_id |
| nr_gotm_entries_pkey | btree | Yes | Yes | nr_gotm_id |
| ux_nr_gotm_entries_rnd_idx | btree | Yes | No | round_number, game_index |

### Index Definitions

```sql
CREATE INDEX idx_nr_gotm_entries_game ON public.nr_gotm_entries USING btree (gamedb_game_id);
CREATE UNIQUE INDEX nr_gotm_entries_pkey ON public.nr_gotm_entries USING btree (nr_gotm_id);
CREATE UNIQUE INDEX ux_nr_gotm_entries_rnd_idx ON public.nr_gotm_entries USING btree (round_number, game_index);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16646_1_not_null | round_number IS NOT NULL |
| 2200_16646_2_not_null | month_year IS NOT NULL |
| 2200_16646_3_not_null | game_index IS NOT NULL |
| 2200_16646_6_not_null | nr_gotm_id IS NOT NULL |
