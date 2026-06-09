# public.user_game_collections

**Type:** BASE TABLE  
**Estimated rows:** 4216

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | entry_id | bigint | No |  | ALWAYS |  |
| 2 | user_id | character varying(50) | No |  |  |  |
| 3 | gamedb_game_id | bigint | No |  |  |  |
| 4 | platform_id | bigint | Yes |  |  |  |
| 5 | ownership_type | character varying(30) | No | 'Digital'::character varying |  |  |
| 6 | note | character varying(500) | Yes |  |  |  |
| 7 | is_shared | boolean | No | true |  |  |
| 8 | created_at | timestamp(6) without time zone | No | statement_timestamp() |  |  |
| 9 | updated_at | timestamp(6) without time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_ugcol_game | btree | No | No | gamedb_game_id |
| ix_ugcol_platform | btree | No | No | platform_id |
| ix_ugcol_shared | btree | No | No | user_id, is_shared |
| ix_ugcol_user | btree | No | No | user_id |
| uq_user_game_collections_dedup | btree | Yes | No | user_id, gamedb_game_id, ownership_type |
| user_game_collections_pkey | btree | Yes | Yes | entry_id |

### Index Definitions

```sql
CREATE INDEX ix_ugcol_game ON public.user_game_collections USING btree (gamedb_game_id);
CREATE INDEX ix_ugcol_platform ON public.user_game_collections USING btree (platform_id);
CREATE INDEX ix_ugcol_shared ON public.user_game_collections USING btree (user_id, is_shared);
CREATE INDEX ix_ugcol_user ON public.user_game_collections USING btree (user_id);
CREATE UNIQUE INDEX uq_user_game_collections_dedup ON public.user_game_collections USING btree (user_id, gamedb_game_id, COALESCE(platform_id, ('-1'::integer)::bigint), ownership_type);
CREATE UNIQUE INDEX user_game_collections_pkey ON public.user_game_collections USING btree (entry_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_ugcol_gamedb_game | gamedb_game_id | public.gamedb_games(game_id) | NO ACTION | NO ACTION |
| fk_ugcol_platform | platform_id | public.gamedb_platforms(platform_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16911_1_not_null | entry_id IS NOT NULL |
| 2200_16911_2_not_null | user_id IS NOT NULL |
| 2200_16911_3_not_null | gamedb_game_id IS NOT NULL |
| 2200_16911_5_not_null | ownership_type IS NOT NULL |
| 2200_16911_7_not_null | is_shared IS NOT NULL |
| 2200_16911_8_not_null | created_at IS NOT NULL |
| 2200_16911_9_not_null | updated_at IS NOT NULL |
| ck_ugcol_ownership_type | ((ownership_type)::text = ANY (ARRAY[('Digital'::character varying)::text, ('Physical'::character varying)::text, ('Subscription'::character varying)::text, ('Other'::character varying)::text])) |
