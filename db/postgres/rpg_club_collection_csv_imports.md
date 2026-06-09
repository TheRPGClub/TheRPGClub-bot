# public.rpg_club_collection_csv_imports

**Type:** BASE TABLE  
**Estimated rows:** 2

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | import_id | bigint | No |  | BY DEFAULT |  |
| 2 | user_id | character varying(30) | No |  |  |  |
| 3 | status | character varying(20) | No |  |  |  |
| 4 | current_index | bigint | No | 0 |  |  |
| 5 | total_count | bigint | No | 0 |  |  |
| 6 | source_file_name | character varying(255) | Yes |  |  |  |
| 7 | source_file_size | bigint | Yes |  |  |  |
| 8 | template_version | character varying(20) | Yes |  |  |  |
| 9 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 10 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_coll_csv_imports_user | btree | No | No | user_id, status |
| rpg_club_collection_csv_imports_pkey | btree | Yes | Yes | import_id |

### Index Definitions

```sql
CREATE INDEX ix_coll_csv_imports_user ON public.rpg_club_collection_csv_imports USING btree (user_id, status);
CREATE UNIQUE INDEX rpg_club_collection_csv_imports_pkey ON public.rpg_club_collection_csv_imports USING btree (import_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16677_10_not_null | updated_at IS NOT NULL |
| 2200_16677_1_not_null | import_id IS NOT NULL |
| 2200_16677_2_not_null | user_id IS NOT NULL |
| 2200_16677_3_not_null | status IS NOT NULL |
| 2200_16677_4_not_null | current_index IS NOT NULL |
| 2200_16677_5_not_null | total_count IS NOT NULL |
| 2200_16677_9_not_null | created_at IS NOT NULL |
| ck_coll_csv_imports_status | ((status)::text = ANY (ARRAY[('ACTIVE'::character varying)::text, ('PAUSED'::character varying)::text, ('COMPLETED'::character varying)::text, ('CANCELED'::character varying)::text])) |
