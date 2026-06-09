# public.gamedb_platforms

**Type:** BASE TABLE  
**Estimated rows:** 224

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | platform_id | bigint | No |  | BY DEFAULT |  |
| 2 | platform_code | character varying(20) | No |  |  |  |
| 3 | platform_name | character varying(100) | No |  |  |  |
| 4 | igdb_platform_id | bigint | Yes |  |  |  |
| 5 | platform_abbreviation | character varying(50) | Yes |  |  |  |
| 6 | platform_slug | character varying(255) | Yes |  |  |  |
| 7 | platform_checksum | character varying(64) | Yes |  |  |  |
| 8 | igdb_updated_at | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_platforms_igdb_platform_id_key | btree | Yes | No | igdb_platform_id |
| gamedb_platforms_pkey | btree | Yes | Yes | platform_id |
| gamedb_platforms_platform_code_key | btree | Yes | No | platform_code |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_platforms_igdb_platform_id_key ON public.gamedb_platforms USING btree (igdb_platform_id);
CREATE UNIQUE INDEX gamedb_platforms_pkey ON public.gamedb_platforms USING btree (platform_id);
CREATE UNIQUE INDEX gamedb_platforms_platform_code_key ON public.gamedb_platforms USING btree (platform_code);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16588_1_not_null | platform_id IS NOT NULL |
| 2200_16588_2_not_null | platform_code IS NOT NULL |
| 2200_16588_3_not_null | platform_name IS NOT NULL |
