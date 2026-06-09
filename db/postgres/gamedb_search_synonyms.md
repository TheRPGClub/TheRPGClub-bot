# public.gamedb_search_synonyms

**Type:** BASE TABLE  
**Estimated rows:** 466

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | term_id | bigint | No |  | BY DEFAULT |  |
| 2 | group_id | bigint | No |  |  |  |
| 3 | term_text | character varying(255) | No |  |  |  |
| 4 | term_norm | character varying(255) | No |  |  |  |
| 5 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 6 | created_by | character varying(64) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_search_synonyms_group_id_term_norm_key | btree | Yes | No | group_id, term_norm |
| gamedb_search_synonyms_pkey | btree | Yes | Yes | term_id |
| idx_gamedb_search_synonyms_group | btree | No | No | group_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_search_synonyms_group_id_term_norm_key ON public.gamedb_search_synonyms USING btree (group_id, term_norm);
CREATE UNIQUE INDEX gamedb_search_synonyms_pkey ON public.gamedb_search_synonyms USING btree (term_id);
CREATE INDEX idx_gamedb_search_synonyms_group ON public.gamedb_search_synonyms USING btree (group_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gamedb_search_synonyms_group | group_id | public.gamedb_search_synonym_groups(group_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16619_1_not_null | term_id IS NOT NULL |
| 2200_16619_2_not_null | group_id IS NOT NULL |
| 2200_16619_3_not_null | term_text IS NOT NULL |
| 2200_16619_4_not_null | term_norm IS NOT NULL |
| 2200_16619_5_not_null | created_at IS NOT NULL |
