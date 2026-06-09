# public.gamedb_franchises

**Type:** BASE TABLE  
**Estimated rows:** 520

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | franchise_id | bigint | No |  | BY DEFAULT |  |
| 2 | name | character varying(255) | No |  |  |  |
| 3 | igdb_franchise_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_franchises_igdb_franchise_id_key | btree | Yes | No | igdb_franchise_id |
| gamedb_franchises_pkey | btree | Yes | Yes | franchise_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_franchises_igdb_franchise_id_key ON public.gamedb_franchises USING btree (igdb_franchise_id);
CREATE UNIQUE INDEX gamedb_franchises_pkey ON public.gamedb_franchises USING btree (franchise_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16535_1_not_null | franchise_id IS NOT NULL |
| 2200_16535_2_not_null | name IS NOT NULL |
