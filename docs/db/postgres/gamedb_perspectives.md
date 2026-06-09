# public.gamedb_perspectives

**Type:** BASE TABLE  
**Estimated rows:** 7

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | perspective_id | bigint | No |  | BY DEFAULT |  |
| 2 | name | character varying(100) | No |  |  |  |
| 3 | igdb_perspective_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_perspectives_igdb_perspective_id_key | btree | Yes | No | igdb_perspective_id |
| gamedb_perspectives_pkey | btree | Yes | Yes | perspective_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_perspectives_igdb_perspective_id_key ON public.gamedb_perspectives USING btree (igdb_perspective_id);
CREATE UNIQUE INDEX gamedb_perspectives_pkey ON public.gamedb_perspectives USING btree (perspective_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16584_1_not_null | perspective_id IS NOT NULL |
| 2200_16584_2_not_null | name IS NOT NULL |
