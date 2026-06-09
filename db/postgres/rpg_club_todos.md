# public.rpg_club_todos

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | todo_id | bigint | No |  | BY DEFAULT |  |
| 2 | title | character varying(200) | No |  |  |  |
| 3 | details | character varying(2000) | Yes |  |  |  |
| 4 | created_by | character varying(30) | Yes |  |  |  |
| 5 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 6 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 7 | completed_at | timestamp(6) with time zone | Yes |  |  |  |
| 8 | completed_by | character varying(30) | Yes |  |  |  |
| 9 | is_completed | boolean | No | false |  |  |
| 10 | category | character varying(20) | No | 'Improvements'::character varying |  |  |
| 11 | todo_category | character varying(20) | No | 'Improvements'::character varying |  |  |
| 12 | todo_size | character varying(4) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_rpg_club_todos_status | btree | No | No | is_completed, created_at |
| rpg_club_todos_pkey | btree | Yes | Yes | todo_id |

### Index Definitions

```sql
CREATE INDEX ix_rpg_club_todos_status ON public.rpg_club_todos USING btree (is_completed, created_at);
CREATE UNIQUE INDEX rpg_club_todos_pkey ON public.rpg_club_todos USING btree (todo_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16847_10_not_null | category IS NOT NULL |
| 2200_16847_11_not_null | todo_category IS NOT NULL |
| 2200_16847_1_not_null | todo_id IS NOT NULL |
| 2200_16847_2_not_null | title IS NOT NULL |
| 2200_16847_5_not_null | created_at IS NOT NULL |
| 2200_16847_6_not_null | updated_at IS NOT NULL |
| 2200_16847_9_not_null | is_completed IS NOT NULL |
| ck_rpg_club_todos_size | (((todo_size)::text = ANY (ARRAY[('XS'::character varying)::text, ('S'::character varying)::text, ('M'::character varying)::text, ('L'::character varying)::text, ('XL'::character varying)::text])) OR (COALESCE((todo_size)::text, ''::text) = ''::text)) |
| ck_rpg_club_todos_todo_category | ((todo_category)::text = ANY (ARRAY[('New Features'::character varying)::text, ('Improvements'::character varying)::text, ('Defects'::character varying)::text, ('Blocked'::character varying)::text, ('Refactoring'::character varying)::text])) |
