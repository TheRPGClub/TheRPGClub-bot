# public.rpg_club_suggestions

**Type:** BASE TABLE  
**Estimated rows:** 1

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | suggestion_id | bigint | No |  | BY DEFAULT |  |
| 2 | title | character varying(200) | No |  |  |  |
| 3 | details | character varying(2000) | Yes |  |  |  |
| 4 | created_by | character varying(30) | Yes |  |  |  |
| 5 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 6 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 7 | labels | character varying(200) | Yes |  |  |  |
| 8 | created_by_name | character varying(100) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_rpg_club_suggestions_created | btree | No | No | created_at |
| rpg_club_suggestions_pkey | btree | Yes | Yes | suggestion_id |

### Index Definitions

```sql
CREATE INDEX ix_rpg_club_suggestions_created ON public.rpg_club_suggestions USING btree (created_at);
CREATE UNIQUE INDEX rpg_club_suggestions_pkey ON public.rpg_club_suggestions USING btree (suggestion_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16839_1_not_null | suggestion_id IS NOT NULL |
| 2200_16839_2_not_null | title IS NOT NULL |
| 2200_16839_5_not_null | created_at IS NOT NULL |
| 2200_16839_6_not_null | updated_at IS NOT NULL |
