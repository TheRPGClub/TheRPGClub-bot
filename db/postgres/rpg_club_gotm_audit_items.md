# public.rpg_club_gotm_audit_items

**Type:** BASE TABLE  
**Estimated rows:** 714

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | item_id | bigint | No |  | BY DEFAULT |  |
| 2 | import_id | bigint | No |  |  |  |
| 3 | row_index | bigint | No |  |  |  |
| 4 | kind | character varying(10) | No |  |  |  |
| 5 | round_number | bigint | No |  |  |  |
| 6 | month_year | character varying(50) | No |  |  |  |
| 7 | game_index | bigint | No |  |  |  |
| 8 | game_title | character varying(500) | No |  |  |  |
| 9 | thread_id | character varying(30) | Yes |  |  |  |
| 10 | reddit_url | character varying(1000) | Yes |  |  |  |
| 11 | status | character varying(20) | No |  |  |  |
| 12 | gamedb_game_id | bigint | Yes |  |  |  |
| 13 | error_text | character varying(2000) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_gotm_audit_items_import | btree | No | No | import_id, status, row_index |
| ix_gotm_audit_items_round | btree | No | No | import_id, kind, round_number |
| rpg_club_gotm_audit_items_pkey | btree | Yes | Yes | item_id |

### Index Definitions

```sql
CREATE INDEX ix_gotm_audit_items_import ON public.rpg_club_gotm_audit_items USING btree (import_id, status, row_index);
CREATE INDEX ix_gotm_audit_items_round ON public.rpg_club_gotm_audit_items USING btree (import_id, kind, round_number);
CREATE UNIQUE INDEX rpg_club_gotm_audit_items_pkey ON public.rpg_club_gotm_audit_items USING btree (item_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gotm_audit_items | import_id | public.rpg_club_gotm_audit_imports(import_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16739_11_not_null | status IS NOT NULL |
| 2200_16739_1_not_null | item_id IS NOT NULL |
| 2200_16739_2_not_null | import_id IS NOT NULL |
| 2200_16739_3_not_null | row_index IS NOT NULL |
| 2200_16739_4_not_null | kind IS NOT NULL |
| 2200_16739_5_not_null | round_number IS NOT NULL |
| 2200_16739_6_not_null | month_year IS NOT NULL |
| 2200_16739_7_not_null | game_index IS NOT NULL |
| 2200_16739_8_not_null | game_title IS NOT NULL |
