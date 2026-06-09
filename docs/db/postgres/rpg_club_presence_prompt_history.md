# public.rpg_club_presence_prompt_history

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | prompt_id | character varying(64) | No |  |  |  |
| 2 | user_id | character varying(30) | No |  |  |  |
| 3 | game_title | character varying(300) | No |  |  |  |
| 4 | game_title_norm | character varying(300) | No |  |  |  |
| 5 | status | character varying(20) | No | 'PENDING'::character varying |  |  |
| 6 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 7 | resolved_at | timestamp(6) with time zone | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| idx_rpg_club_presence_prompt_hist_user | btree | No | No | user_id, game_title_norm, status |
| rpg_club_presence_prompt_history_pkey | btree | Yes | Yes | prompt_id |

### Index Definitions

```sql
CREATE INDEX idx_rpg_club_presence_prompt_hist_user ON public.rpg_club_presence_prompt_history USING btree (user_id, game_title_norm, status);
CREATE UNIQUE INDEX rpg_club_presence_prompt_history_pkey ON public.rpg_club_presence_prompt_history USING btree (prompt_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16753_1_not_null | prompt_id IS NOT NULL |
| 2200_16753_2_not_null | user_id IS NOT NULL |
| 2200_16753_3_not_null | game_title IS NOT NULL |
| 2200_16753_4_not_null | game_title_norm IS NOT NULL |
| 2200_16753_5_not_null | status IS NOT NULL |
| 2200_16753_6_not_null | created_at IS NOT NULL |
