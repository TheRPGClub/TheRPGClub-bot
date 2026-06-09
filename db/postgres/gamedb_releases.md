# public.gamedb_releases

**Type:** BASE TABLE  
**Estimated rows:** 23639

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | release_id | bigint | No |  | BY DEFAULT |  |
| 2 | game_id | bigint | No |  |  |  |
| 3 | platform_id | bigint | No |  |  |  |
| 4 | region_id | bigint | No |  |  |  |
| 5 | format | character varying(20) | Yes |  |  |  |
| 6 | release_date | timestamp(0) without time zone | Yes |  |  |  |
| 7 | notes | character varying(255) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_releases_pkey | btree | Yes | Yes | release_id |
| idx_gamedb_releases_game | btree | No | No | game_id |
| idx_gamedb_releases_platform | btree | No | No | platform_id |
| idx_gamedb_releases_region | btree | No | No | region_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_releases_pkey ON public.gamedb_releases USING btree (release_id);
CREATE INDEX idx_gamedb_releases_game ON public.gamedb_releases USING btree (game_id);
CREATE INDEX idx_gamedb_releases_platform ON public.gamedb_releases USING btree (platform_id);
CREATE INDEX idx_gamedb_releases_region ON public.gamedb_releases USING btree (region_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gamedb_releases_game | game_id | public.gamedb_games(game_id) | NO ACTION | CASCADE |
| fk_gamedb_releases_platform | platform_id | public.gamedb_platforms(platform_id) | NO ACTION | NO ACTION |
| fk_gamedb_releases_region | region_id | public.gamedb_regions(region_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16601_1_not_null | release_id IS NOT NULL |
| 2200_16601_2_not_null | game_id IS NOT NULL |
| 2200_16601_3_not_null | platform_id IS NOT NULL |
| 2200_16601_4_not_null | region_id IS NOT NULL |
| sys_c009076 | ((format)::text = ANY (ARRAY[('Physical'::character varying)::text, ('Digital'::character varying)::text])) |
