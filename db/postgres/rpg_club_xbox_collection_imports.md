# public.rpg_club_xbox_collection_imports

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | import_id | bigint | No | nextval('rpg_club_xbox_collection_imports_import_id_seq'::regclass) |  |  |
| 2 | user_id | character varying(30) | No |  |  |  |
| 3 | status | character varying(20) | No |  |  |  |
| 4 | current_index | bigint | No | 0 |  |  |
| 5 | total_count | bigint | No | 0 |  |  |
| 6 | xuid | character varying(30) | Yes |  |  |  |
| 7 | gamertag | character varying(100) | Yes |  |  |  |
| 8 | source_type | character varying(20) | No |  |  |  |
| 9 | source_file_name | character varying(255) | Yes |  |  |  |
| 10 | source_file_size | bigint | Yes |  |  |  |
| 11 | template_version | character varying(20) | Yes |  |  |  |
| 12 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 13 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_xbox_coll_imports_user | btree | No | No | user_id, status |
| rpg_club_xbox_collection_imports_pkey | btree | Yes | Yes | import_id |

### Index Definitions

```sql
CREATE INDEX ix_xbox_coll_imports_user ON public.rpg_club_xbox_collection_imports USING btree (user_id, status);
CREATE UNIQUE INDEX rpg_club_xbox_collection_imports_pkey ON public.rpg_club_xbox_collection_imports USING btree (import_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_65617_12_not_null | created_at IS NOT NULL |
| 2200_65617_13_not_null | updated_at IS NOT NULL |
| 2200_65617_1_not_null | import_id IS NOT NULL |
| 2200_65617_2_not_null | user_id IS NOT NULL |
| 2200_65617_3_not_null | status IS NOT NULL |
| 2200_65617_4_not_null | current_index IS NOT NULL |
| 2200_65617_5_not_null | total_count IS NOT NULL |
| 2200_65617_8_not_null | source_type IS NOT NULL |
| ck_xbox_coll_imports_source | ((source_type)::text = ANY ((ARRAY['API'::character varying, 'CSV'::character varying])::text[])) |
| ck_xbox_coll_imports_status | ((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'PAUSED'::character varying, 'COMPLETED'::character varying, 'CANCELED'::character varying])::text[])) |
