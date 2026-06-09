# public.rpg_club_gamedb_import_items

**Type:** BASE TABLE  
**Estimated rows:** 8704

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | item_id | bigint | No |  | BY DEFAULT |  |
| 2 | import_id | bigint | No |  |  |  |
| 3 | row_index | bigint | No |  |  |  |
| 4 | game_title | character varying(500) | No |  |  |  |
| 5 | platform_name | character varying(200) | Yes |  |  |  |
| 6 | region_name | character varying(200) | Yes |  |  |  |
| 7 | initial_release_date | timestamp(0) without time zone | Yes |  |  |  |
| 8 | status | character varying(20) | No |  |  |  |
| 9 | gamedb_game_id | bigint | Yes |  |  |  |
| 10 | error_text | character varying(2000) | Yes |  |  |  |
| 11 | raw_game_title | character varying(500) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_gamedb_items_import | btree | No | No | import_id, status, row_index |
| rpg_club_gamedb_import_items_pkey | btree | Yes | Yes | item_id |

### Index Definitions

```sql
CREATE INDEX ix_gamedb_items_import ON public.rpg_club_gamedb_import_items USING btree (import_id, status, row_index);
CREATE UNIQUE INDEX rpg_club_gamedb_import_items_pkey ON public.rpg_club_gamedb_import_items USING btree (item_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gamedb_import_items | import_id | public.rpg_club_gamedb_imports(import_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16709_1_not_null | item_id IS NOT NULL |
| 2200_16709_2_not_null | import_id IS NOT NULL |
| 2200_16709_3_not_null | row_index IS NOT NULL |
| 2200_16709_4_not_null | game_title IS NOT NULL |
| 2200_16709_8_not_null | status IS NOT NULL |
