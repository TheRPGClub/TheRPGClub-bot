# public.gamedb_engines

**Type:** BASE TABLE  
**Estimated rows:** 435

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | engine_id | bigint | No |  | BY DEFAULT |  |
| 2 | name | character varying(255) | No |  |  |  |
| 3 | igdb_engine_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_engines_igdb_engine_id_key | btree | Yes | No | igdb_engine_id |
| gamedb_engines_pkey | btree | Yes | Yes | engine_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_engines_igdb_engine_id_key ON public.gamedb_engines USING btree (igdb_engine_id);
CREATE UNIQUE INDEX gamedb_engines_pkey ON public.gamedb_engines USING btree (engine_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16531_1_not_null | engine_id IS NOT NULL |
| 2200_16531_2_not_null | name IS NOT NULL |
