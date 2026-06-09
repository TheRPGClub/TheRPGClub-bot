# public.threads

**Type:** BASE TABLE  
**Estimated rows:** 111

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | thread_id | character varying(30) | No |  |  |  |
| 2 | forum_channel_id | character varying(30) | No |  |  |  |
| 3 | thread_name | character varying(200) | No |  |  |  |
| 4 | gamedb_game_id | bigint | Yes |  |  |  |
| 5 | is_archived | character varying(1) | No | 'N'::character varying |  |  |
| 6 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 7 | last_seen_at | timestamp(6) with time zone | Yes |  |  |  |
| 8 | skip_linking | character varying(1) | No | 'N'::character varying |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_threads_forum | btree | No | No | forum_channel_id |
| ix_threads_gamedb | btree | No | No | gamedb_game_id |
| threads_pkey | btree | Yes | Yes | thread_id |

### Index Definitions

```sql
CREATE INDEX ix_threads_forum ON public.threads USING btree (forum_channel_id);
CREATE INDEX ix_threads_gamedb ON public.threads USING btree (gamedb_game_id);
CREATE UNIQUE INDEX threads_pkey ON public.threads USING btree (thread_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_threads_gamedb_game | gamedb_game_id | public.gamedb_games(game_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_65592_1_not_null | thread_id IS NOT NULL |
| 2200_65592_2_not_null | forum_channel_id IS NOT NULL |
| 2200_65592_3_not_null | thread_name IS NOT NULL |
| 2200_65592_5_not_null | is_archived IS NOT NULL |
| 2200_65592_6_not_null | created_at IS NOT NULL |
| 2200_65592_8_not_null | skip_linking IS NOT NULL |
| ck_threads_is_archived | ((is_archived)::text = ANY ((ARRAY['Y'::character varying, 'N'::character varying])::text[])) |
| ck_threads_skip_linking | ((skip_linking)::text = ANY ((ARRAY['Y'::character varying, 'N'::character varying])::text[])) |
