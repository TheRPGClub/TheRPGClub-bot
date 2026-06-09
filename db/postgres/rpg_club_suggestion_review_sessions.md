# public.rpg_club_suggestion_review_sessions

**Type:** BASE TABLE  
**Estimated rows:** 1

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | session_id | character varying(120) | No |  |  |  |
| 2 | reviewer_id | character varying(30) | No |  |  |  |
| 3 | suggestion_ids | character varying(4000) | No |  |  |  |
| 4 | current_index | bigint | No | 0 |  |  |
| 5 | total_count | bigint | No | 0 |  |  |
| 6 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 7 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_rpg_club_sug_rev_sess_created | btree | No | No | created_at |
| ix_rpg_club_sug_rev_sess_reviewer | btree | No | No | reviewer_id |
| rpg_club_suggestion_review_sessions_pkey | btree | Yes | Yes | session_id |

### Index Definitions

```sql
CREATE INDEX ix_rpg_club_sug_rev_sess_created ON public.rpg_club_suggestion_review_sessions USING btree (created_at);
CREATE INDEX ix_rpg_club_sug_rev_sess_reviewer ON public.rpg_club_suggestion_review_sessions USING btree (reviewer_id);
CREATE UNIQUE INDEX rpg_club_suggestion_review_sessions_pkey ON public.rpg_club_suggestion_review_sessions USING btree (session_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16830_1_not_null | session_id IS NOT NULL |
| 2200_16830_2_not_null | reviewer_id IS NOT NULL |
| 2200_16830_3_not_null | suggestion_ids IS NOT NULL |
| 2200_16830_4_not_null | current_index IS NOT NULL |
| 2200_16830_5_not_null | total_count IS NOT NULL |
| 2200_16830_6_not_null | created_at IS NOT NULL |
| 2200_16830_7_not_null | updated_at IS NOT NULL |
