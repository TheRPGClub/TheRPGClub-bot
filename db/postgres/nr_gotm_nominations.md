# public.nr_gotm_nominations

**Type:** BASE TABLE  
**Estimated rows:** 10

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | nomination_id | bigint | No |  | BY DEFAULT |  |
| 2 | round_number | bigint | No |  |  |  |
| 3 | user_id | character varying(64) | No |  |  |  |
| 4 | nominated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 5 | reason | character varying(1500) | Yes |  |  |  |
| 6 | gamedb_game_id | bigint | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_nr_gotm_noms_round | btree | No | No | round_number |
| nr_gotm_nominations_pkey | btree | Yes | Yes | nomination_id |
| ux_nr_gotm_noms_round_user | btree | Yes | No | round_number, user_id |

### Index Definitions

```sql
CREATE INDEX ix_nr_gotm_noms_round ON public.nr_gotm_nominations USING btree (round_number);
CREATE UNIQUE INDEX nr_gotm_nominations_pkey ON public.nr_gotm_nominations USING btree (nomination_id);
CREATE UNIQUE INDEX ux_nr_gotm_noms_round_user ON public.nr_gotm_nominations USING btree (round_number, user_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16652_1_not_null | nomination_id IS NOT NULL |
| 2200_16652_2_not_null | round_number IS NOT NULL |
| 2200_16652_3_not_null | user_id IS NOT NULL |
| 2200_16652_4_not_null | nominated_at IS NOT NULL |
| 2200_16652_6_not_null | gamedb_game_id IS NOT NULL |
