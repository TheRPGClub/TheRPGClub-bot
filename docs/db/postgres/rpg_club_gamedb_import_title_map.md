# public.rpg_club_gamedb_import_title_map

**Type:** BASE TABLE  
**Estimated rows:** 4368

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | map_id | bigint | No |  | BY DEFAULT |  |
| 2 | title_raw | character varying(500) | No |  |  |  |
| 3 | title_norm | character varying(500) | No |  |  |  |
| 4 | gamedb_game_id | bigint | Yes |  |  |  |
| 5 | status | character varying(20) | No |  |  |  |
| 6 | created_by | character varying(30) | Yes |  |  |  |
| 7 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 8 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_gamedb_import_title_status | btree | No | No | status |
| rpg_club_gamedb_import_title_map_pkey | btree | Yes | Yes | map_id |
| ux_gamedb_import_title_norm | btree | Yes | No | title_norm |

### Index Definitions

```sql
CREATE INDEX ix_gamedb_import_title_status ON public.rpg_club_gamedb_import_title_map USING btree (status);
CREATE UNIQUE INDEX rpg_club_gamedb_import_title_map_pkey ON public.rpg_club_gamedb_import_title_map USING btree (map_id);
CREATE UNIQUE INDEX ux_gamedb_import_title_norm ON public.rpg_club_gamedb_import_title_map USING btree (title_norm);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16715_1_not_null | map_id IS NOT NULL |
| 2200_16715_2_not_null | title_raw IS NOT NULL |
| 2200_16715_3_not_null | title_norm IS NOT NULL |
| 2200_16715_5_not_null | status IS NOT NULL |
| 2200_16715_7_not_null | created_at IS NOT NULL |
| 2200_16715_8_not_null | updated_at IS NOT NULL |
