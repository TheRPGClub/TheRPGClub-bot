# public.user_game_backlog

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | entry_id | bigint | No | nextval('user_game_backlog_entry_id_seq'::regclass) |  |  |
| 2 | user_id | character varying(50) | No |  |  |  |
| 3 | gamedb_game_id | bigint | No |  |  |  |
| 4 | platform_id | bigint | Yes |  |  |  |
| 5 | sort_order | bigint | Yes |  |  |  |
| 6 | note | character varying(500) | Yes |  |  |  |
| 7 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 8 | updated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_user_game_backlog_platform | btree | No | No | platform_id |
| ix_user_game_backlog_sort | btree | No | No | user_id, sort_order |
| ix_user_game_backlog_user | btree | No | No | user_id |
| uq_user_game_backlog_user_game_platform | btree | Yes | No | user_id, gamedb_game_id, platform_id |
| user_game_backlog_pkey | btree | Yes | Yes | entry_id |

### Index Definitions

```sql
CREATE INDEX ix_user_game_backlog_platform ON public.user_game_backlog USING btree (platform_id);
CREATE INDEX ix_user_game_backlog_sort ON public.user_game_backlog USING btree (user_id, sort_order);
CREATE INDEX ix_user_game_backlog_user ON public.user_game_backlog USING btree (user_id);
CREATE UNIQUE INDEX uq_user_game_backlog_user_game_platform ON public.user_game_backlog USING btree (user_id, gamedb_game_id, platform_id);
CREATE UNIQUE INDEX user_game_backlog_pkey ON public.user_game_backlog USING btree (entry_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_user_game_backlog_gamedb | gamedb_game_id | public.gamedb_games(game_id) | NO ACTION | NO ACTION |
| fk_user_game_backlog_platform | platform_id | public.gamedb_platforms(platform_id) | NO ACTION | NO ACTION |
| fk_user_game_backlog_user | user_id | public.rpg_club_users(user_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_122905_1_not_null | entry_id IS NOT NULL |
| 2200_122905_2_not_null | user_id IS NOT NULL |
| 2200_122905_3_not_null | gamedb_game_id IS NOT NULL |
| 2200_122905_7_not_null | created_at IS NOT NULL |
| 2200_122905_8_not_null | updated_at IS NOT NULL |
