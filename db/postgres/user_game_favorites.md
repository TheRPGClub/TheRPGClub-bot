# public.user_game_favorites

**Type:** BASE TABLE  
**Estimated rows:** 4

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | entry_id | bigint | No | nextval('user_game_favorites_entry_id_seq'::regclass) |  |  |
| 2 | user_id | character varying(50) | No |  |  |  |
| 3 | gamedb_game_id | bigint | No |  |  |  |
| 4 | sort_order | bigint | Yes |  |  |  |
| 5 | note | character varying(500) | Yes |  |  |  |
| 6 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 7 | updated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_user_game_favorites_game | btree | No | No | gamedb_game_id |
| ix_user_game_favorites_sort | btree | No | No | user_id, sort_order |
| uq_user_game_favorites_user_game | btree | Yes | No | user_id, gamedb_game_id |
| user_game_favorites_pkey | btree | Yes | Yes | entry_id |

### Index Definitions

```sql
CREATE INDEX ix_user_game_favorites_game ON public.user_game_favorites USING btree (gamedb_game_id);
CREATE INDEX ix_user_game_favorites_sort ON public.user_game_favorites USING btree (user_id, sort_order);
CREATE UNIQUE INDEX uq_user_game_favorites_user_game ON public.user_game_favorites USING btree (user_id, gamedb_game_id);
CREATE UNIQUE INDEX user_game_favorites_pkey ON public.user_game_favorites USING btree (entry_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_user_game_favorites_gamedb | gamedb_game_id | public.gamedb_games(game_id) | NO ACTION | NO ACTION |
| fk_user_game_favorites_user | user_id | public.rpg_club_users(user_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_122881_1_not_null | entry_id IS NOT NULL |
| 2200_122881_2_not_null | user_id IS NOT NULL |
| 2200_122881_3_not_null | gamedb_game_id IS NOT NULL |
| 2200_122881_6_not_null | created_at IS NOT NULL |
| 2200_122881_7_not_null | updated_at IS NOT NULL |
