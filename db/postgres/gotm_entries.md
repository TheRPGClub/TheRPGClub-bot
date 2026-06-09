# public.gotm_entries

**Type:** BASE TABLE  
**Estimated rows:** 156

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | gotm_id | bigint | No |  | BY DEFAULT |  |
| 2 | round_number | integer | No |  |  |  |
| 3 | month_year | character varying(200) | No |  |  |  |
| 4 | game_index | smallint | No |  |  |  |
| 5 | reddit_url | character varying(2048) | Yes |  |  |  |
| 6 | voting_results_message_id | character varying(200) | Yes |  |  |  |
| 7 | gamedb_game_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gotm_entries_pkey | btree | Yes | Yes | gotm_id |
| idx_gotm_entries_game | btree | No | No | gamedb_game_id |
| ix_gotm_month_year | btree | No | No | month_year |
| ix_gotm_round | btree | No | No | round_number |
| uk_gotm_round_idx | btree | Yes | No | round_number, game_index |

### Index Definitions

```sql
CREATE UNIQUE INDEX gotm_entries_pkey ON public.gotm_entries USING btree (gotm_id);
CREATE INDEX idx_gotm_entries_game ON public.gotm_entries USING btree (gamedb_game_id);
CREATE INDEX ix_gotm_month_year ON public.gotm_entries USING btree (month_year);
CREATE INDEX ix_gotm_round ON public.gotm_entries USING btree (round_number);
CREATE UNIQUE INDEX uk_gotm_round_idx ON public.gotm_entries USING btree (round_number, game_index);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16630_1_not_null | gotm_id IS NOT NULL |
| 2200_16630_2_not_null | round_number IS NOT NULL |
| 2200_16630_3_not_null | month_year IS NOT NULL |
| 2200_16630_4_not_null | game_index IS NOT NULL |
