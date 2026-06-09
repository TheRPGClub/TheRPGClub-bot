# public.rpg_club_presence_prompt_opts

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | user_id | character varying(30) | No |  |  |  |
| 2 | scope | character varying(10) | No |  |  |  |
| 3 | game_title | character varying(300) | Yes |  |  |  |
| 4 | game_title_norm | character varying(300) | No |  |  |  |
| 5 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| rpg_club_presence_prompt_opts_pkey | btree | Yes | Yes | user_id, scope, game_title_norm |

### Index Definitions

```sql
CREATE UNIQUE INDEX rpg_club_presence_prompt_opts_pkey ON public.rpg_club_presence_prompt_opts USING btree (user_id, scope, game_title_norm);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16760_1_not_null | user_id IS NOT NULL |
| 2200_16760_2_not_null | scope IS NOT NULL |
| 2200_16760_4_not_null | game_title_norm IS NOT NULL |
| 2200_16760_5_not_null | created_at IS NOT NULL |
| ck_rpg_club_presence_prompt_scope | ((scope)::text = ANY (ARRAY[('ALL'::character varying)::text, ('GAME'::character varying)::text])) |
