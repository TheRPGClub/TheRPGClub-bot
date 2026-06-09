# public.gamedb_game_images

**Type:** BASE TABLE  
**Estimated rows:** 19269

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | image_id | bigint | No | nextval('gamedb_game_images_image_id_seq'::regclass) |  |  |
| 2 | game_id | bigint | No |  |  |  |
| 3 | kind | character varying(32) | No |  |  |  |
| 4 | object_key | character varying(512) | No |  |  |  |
| 5 | uploaded_by_user_id | character varying(30) | Yes |  |  |  |
| 6 | is_primary | boolean | No | false |  |  |
| 7 | position | integer | No | 1 |  |  |
| 9 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 10 | updated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_images_pkey | btree | Yes | Yes | image_id |
| idx_gamedb_game_images_lookup | btree | No | No | game_id, kind, position |
| idx_gamedb_game_images_one_primary | btree | Yes | No | game_id, kind |
| index_gamedb_game_images_on_object_key | btree | Yes | No | object_key |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_images_pkey ON public.gamedb_game_images USING btree (image_id);
CREATE INDEX idx_gamedb_game_images_lookup ON public.gamedb_game_images USING btree (game_id, kind, "position");
CREATE UNIQUE INDEX idx_gamedb_game_images_one_primary ON public.gamedb_game_images USING btree (game_id, kind) WHERE (is_primary = true);
CREATE UNIQUE INDEX index_gamedb_game_images_on_object_key ON public.gamedb_game_images USING btree (object_key);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_rails_gamedb_game_images_game | game_id | public.gamedb_games(game_id) | NO ACTION | NO ACTION |
| fk_rails_gamedb_game_images_uploaded_by | uploaded_by_user_id | public.rpg_club_users(user_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_49153_10_not_null | updated_at IS NOT NULL |
| 2200_49153_1_not_null | image_id IS NOT NULL |
| 2200_49153_2_not_null | game_id IS NOT NULL |
| 2200_49153_3_not_null | kind IS NOT NULL |
| 2200_49153_4_not_null | object_key IS NOT NULL |
| 2200_49153_6_not_null | is_primary IS NOT NULL |
| 2200_49153_7_not_null | position IS NOT NULL |
| 2200_49153_9_not_null | created_at IS NOT NULL |
| ck_gamedb_game_images_kind | ((kind)::text = ANY ((ARRAY['cover'::character varying, 'artwork'::character varying, 'logo'::character varying])::text[])) |
