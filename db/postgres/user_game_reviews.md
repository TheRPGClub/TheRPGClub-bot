# public.user_game_reviews

**Type:** BASE TABLE  
**Estimated rows:** 1

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | review_id | bigint | No | nextval('user_game_reviews_review_id_seq'::regclass) |  |  |
| 2 | user_id | character varying(50) | No |  |  |  |
| 3 | gamedb_game_id | bigint | No |  |  |  |
| 4 | rating | integer | No |  |  |  |
| 5 | body | jsonb | Yes |  |  |  |
| 6 | is_shared | boolean | No | true |  |  |
| 7 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 8 | updated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_user_game_reviews_game | btree | No | No | gamedb_game_id |
| ix_user_game_reviews_user | btree | No | No | user_id |
| uq_user_game_reviews_user_game | btree | Yes | No | user_id, gamedb_game_id |
| user_game_reviews_pkey | btree | Yes | Yes | review_id |

### Index Definitions

```sql
CREATE INDEX ix_user_game_reviews_game ON public.user_game_reviews USING btree (gamedb_game_id);
CREATE INDEX ix_user_game_reviews_user ON public.user_game_reviews USING btree (user_id);
CREATE UNIQUE INDEX uq_user_game_reviews_user_game ON public.user_game_reviews USING btree (user_id, gamedb_game_id);
CREATE UNIQUE INDEX user_game_reviews_pkey ON public.user_game_reviews USING btree (review_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_user_game_reviews_gamedb | gamedb_game_id | public.gamedb_games(game_id) | NO ACTION | NO ACTION |
| fk_user_game_reviews_user | user_id | public.rpg_club_users(user_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_122935_1_not_null | review_id IS NOT NULL |
| 2200_122935_2_not_null | user_id IS NOT NULL |
| 2200_122935_3_not_null | gamedb_game_id IS NOT NULL |
| 2200_122935_4_not_null | rating IS NOT NULL |
| 2200_122935_6_not_null | is_shared IS NOT NULL |
| 2200_122935_7_not_null | created_at IS NOT NULL |
| 2200_122935_8_not_null | updated_at IS NOT NULL |
| ck_user_game_reviews_rating_range | ((rating >= 0) AND (rating <= 100)) |
