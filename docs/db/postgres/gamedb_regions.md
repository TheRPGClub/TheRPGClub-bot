# public.gamedb_regions

**Type:** BASE TABLE  
**Estimated rows:** 8

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | region_id | bigint | No |  | BY DEFAULT |  |
| 2 | region_code | character varying(10) | No |  |  |  |
| 3 | region_name | character varying(100) | No |  |  |  |
| 4 | igdb_region_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_regions_igdb_region_id_key | btree | Yes | No | igdb_region_id |
| gamedb_regions_pkey | btree | Yes | Yes | region_id |
| gamedb_regions_region_code_key | btree | Yes | No | region_code |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_regions_igdb_region_id_key ON public.gamedb_regions USING btree (igdb_region_id);
CREATE UNIQUE INDEX gamedb_regions_pkey ON public.gamedb_regions USING btree (region_id);
CREATE UNIQUE INDEX gamedb_regions_region_code_key ON public.gamedb_regions USING btree (region_code);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16592_1_not_null | region_id IS NOT NULL |
| 2200_16592_2_not_null | region_code IS NOT NULL |
| 2200_16592_3_not_null | region_name IS NOT NULL |
