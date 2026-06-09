# public.rpg_club_completionator_import_items

**Type:** BASE TABLE  
**Estimated rows:** 16145

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | item_id | bigint | No |  | BY DEFAULT |  |
| 2 | import_id | bigint | No |  |  |  |
| 3 | row_index | bigint | No |  |  |  |
| 4 | game_title | character varying(500) | No |  |  |  |
| 5 | platform_name | character varying(200) | Yes |  |  |  |
| 6 | region_name | character varying(200) | Yes |  |  |  |
| 7 | source_type | character varying(100) | Yes |  |  |  |
| 8 | time_text | character varying(50) | Yes |  |  |  |
| 9 | completed_at | timestamp(0) without time zone | Yes |  |  |  |
| 10 | completion_type | character varying(50) | Yes |  |  |  |
| 11 | playtime_hrs | numeric | Yes |  |  |  |
| 12 | status | character varying(20) | No |  |  |  |
| 13 | gamedb_game_id | bigint | Yes |  |  |  |
| 14 | completion_id | bigint | Yes |  |  |  |
| 15 | error_text | character varying(2000) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_completionator_items_import | btree | No | No | import_id, status, row_index |
| rpg_club_completionator_import_items_pkey | btree | Yes | Yes | item_id |

### Index Definitions

```sql
CREATE INDEX ix_completionator_items_import ON public.rpg_club_completionator_import_items USING btree (import_id, status, row_index);
CREATE UNIQUE INDEX rpg_club_completionator_import_items_pkey ON public.rpg_club_completionator_import_items USING btree (item_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_completionator_import_items | import_id | public.rpg_club_completionator_imports(import_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16686_12_not_null | status IS NOT NULL |
| 2200_16686_1_not_null | item_id IS NOT NULL |
| 2200_16686_2_not_null | import_id IS NOT NULL |
| 2200_16686_3_not_null | row_index IS NOT NULL |
| 2200_16686_4_not_null | game_title IS NOT NULL |
