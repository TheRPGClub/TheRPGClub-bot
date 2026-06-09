# public.gamedb_games

**Type:** BASE TABLE  
**Estimated rows:** 7063

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | game_id | bigint | No |  | BY DEFAULT |  |
| 2 | title | character varying(255) | No |  |  |  |
| 3 | description | text | Yes |  |  |  |
| 5 | igdb_id | bigint | Yes |  |  |  |
| 6 | slug | character varying(255) | Yes |  |  |  |
| 7 | total_rating | numeric | Yes |  |  |  |
| 8 | igdb_url | character varying(512) | Yes |  |  |  |
| 9 | created_at | timestamp(6) without time zone | Yes | CURRENT_TIMESTAMP |  |  |
| 10 | updated_at | timestamp(6) without time zone | Yes | CURRENT_TIMESTAMP |  |  |
| 11 | featured_video_url | character varying(512) | Yes |  |  |  |
| 12 | initial_release_date | timestamp(0) without time zone | Yes |  |  |  |
| 13 | collection_id | bigint | Yes |  |  |  |
| 14 | parent_igdb_id | bigint | Yes |  |  |  |
| 15 | parent_game_name | character varying(255) | Yes |  |  |  |
| 17 | thumbnail_bad | boolean | No | false |  |  |
| 18 | thumbnail_approved | boolean | No | false |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_games_igdb_id_key | btree | Yes | No | igdb_id |
| gamedb_games_pkey | btree | Yes | Yes | game_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_games_igdb_id_key ON public.gamedb_games USING btree (igdb_id);
CREATE UNIQUE INDEX gamedb_games_pkey ON public.gamedb_games USING btree (game_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_games_collection | collection_id | public.gamedb_collections(collection_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16570_17_not_null | thumbnail_bad IS NOT NULL |
| 2200_16570_18_not_null | thumbnail_approved IS NOT NULL |
| 2200_16570_1_not_null | game_id IS NOT NULL |
| 2200_16570_2_not_null | title IS NOT NULL |
