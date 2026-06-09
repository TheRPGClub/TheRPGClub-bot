# public.rpg_club_steam_collection_imports

**Type:** BASE TABLE  
**Estimated rows:** 3

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | import_id | bigint | No |  | BY DEFAULT |  |
| 2 | user_id | character varying(30) | No |  |  |  |
| 3 | status | character varying(20) | No |  |  |  |
| 4 | current_index | bigint | No | 0 |  |  |
| 5 | total_count | bigint | No | 0 |  |  |
| 6 | steam_id64 | character varying(20) | No |  |  |  |
| 7 | steam_profile_ref | character varying(255) | Yes |  |  |  |
| 8 | source_profile_name | character varying(255) | Yes |  |  |  |
| 9 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 10 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_steam_coll_imports_user | btree | No | No | user_id, status |
| rpg_club_steam_collection_imports_pkey | btree | Yes | Yes | import_id |

### Index Definitions

```sql
CREATE INDEX ix_steam_coll_imports_user ON public.rpg_club_steam_collection_imports USING btree (user_id, status);
CREATE UNIQUE INDEX rpg_club_steam_collection_imports_pkey ON public.rpg_club_steam_collection_imports USING btree (import_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16819_10_not_null | updated_at IS NOT NULL |
| 2200_16819_1_not_null | import_id IS NOT NULL |
| 2200_16819_2_not_null | user_id IS NOT NULL |
| 2200_16819_3_not_null | status IS NOT NULL |
| 2200_16819_4_not_null | current_index IS NOT NULL |
| 2200_16819_5_not_null | total_count IS NOT NULL |
| 2200_16819_6_not_null | steam_id64 IS NOT NULL |
| 2200_16819_9_not_null | created_at IS NOT NULL |
| ck_steam_coll_imports_status | ((status)::text = ANY (ARRAY[('ACTIVE'::character varying)::text, ('PAUSED'::character varying)::text, ('COMPLETED'::character varying)::text, ('CANCELED'::character varying)::text])) |
