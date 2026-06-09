# public.gamedb_search_synonym_groups

**Type:** BASE TABLE  
**Estimated rows:** 213

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | group_id | bigint | No |  | BY DEFAULT |  |
| 2 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 3 | created_by | character varying(64) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_search_synonym_groups_pkey | btree | Yes | Yes | group_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_search_synonym_groups_pkey ON public.gamedb_search_synonym_groups USING btree (group_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16614_1_not_null | group_id IS NOT NULL |
| 2200_16614_2_not_null | created_at IS NOT NULL |
