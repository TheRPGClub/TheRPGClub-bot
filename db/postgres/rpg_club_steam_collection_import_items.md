# public.rpg_club_steam_collection_import_items

**Type:** BASE TABLE  
**Estimated rows:** 3175

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | item_id | bigint | No |  | BY DEFAULT |  |
| 2 | import_id | bigint | No |  |  |  |
| 3 | row_index | bigint | No |  |  |  |
| 4 | steam_app_id | bigint | No |  |  |  |
| 5 | steam_app_name | character varying(500) | No |  |  |  |
| 6 | playtime_forever_min | bigint | Yes |  |  |  |
| 7 | playtime_windows_min | bigint | Yes |  |  |  |
| 8 | playtime_mac_min | bigint | Yes |  |  |  |
| 9 | playtime_linux_min | bigint | Yes |  |  |  |
| 10 | playtime_deck_min | bigint | Yes |  |  |  |
| 11 | last_played_at | timestamp(0) without time zone | Yes |  |  |  |
| 12 | status | character varying(20) | No |  |  |  |
| 13 | match_confidence | character varying(20) | Yes |  |  |  |
| 14 | match_candidate_json | text | Yes |  |  |  |
| 15 | gamedb_game_id | bigint | Yes |  |  |  |
| 16 | collection_entry_id | bigint | Yes |  |  |  |
| 17 | error_text | character varying(2000) | Yes |  |  |  |
| 18 | result_reason | character varying(40) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_steam_coll_items_app | btree | No | No | steam_app_id |
| ix_steam_coll_items_import | btree | No | No | import_id, status, row_index |
| rpg_club_steam_collection_import_items_pkey | btree | Yes | Yes | item_id |

### Index Definitions

```sql
CREATE INDEX ix_steam_coll_items_app ON public.rpg_club_steam_collection_import_items USING btree (steam_app_id);
CREATE INDEX ix_steam_coll_items_import ON public.rpg_club_steam_collection_import_items USING btree (import_id, status, row_index);
CREATE UNIQUE INDEX rpg_club_steam_collection_import_items_pkey ON public.rpg_club_steam_collection_import_items USING btree (item_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_steam_coll_import_items | import_id | public.rpg_club_steam_collection_imports(import_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16811_12_not_null | status IS NOT NULL |
| 2200_16811_1_not_null | item_id IS NOT NULL |
| 2200_16811_2_not_null | import_id IS NOT NULL |
| 2200_16811_3_not_null | row_index IS NOT NULL |
| 2200_16811_4_not_null | steam_app_id IS NOT NULL |
| 2200_16811_5_not_null | steam_app_name IS NOT NULL |
| ck_steam_coll_items_reason | ((COALESCE((result_reason)::text, ''::text) = ''::text) OR ((result_reason)::text = ANY (ARRAY[('AUTO_MATCH'::character varying)::text, ('MANUAL_REMAP'::character varying)::text, ('DUPLICATE'::character varying)::text, ('MANUAL_SKIP'::character varying)::text, ('SKIP_MAPPED'::character varying)::text, ('NO_CANDIDATE'::character varying)::text, ('INVALID_REMAP'::character varying)::text, ('PLATFORM_UNRESOLVED'::character varying)::text, ('ADD_FAILED'::character varying)::text]))) |
| ck_steam_coll_items_status | ((status)::text = ANY (ARRAY[('PENDING'::character varying)::text, ('ADDED'::character varying)::text, ('UPDATED'::character varying)::text, ('SKIPPED'::character varying)::text, ('FAILED'::character varying)::text])) |
