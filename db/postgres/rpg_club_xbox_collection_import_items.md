# public.rpg_club_xbox_collection_import_items

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | item_id | bigint | No | nextval('rpg_club_xbox_collection_import_items_item_id_seq'::regclass) |  |  |
| 2 | import_id | bigint | No |  |  |  |
| 3 | row_index | bigint | No |  |  |  |
| 4 | xbox_title_id | character varying(40) | Yes |  |  |  |
| 5 | xbox_product_id | character varying(80) | Yes |  |  |  |
| 6 | xbox_title_name | character varying(500) | No |  |  |  |
| 7 | raw_platform | character varying(200) | Yes |  |  |  |
| 8 | raw_ownership_type | character varying(60) | Yes |  |  |  |
| 9 | raw_note | character varying(500) | Yes |  |  |  |
| 10 | raw_gamedb_id | bigint | Yes |  |  |  |
| 11 | raw_igdb_id | bigint | Yes |  |  |  |
| 12 | platform_id | bigint | Yes |  |  |  |
| 13 | ownership_type | character varying(30) | Yes |  |  |  |
| 14 | note | character varying(500) | Yes |  |  |  |
| 15 | status | character varying(20) | No |  |  |  |
| 16 | match_confidence | character varying(20) | Yes |  |  |  |
| 17 | match_candidate_json | text | Yes |  |  |  |
| 18 | gamedb_game_id | bigint | Yes |  |  |  |
| 19 | collection_entry_id | bigint | Yes |  |  |  |
| 20 | result_reason | character varying(40) | Yes |  |  |  |
| 21 | error_text | character varying(2000) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_xbox_coll_items_import | btree | No | No | import_id, status, row_index |
| ix_xbox_coll_items_title | btree | No | No | xbox_title_id |
| rpg_club_xbox_collection_import_items_pkey | btree | Yes | Yes | item_id |

### Index Definitions

```sql
CREATE INDEX ix_xbox_coll_items_import ON public.rpg_club_xbox_collection_import_items USING btree (import_id, status, row_index);
CREATE INDEX ix_xbox_coll_items_title ON public.rpg_club_xbox_collection_import_items USING btree (xbox_title_id);
CREATE UNIQUE INDEX rpg_club_xbox_collection_import_items_pkey ON public.rpg_club_xbox_collection_import_items USING btree (item_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_xbox_coll_import_items | import_id | public.rpg_club_xbox_collection_imports(import_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_65631_15_not_null | status IS NOT NULL |
| 2200_65631_1_not_null | item_id IS NOT NULL |
| 2200_65631_2_not_null | import_id IS NOT NULL |
| 2200_65631_3_not_null | row_index IS NOT NULL |
| 2200_65631_6_not_null | xbox_title_name IS NOT NULL |
| ck_xbox_coll_items_reason | ((result_reason IS NULL) OR ((result_reason)::text = ANY ((ARRAY['AUTO_MATCH'::character varying, 'XBOX_GAMEDB_ID'::character varying, 'XBOX_IGDB_ID'::character varying, 'MANUAL_REMAP'::character varying, 'DUPLICATE'::character varying, 'MANUAL_SKIP'::character varying, 'SKIP_MAPPED'::character varying, 'NO_CANDIDATE'::character varying, 'INVALID_REMAP'::character varying, 'PLATFORM_UNRESOLVED'::character varying, 'ADD_FAILED'::character varying, 'INVALID_ROW'::character varying])::text[]))) |
| ck_xbox_coll_items_status | ((status)::text = ANY ((ARRAY['PENDING'::character varying, 'ADDED'::character varying, 'UPDATED'::character varying, 'SKIPPED'::character varying, 'FAILED'::character varying])::text[])) |
