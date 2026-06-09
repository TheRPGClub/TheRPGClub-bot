# public.gamedb_search_synonym_drafts

**Type:** BASE TABLE  
**Estimated rows:** 6

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | draft_id | bigint | No |  | BY DEFAULT |  |
| 2 | user_id | character varying(64) | No |  |  |  |
| 3 | pairs_json | text | Yes |  |  |  |
| 4 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 5 | updated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_search_synonym_drafts_pkey | btree | Yes | Yes | draft_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_search_synonym_drafts_pkey ON public.gamedb_search_synonym_drafts USING btree (draft_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16606_1_not_null | draft_id IS NOT NULL |
| 2200_16606_2_not_null | user_id IS NOT NULL |
| 2200_16606_4_not_null | created_at IS NOT NULL |
| 2200_16606_5_not_null | updated_at IS NOT NULL |
