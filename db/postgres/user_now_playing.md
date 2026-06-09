# public.user_now_playing

**Type:** BASE TABLE  
**Estimated rows:** 46

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | entry_id | bigint | No | nextval('user_now_playing_entry_id_seq'::regclass) |  |  |
| 2 | user_id | character varying(30) | No |  |  |  |
| 3 | gamedb_game_id | bigint | Yes |  |  |  |
| 4 | platform_id | bigint | Yes |  |  |  |
| 5 | added_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 6 | note | character varying(500) | Yes |  |  |  |
| 7 | sort_order | bigint | Yes |  |  |  |
| 8 | note_updated_at | timestamp(6) with time zone | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_user_now_playing_platform | btree | No | No | platform_id |
| ix_user_now_playing_sort | btree | No | No | user_id, sort_order |
| ix_user_now_playing_user | btree | No | No | user_id |
| uq_user_now_playing_gamedb | btree | Yes | No | user_id, gamedb_game_id |
| user_now_playing_pkey | btree | Yes | Yes | entry_id |

### Index Definitions

```sql
CREATE INDEX ix_user_now_playing_platform ON public.user_now_playing USING btree (platform_id);
CREATE INDEX ix_user_now_playing_sort ON public.user_now_playing USING btree (user_id, sort_order);
CREATE INDEX ix_user_now_playing_user ON public.user_now_playing USING btree (user_id);
CREATE UNIQUE INDEX uq_user_now_playing_gamedb ON public.user_now_playing USING btree (user_id, gamedb_game_id);
CREATE UNIQUE INDEX user_now_playing_pkey ON public.user_now_playing USING btree (entry_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_user_now_playing_gamedb | gamedb_game_id | public.gamedb_games(game_id) | NO ACTION | NO ACTION |
| fk_user_now_playing_platform | platform_id | public.gamedb_platforms(platform_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_65569_1_not_null | entry_id IS NOT NULL |
| 2200_65569_2_not_null | user_id IS NOT NULL |
| 2200_65569_5_not_null | added_at IS NOT NULL |
