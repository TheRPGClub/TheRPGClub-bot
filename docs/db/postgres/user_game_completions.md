# public.user_game_completions

**Type:** BASE TABLE  
**Estimated rows:** 3145

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | completion_id | bigint | No |  | ALWAYS |  |
| 2 | user_id | character varying(50) | No |  |  |  |
| 3 | gamedb_game_id | bigint | No |  |  |  |
| 4 | completion_type | character varying(50) | No |  |  |  |
| 5 | completed_at | timestamp(0) without time zone | Yes | date_trunc('day'::text, statement_timestamp()) |  |  |
| 6 | final_playtime_hrs | numeric(8,2) | Yes |  |  |  |
| 7 | created_at | timestamp(6) without time zone | No | statement_timestamp() |  |  |
| 8 | note | character varying(500) | Yes |  |  |  |
| 9 | platform_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| idx_user_game_completions_platform | btree | No | No | platform_id |
| ix_ugc_game | btree | No | No | gamedb_game_id |
| ix_ugc_user | btree | No | No | user_id |
| user_game_completions_pkey | btree | Yes | Yes | completion_id |

### Index Definitions

```sql
CREATE INDEX idx_user_game_completions_platform ON public.user_game_completions USING btree (platform_id);
CREATE INDEX ix_ugc_game ON public.user_game_completions USING btree (gamedb_game_id);
CREATE INDEX ix_ugc_user ON public.user_game_completions USING btree (user_id);
CREATE UNIQUE INDEX user_game_completions_pkey ON public.user_game_completions USING btree (completion_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_ugc_gamedb_game | gamedb_game_id | public.gamedb_games(game_id) | NO ACTION | NO ACTION |
| fk_user_game_completions_platform | platform_id | public.gamedb_platforms(platform_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16922_1_not_null | completion_id IS NOT NULL |
| 2200_16922_2_not_null | user_id IS NOT NULL |
| 2200_16922_3_not_null | gamedb_game_id IS NOT NULL |
| 2200_16922_4_not_null | completion_type IS NOT NULL |
| 2200_16922_7_not_null | created_at IS NOT NULL |
| ck_user_game_completions_type | ((completion_type)::text = ANY (ARRAY[('Main Story'::character varying)::text, ('Main Story + Side Content'::character varying)::text, ('Completionist'::character varying)::text])) |
