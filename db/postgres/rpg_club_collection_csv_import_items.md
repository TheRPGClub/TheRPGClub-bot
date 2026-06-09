# public.rpg_club_collection_csv_import_items

**Type:** BASE TABLE  
**Estimated rows:** 1709

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | item_id | bigint | No |  | BY DEFAULT |  |
| 2 | import_id | bigint | No |  |  |  |
| 3 | row_index | bigint | No |  |  |  |
| 4 | raw_title | character varying(500) | No |  |  |  |
| 5 | raw_platform | character varying(200) | Yes |  |  |  |
| 6 | raw_ownership_type | character varying(60) | Yes |  |  |  |
| 7 | raw_note | character varying(500) | Yes |  |  |  |
| 8 | raw_gamedb_id | bigint | Yes |  |  |  |
| 9 | raw_igdb_id | bigint | Yes |  |  |  |
| 10 | platform_id | bigint | Yes |  |  |  |
| 11 | ownership_type | character varying(30) | Yes |  |  |  |
| 12 | note | character varying(500) | Yes |  |  |  |
| 13 | status | character varying(20) | No |  |  |  |
| 14 | match_confidence | character varying(20) | Yes |  |  |  |
| 15 | match_candidate_json | text | Yes |  |  |  |
| 16 | gamedb_game_id | bigint | Yes |  |  |  |
| 17 | collection_entry_id | bigint | Yes |  |  |  |
| 18 | result_reason | character varying(40) | Yes |  |  |  |
| 19 | error_text | character varying(2000) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_coll_csv_items_import | btree | No | No | import_id, status, row_index |
| rpg_club_collection_csv_import_items_pkey | btree | Yes | Yes | item_id |

### Index Definitions

```sql
CREATE INDEX ix_coll_csv_items_import ON public.rpg_club_collection_csv_import_items USING btree (import_id, status, row_index);
CREATE UNIQUE INDEX rpg_club_collection_csv_import_items_pkey ON public.rpg_club_collection_csv_import_items USING btree (item_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_coll_csv_import_items | import_id | public.rpg_club_collection_csv_imports(import_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16669_13_not_null | status IS NOT NULL |
| 2200_16669_1_not_null | item_id IS NOT NULL |
| 2200_16669_2_not_null | import_id IS NOT NULL |
| 2200_16669_3_not_null | row_index IS NOT NULL |
| 2200_16669_4_not_null | raw_title IS NOT NULL |
| ck_coll_csv_items_reason | ((COALESCE((result_reason)::text, ''::text) = ''::text) OR ((result_reason)::text = ANY (ARRAY[('AUTO_MATCH'::character varying)::text, ('CSV_GAMEDB_ID'::character varying)::text, ('CSV_IGDB_ID'::character varying)::text, ('MANUAL_REMAP'::character varying)::text, ('DUPLICATE'::character varying)::text, ('MANUAL_SKIP'::character varying)::text, ('NO_CANDIDATE'::character varying)::text, ('INVALID_REMAP'::character varying)::text, ('PLATFORM_UNRESOLVED'::character varying)::text, ('ADD_FAILED'::character varying)::text, ('INVALID_ROW'::character varying)::text]))) |
| ck_coll_csv_items_status | ((status)::text = ANY (ARRAY[('PENDING'::character varying)::text, ('ADDED'::character varying)::text, ('UPDATED'::character varying)::text, ('SKIPPED'::character varying)::text, ('FAILED'::character varying)::text])) |
